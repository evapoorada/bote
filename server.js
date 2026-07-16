/* ============================================================
   BOTE — servidor (versión Postgres, lista para Render + Neon)
   Express + pg. Sin cuentas: la identidad es un miembroId por
   grupo que el cliente guarda en su móvil.
   ============================================================ */

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;
const CONN = process.env.DATABASE_URL;
if (!CONN) {
  console.error("Falta la variable de entorno DATABASE_URL (cadena de conexión de Postgres).");
  process.exit(1);
}

const esLocal = /localhost|127\.0\.0\.1/.test(CONN);
const pool = new Pool({
  connectionString: CONN,
  ssl: esLocal ? false : { rejectUnauthorized: false }, // Neon/Render requieren SSL
  max: 5,
});

/* ---------- esquema (se crea solo al arrancar) ---------- */
async function prepararEsquema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS grupos (
      codigo  TEXT PRIMARY KEY,
      nombre  TEXT NOT NULL,
      creado  BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS miembros (
      id           TEXT PRIMARY KEY,
      grupo_codigo TEXT NOT NULL REFERENCES grupos(codigo) ON DELETE CASCADE,
      nombre       TEXT NOT NULL,
      orden        BIGSERIAL
    );
    CREATE TABLE IF NOT EXISTS gastos (
      id            TEXT PRIMARY KEY,
      grupo_codigo  TEXT NOT NULL REFERENCES grupos(codigo) ON DELETE CASCADE,
      descripcion   TEXT NOT NULL,
      monto         DOUBLE PRECISION NOT NULL,
      categoria     TEXT NOT NULL,
      pagador_id    TEXT NOT NULL,
      participantes TEXT NOT NULL, -- JSON array de ids
      fecha         BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_miembros_grupo ON miembros(grupo_codigo);
    CREATE INDEX IF NOT EXISTS idx_gastos_grupo  ON gastos(grupo_codigo);
  `);
}

/* ---------- utilidades ---------- */
const uid = () => crypto.randomBytes(6).toString("hex");

async function nuevoCodigo() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // sin 0/O/1/I/L
  for (;;) {
    const code = Array.from({ length: 6 }, () => chars[crypto.randomInt(chars.length)]).join("");
    const { rowCount } = await pool.query("SELECT 1 FROM grupos WHERE codigo = $1", [code]);
    if (!rowCount) return code;
  }
}

const CATEGORIAS = ["comida", "alojamiento", "transporte", "ocio", "compras", "otros"];
const limpiarTexto = (s, max) => String(s || "").trim().slice(0, max);

async function grupoCompleto(codigo) {
  const g = (await pool.query("SELECT * FROM grupos WHERE codigo = $1", [codigo])).rows[0];
  if (!g) return null;
  const miembros = (
    await pool.query(
      "SELECT id, nombre FROM miembros WHERE grupo_codigo = $1 ORDER BY orden",
      [codigo]
    )
  ).rows;
  const gastos = (
    await pool.query("SELECT * FROM gastos WHERE grupo_codigo = $1 ORDER BY fecha", [codigo])
  ).rows.map((x) => ({
    id: x.id,
    desc: x.descripcion,
    monto: x.monto,
    categoria: x.categoria,
    pagadorId: x.pagador_id,
    participantes: JSON.parse(x.participantes),
    fecha: Number(x.fecha),
  }));
  return { codigo: g.codigo, nombre: g.nombre, creado: Number(g.creado), miembros, gastos };
}

/* ---------- app ---------- */
const app = express();
app.use(express.json({ limit: "64kb" }));
app.use(express.static(path.join(__dirname, "public")));

// envuelve handlers async para capturar errores
const h = (fn) => (req, res) =>
  fn(req, res).catch((e) => {
    console.error(e);
    res.status(500).json({ error: "Error del servidor. Inténtalo de nuevo." });
  });

/* Crear grupo */
app.post("/api/grupos", h(async (req, res) => {
  const nombre = limpiarTexto(req.body.nombre, 40);
  const miNombre = limpiarTexto(req.body.miNombre, 24);
  if (!nombre || !miNombre)
    return res.status(400).json({ error: "Faltan el nombre del grupo o tu nombre." });

  const codigo = await nuevoCodigo();
  const miembroId = uid();
  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    await cliente.query(
      "INSERT INTO grupos (codigo, nombre, creado) VALUES ($1, $2, $3)",
      [codigo, nombre, Date.now()]
    );
    await cliente.query(
      "INSERT INTO miembros (id, grupo_codigo, nombre) VALUES ($1, $2, $3)",
      [miembroId, codigo, miNombre]
    );
    await cliente.query("COMMIT");
  } catch (e) {
    await cliente.query("ROLLBACK");
    throw e;
  } finally {
    cliente.release();
  }
  res.json({ codigo, miembroId, grupo: await grupoCompleto(codigo) });
}));

/* Leer grupo */
app.get("/api/grupos/:codigo", h(async (req, res) => {
  const grupo = await grupoCompleto(req.params.codigo.toUpperCase());
  if (!grupo) return res.status(404).json({ error: "No existe ningún grupo con ese código." });
  res.json(grupo);
}));

/* Unirse a un grupo (o recuperar sitio por nombre) */
app.post("/api/grupos/:codigo/miembros", h(async (req, res) => {
  const codigo = req.params.codigo.toUpperCase();
  const nombre = limpiarTexto(req.body.nombre, 24);
  if (!nombre) return res.status(400).json({ error: "Falta tu nombre." });

  const existe = await pool.query("SELECT 1 FROM grupos WHERE codigo = $1", [codigo]);
  if (!existe.rowCount)
    return res.status(404).json({ error: "No existe ningún grupo con ese código." });

  const previo = await pool.query(
    "SELECT id FROM miembros WHERE grupo_codigo = $1 AND lower(nombre) = lower($2)",
    [codigo, nombre]
  );

  let miembroId;
  if (previo.rowCount) {
    miembroId = previo.rows[0].id;
  } else {
    miembroId = uid();
    await pool.query(
      "INSERT INTO miembros (id, grupo_codigo, nombre) VALUES ($1, $2, $3)",
      [miembroId, codigo, nombre]
    );
  }
  res.json({ miembroId, grupo: await grupoCompleto(codigo) });
}));

/* Añadir gasto */
app.post("/api/grupos/:codigo/gastos", h(async (req, res) => {
  const codigo = req.params.codigo.toUpperCase();
  const grupo = await grupoCompleto(codigo);
  if (!grupo) return res.status(404).json({ error: "Grupo no encontrado." });

  const desc = limpiarTexto(req.body.desc, 60);
  const monto = Math.round(Number(req.body.monto) * 100) / 100;
  const categoria = CATEGORIAS.includes(req.body.categoria) ? req.body.categoria : "otros";
  const pagadorId = String(req.body.pagadorId || "");
  const idsValidos = new Set(grupo.miembros.map((m) => m.id));
  const participantes = Array.isArray(req.body.participantes)
    ? [...new Set(req.body.participantes.filter((id) => idsValidos.has(id)))]
    : [];

  if (!desc) return res.status(400).json({ error: "Describe el gasto." });
  if (!(monto > 0) || monto > 1e7)
    return res.status(400).json({ error: "El importe no es válido." });
  if (!idsValidos.has(pagadorId))
    return res.status(400).json({ error: "El pagador no pertenece al grupo." });
  if (!participantes.length)
    return res.status(400).json({ error: "Marca al menos un participante." });

  const gasto = { id: uid(), desc, monto, categoria, pagadorId, participantes, fecha: Date.now() };
  await pool.query(
    `INSERT INTO gastos (id, grupo_codigo, descripcion, monto, categoria, pagador_id, participantes, fecha)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [gasto.id, codigo, desc, monto, categoria, pagadorId, JSON.stringify(participantes), gasto.fecha]
  );
  res.json({ gasto, grupo: await grupoCompleto(codigo) });
}));

/* Borrar gasto */
app.delete("/api/grupos/:codigo/gastos/:id", h(async (req, res) => {
  const codigo = req.params.codigo.toUpperCase();
  const r = await pool.query(
    "DELETE FROM gastos WHERE grupo_codigo = $1 AND id = $2",
    [codigo, req.params.id]
  );
  if (!r.rowCount) return res.status(404).json({ error: "Gasto no encontrado." });
  res.json({ grupo: await grupoCompleto(codigo) });
}));

/* Enlaces de invitación: /g/CODIGO abre la app con el código precargado */
app.get("/g/:codigo", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* Salud (útil para monitores que mantienen despierto el servicio) */
app.get("/salud", (_req, res) => res.json({ ok: true }));

prepararEsquema()
  .then(() => {
    app.listen(PORT, () => console.log(`bote. escuchando en http://localhost:${PORT}`));
  })
  .catch((e) => {
    console.error("No se pudo preparar la base de datos:", e.message);
    process.exit(1);
  });
