import { useState, useEffect, useRef, useMemo } from "react";

/* ============================================================
   BOTE — divide los gastos del viaje, sin apps ni cuentas
   Datos compartidos por código de grupo (window.storage shared)
   ============================================================ */

const CATEGORIAS = [
  { id: "comida", nombre: "Comida", emoji: "🍕", color: "#E8863A" },
  { id: "alojamiento", nombre: "Alojamiento", emoji: "🛏️", color: "#5B8DEF" },
  { id: "transporte", nombre: "Transporte", emoji: "🚗", color: "#8E6FD8" },
  { id: "ocio", nombre: "Ocio", emoji: "🎉", color: "#E45A8D" },
  { id: "compras", nombre: "Compras", emoji: "🛍️", color: "#3FB6A8" },
  { id: "otros", nombre: "Otros", emoji: "📦", color: "#9AA38F" },
];
const catDe = (id) => CATEGORIAS.find((c) => c.id === id) || CATEGORIAS[5];

const eur = (n) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n || 0);

const uid = () => Math.random().toString(36).slice(2, 10);
const nuevoCodigo = () => {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let c = "";
  for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
};

/* ---------- storage helpers ---------- */
async function cargar(key, shared = false) {
  try {
    const r = await window.storage.get(key, shared);
    return r ? JSON.parse(r.value) : null;
  } catch {
    return null;
  }
}
async function guardar(key, val, shared = false) {
  try {
    const r = await window.storage.set(key, JSON.stringify(val), shared);
    return !!r;
  } catch {
    return false;
  }
}

/* ---------- cálculo de saldos y simplificación ---------- */
function calcSaldos(grupo) {
  const bal = {};
  grupo.miembros.forEach((m) => (bal[m.id] = 0));
  for (const g of grupo.gastos) {
    const parts = (g.participantes || []).filter((id) => bal[id] !== undefined);
    if (!parts.length || !grupo.miembros.some((m) => m.id === g.pagadorId)) continue;
    const cuota = g.monto / parts.length;
    bal[g.pagadorId] += g.monto;
    parts.forEach((id) => (bal[id] -= cuota));
  }
  return bal;
}

// Greedy: el mayor deudor paga al mayor acreedor → mínimo nº de transferencias
function simplificar(bal) {
  const deudores = [];
  const acreedores = [];
  Object.entries(bal).forEach(([id, v]) => {
    if (v < -0.005) deudores.push({ id, v: -v });
    else if (v > 0.005) acreedores.push({ id, v });
  });
  deudores.sort((a, b) => b.v - a.v);
  acreedores.sort((a, b) => b.v - a.v);
  const tx = [];
  let i = 0, j = 0;
  while (i < deudores.length && j < acreedores.length) {
    const monto = Math.min(deudores[i].v, acreedores[j].v);
    tx.push({ de: deudores[i].id, a: acreedores[j].id, monto });
    deudores[i].v -= monto;
    acreedores[j].v -= monto;
    if (deudores[i].v < 0.005) i++;
    if (acreedores[j].v < 0.005) j++;
  }
  return tx;
}

/* ---------- donut SVG ---------- */
function Donut({ datos, total }) {
  const R = 62, C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <svg viewBox="0 0 160 160" className="donut" role="img" aria-label="Gasto por categoría">
      <circle cx="80" cy="80" r={R} fill="none" stroke="var(--linea)" strokeWidth="18" />
      {datos.map((d) => {
        const frac = total > 0 ? d.total / total : 0;
        const seg = (
          <circle
            key={d.id}
            cx="80" cy="80" r={R} fill="none"
            stroke={d.color} strokeWidth="18" strokeLinecap="butt"
            strokeDasharray={`${frac * C} ${C}`}
            strokeDashoffset={-offset * C}
            transform="rotate(-90 80 80)"
          />
        );
        offset += frac;
        return seg;
      })}
      <text x="80" y="74" textAnchor="middle" className="donut-total">{eur(total)}</text>
      <text x="80" y="94" textAnchor="middle" className="donut-label">total</text>
    </svg>
  );
}

/* ============================================================ */

export default function App() {
  const [vista, setVista] = useState("cargando"); // cargando | inicio | crear | unirse | grupo
  const [misGrupos, setMisGrupos] = useState([]);
  const [grupo, setGrupo] = useState(null);
  const [miId, setMiId] = useState(null);
  const [codigo, setCodigo] = useState(null);
  const [tab, setTab] = useState("gastos"); // gastos | saldos | grafico
  const [hojaGasto, setHojaGasto] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [sync, setSync] = useState(false);
  const pollRef = useRef(null);

  const toast = (msg) => {
    setAviso(msg);
    setTimeout(() => setAviso(null), 2400);
  };

  /* --- arranque --- */
  useEffect(() => {
    (async () => {
      const lista = (await cargar("mis-grupos")) || [];
      setMisGrupos(lista);
      setVista("inicio");
    })();
  }, []);

  /* --- refresco periódico del grupo abierto --- */
  useEffect(() => {
    if (vista !== "grupo" || !codigo) return;
    const refrescar = async () => {
      setSync(true);
      const g = await cargar(`grupo:${codigo}`, true);
      if (g) setGrupo(g);
      setSync(false);
    };
    pollRef.current = setInterval(refrescar, 12000);
    const onVis = () => document.visibilityState === "visible" && refrescar();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(pollRef.current);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [vista, codigo]);

  /* --- acciones --- */
  async function crearGrupo(nombreGrupo, miNombre) {
    const code = nuevoCodigo();
    const yo = { id: uid(), nombre: miNombre.trim() };
    const g = {
      nombre: nombreGrupo.trim(),
      codigo: code,
      creado: Date.now(),
      miembros: [yo],
      gastos: [],
    };
    const ok = await guardar(`grupo:${code}`, g, true);
    if (!ok) return toast("No se pudo crear el grupo. Inténtalo de nuevo.");
    const lista = [...misGrupos, { codigo: code, nombre: g.nombre, miembroId: yo.id }];
    setMisGrupos(lista);
    await guardar("mis-grupos", lista);
    setGrupo(g); setMiId(yo.id); setCodigo(code); setTab("gastos"); setVista("grupo");
    toast(`Grupo creado · código ${code}`);
  }

  async function unirse(code, miNombre) {
    code = code.trim().toUpperCase();
    const g = await cargar(`grupo:${code}`, true);
    if (!g) return toast("No existe ningún grupo con ese código.");
    const ya = misGrupos.find((x) => x.codigo === code);
    let yo;
    if (ya) {
      yo = g.miembros.find((m) => m.id === ya.miembroId);
    }
    if (!yo) {
      // reutiliza si hay un miembro con el mismo nombre, si no crea uno
      yo = g.miembros.find(
        (m) => m.nombre.toLowerCase() === miNombre.trim().toLowerCase()
      );
      if (!yo) {
        yo = { id: uid(), nombre: miNombre.trim() };
        g.miembros = [...g.miembros, yo];
        await guardar(`grupo:${code}`, g, true);
      }
    }
    const lista = [
      ...misGrupos.filter((x) => x.codigo !== code),
      { codigo: code, nombre: g.nombre, miembroId: yo.id },
    ];
    setMisGrupos(lista);
    await guardar("mis-grupos", lista);
    setGrupo(g); setMiId(yo.id); setCodigo(code); setTab("gastos"); setVista("grupo");
  }

  async function abrirGrupo(entrada) {
    setVista("cargando");
    const g = await cargar(`grupo:${entrada.codigo}`, true);
    if (!g) {
      toast("No se encontró el grupo. Puede que se haya borrado.");
      setVista("inicio");
      return;
    }
    setGrupo(g); setMiId(entrada.miembroId); setCodigo(entrada.codigo);
    setTab("gastos"); setVista("grupo");
  }

  // lee la última versión, aplica el cambio y guarda (menos riesgo de pisar datos)
  async function mutarGrupo(fn) {
    const fresco = (await cargar(`grupo:${codigo}`, true)) || grupo;
    const next = fn(JSON.parse(JSON.stringify(fresco)));
    const ok = await guardar(`grupo:${codigo}`, next, true);
    if (!ok) { toast("No se pudo guardar. Revisa tu conexión."); return false; }
    setGrupo(next);
    return true;
  }

  async function agregarGasto(gasto) {
    const ok = await mutarGrupo((g) => {
      g.gastos = [...g.gastos, gasto];
      return g;
    });
    if (ok) { setHojaGasto(false); toast("Gasto añadido"); }
  }

  async function borrarGasto(id) {
    if (!window.confirm("¿Borrar este gasto para todo el grupo?")) return;
    await mutarGrupo((g) => {
      g.gastos = g.gastos.filter((x) => x.id !== id);
      return g;
    });
  }

  function copiarCodigo() {
    const texto = `Únete a nuestro bote "${grupo.nombre}" para dividir los gastos del viaje. Entra en la app y usa el código: ${codigo}`;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(texto).then(
        () => toast("Invitación copiada, pégala en el chat del grupo"),
        () => toast(`Código: ${codigo}`)
      );
    } else toast(`Código: ${codigo}`);
  }

  /* --- derivados --- */
  const saldos = useMemo(() => (grupo ? calcSaldos(grupo) : {}), [grupo]);
  const pagos = useMemo(() => simplificar(saldos), [saldos]);
  const totalGrupo = useMemo(
    () => (grupo ? grupo.gastos.reduce((s, g) => s + g.monto, 0) : 0),
    [grupo]
  );
  const porCategoria = useMemo(() => {
    if (!grupo) return [];
    const map = {};
    grupo.gastos.forEach((g) => {
      map[g.categoria] = (map[g.categoria] || 0) + g.monto;
    });
    return CATEGORIAS.filter((c) => map[c.id] > 0)
      .map((c) => ({ ...c, total: map[c.id] }))
      .sort((a, b) => b.total - a.total);
  }, [grupo]);

  const nombreDe = (id) => grupo?.miembros.find((m) => m.id === id)?.nombre || "¿?";

  /* ============================ RENDER ============================ */
  return (
    <div className="app">
      <Estilos />

      {aviso && <div className="toast">{aviso}</div>}

      {vista === "cargando" && (
        <div className="centrado suave">Abriendo el bote…</div>
      )}

      {/* ---------- INICIO ---------- */}
      {vista === "inicio" && (
        <main className="pantalla">
          <header className="hero">
            <div className="logo">bote<span className="logo-punto">.</span></div>
            <p className="claim">
              Divide los gastos del viaje sin descargar nada y sin crear cuentas.
              Un código, un grupo, cuentas claras.
            </p>
          </header>

          <div className="acciones-inicio">
            <button className="btn primario" onClick={() => setVista("crear")}>
              Crear un grupo
            </button>
            <button className="btn secundario" onClick={() => setVista("unirse")}>
              Unirme con un código
            </button>
          </div>

          {misGrupos.length > 0 && (
            <section className="bloque">
              <h2 className="titulo-seccion">Mis grupos</h2>
              <ul className="lista-grupos">
                {misGrupos.map((g) => (
                  <li key={g.codigo}>
                    <button className="tarjeta-grupo" onClick={() => abrirGrupo(g)}>
                      <span className="tg-nombre">{g.nombre}</span>
                      <span className="tg-codigo">{g.codigo}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <p className="nota-pie">
            Los datos del grupo se comparten con cualquiera que tenga el código.
            No incluyas información sensible.
          </p>
        </main>
      )}

      {/* ---------- CREAR ---------- */}
      {vista === "crear" && (
        <FormularioNuevo
          titulo="Crear grupo"
          textoBoton="Crear el bote"
          pideNombreGrupo
          onVolver={() => setVista("inicio")}
          onEnviar={(nombreGrupo, miNombre) => crearGrupo(nombreGrupo, miNombre)}
        />
      )}

      {/* ---------- UNIRSE ---------- */}
      {vista === "unirse" && (
        <FormularioNuevo
          titulo="Unirme a un grupo"
          textoBoton="Entrar al bote"
          pideCodigo
          onVolver={() => setVista("inicio")}
          onEnviar={(code, miNombre) => unirse(code, miNombre)}
        />
      )}

      {/* ---------- GRUPO ---------- */}
      {vista === "grupo" && grupo && (
        <main className="pantalla grupo">
          <header className="cab-grupo">
            <button className="volver" onClick={() => setVista("inicio")} aria-label="Volver">
              ←
            </button>
            <div className="cab-info">
              <h1>{grupo.nombre}</h1>
              <p>
                {grupo.miembros.length} persona{grupo.miembros.length !== 1 && "s"} ·{" "}
                {eur(totalGrupo)} en total {sync && <span className="sync">↻</span>}
              </p>
            </div>
            <button className="btn-codigo" onClick={copiarCodigo} title="Copiar invitación">
              {codigo} ⧉
            </button>
          </header>

          <nav className="tabs" role="tablist">
            {[
              ["gastos", "Gastos"],
              ["saldos", "Saldos"],
              ["grafico", "Gráfico"],
            ].map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                className={"tab" + (tab === id ? " activa" : "")}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>

          {/* --- TAB GASTOS --- */}
          {tab === "gastos" && (
            <section className="recibo">
              {grupo.gastos.length === 0 ? (
                <div className="vacio">
                  Todavía no hay gastos. Añade el primero con el botón de abajo y marca
                  quién participa.
                </div>
              ) : (
                <ul className="lista-gastos">
                  {[...grupo.gastos].reverse().map((g) => {
                    const c = catDe(g.categoria);
                    return (
                      <li key={g.id} className="gasto">
                        <span className="g-emoji" style={{ background: c.color + "22" }}>
                          {c.emoji}
                        </span>
                        <div className="g-info">
                          <span className="g-desc">{g.desc}</span>
                          <span className="g-meta">
                            {nombreDe(g.pagadorId)} pagó · {g.participantes.length} part.
                          </span>
                        </div>
                        <div className="g-derecha">
                          <span className="g-monto">{eur(g.monto)}</span>
                          <button
                            className="g-borrar"
                            onClick={() => borrarGasto(g.id)}
                            aria-label={`Borrar ${g.desc}`}
                          >
                            ×
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}

          {/* --- TAB SALDOS --- */}
          {tab === "saldos" && (
            <section>
              <h2 className="titulo-seccion">Saldo de cada persona</h2>
              <ul className="lista-saldos">
                {grupo.miembros.map((m) => {
                  const v = saldos[m.id] || 0;
                  const clase = v > 0.005 ? "pos" : v < -0.005 ? "neg" : "cero";
                  return (
                    <li key={m.id} className="saldo">
                      <span className="s-nombre">
                        {m.nombre}
                        {m.id === miId && <em> (tú)</em>}
                      </span>
                      <span className={"s-valor " + clase}>
                        {v > 0.005 ? "+" : ""}
                        {eur(v)}
                      </span>
                    </li>
                  );
                })}
              </ul>

              <h2 className="titulo-seccion espacio">
                Bizums sugeridos
                <span className="pill">{pagos.length}</span>
              </h2>
              {pagos.length === 0 ? (
                <div className="vacio">Todo cuadra: nadie debe nada a nadie. 🎉</div>
              ) : (
                <ul className="lista-pagos">
                  {pagos.map((p, i) => (
                    <li key={i} className="pago">
                      <div className="p-linea">
                        <span className="p-de">{nombreDe(p.de)}</span>
                        <span className="p-flecha">→</span>
                        <span className="p-a">{nombreDe(p.a)}</span>
                      </div>
                      <span className="p-monto">{eur(p.monto)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="nota-pie">
                Calculado para que hagáis el mínimo número de transferencias posible.
              </p>
            </section>
          )}

          {/* --- TAB GRÁFICO --- */}
          {tab === "grafico" && (
            <section>
              {totalGrupo === 0 ? (
                <div className="vacio">Añade gastos para ver en qué se va el dinero.</div>
              ) : (
                <>
                  <div className="donut-wrap">
                    <Donut datos={porCategoria} total={totalGrupo} />
                  </div>
                  <ul className="leyenda">
                    {porCategoria.map((c) => (
                      <li key={c.id} className="ley-item">
                        <span className="ley-punto" style={{ background: c.color }} />
                        <span className="ley-nombre">
                          {c.emoji} {c.nombre}
                        </span>
                        <span className="ley-barra">
                          <span
                            className="ley-relleno"
                            style={{
                              width: `${(c.total / totalGrupo) * 100}%`,
                              background: c.color,
                            }}
                          />
                        </span>
                        <span className="ley-valor">
                          {eur(c.total)}
                          <em>{Math.round((c.total / totalGrupo) * 100)}%</em>
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}

          <button className="fab" onClick={() => setHojaGasto(true)}>
            + Añadir gasto
          </button>

          {hojaGasto && (
            <HojaGasto
              grupo={grupo}
              miId={miId}
              onCerrar={() => setHojaGasto(false)}
              onGuardar={agregarGasto}
            />
          )}
        </main>
      )}
    </div>
  );
}

/* ---------- formulario crear / unirse ---------- */
function FormularioNuevo({ titulo, textoBoton, pideNombreGrupo, pideCodigo, onVolver, onEnviar }) {
  const [campo1, setCampo1] = useState("");
  const [miNombre, setMiNombre] = useState("");
  const valido = campo1.trim().length > 0 && miNombre.trim().length > 0;
  return (
    <main className="pantalla">
      <header className="cab-grupo">
        <button className="volver" onClick={onVolver} aria-label="Volver">←</button>
        <div className="cab-info"><h1>{titulo}</h1></div>
      </header>
      <div className="form">
        {pideNombreGrupo && (
          <label className="campo">
            <span>Nombre del grupo</span>
            <input
              value={campo1}
              onChange={(e) => setCampo1(e.target.value)}
              placeholder="Viaje a Lisboa"
              maxLength={40}
            />
          </label>
        )}
        {pideCodigo && (
          <label className="campo">
            <span>Código del grupo</span>
            <input
              value={campo1}
              onChange={(e) => setCampo1(e.target.value.toUpperCase())}
              placeholder="ABC123"
              maxLength={6}
              className="input-codigo"
              autoCapitalize="characters"
            />
          </label>
        )}
        <label className="campo">
          <span>Tu nombre</span>
          <input
            value={miNombre}
            onChange={(e) => setMiNombre(e.target.value)}
            placeholder="María"
            maxLength={24}
          />
        </label>
        <button
          className="btn primario"
          disabled={!valido}
          onClick={() => onEnviar(campo1, miNombre)}
        >
          {textoBoton}
        </button>
        {pideCodigo && (
          <p className="nota-pie">
            Pide el código de 6 letras a quien creó el grupo. Si ya te uniste antes con
            el mismo nombre, recuperarás tu sitio.
          </p>
        )}
      </div>
    </main>
  );
}

/* ---------- hoja para añadir gasto ---------- */
function HojaGasto({ grupo, miId, onCerrar, onGuardar }) {
  const [desc, setDesc] = useState("");
  const [monto, setMonto] = useState("");
  const [cat, setCat] = useState("comida");
  const [pagador, setPagador] = useState(miId || grupo.miembros[0]?.id);
  const [parts, setParts] = useState(grupo.miembros.map((m) => m.id));

  const montoNum = parseFloat(String(monto).replace(",", "."));
  const valido = desc.trim() && montoNum > 0 && parts.length > 0 && pagador;

  const togglePart = (id) =>
    setParts((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <div className="velo" onClick={onCerrar}>
      <div className="hoja" onClick={(e) => e.stopPropagation()}>
        <div className="hoja-asa" />
        <h2 className="hoja-titulo">Nuevo gasto</h2>

        <label className="campo">
          <span>¿Qué fue?</span>
          <input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Cena en la playa"
            maxLength={60}
            autoFocus
          />
        </label>

        <label className="campo">
          <span>Importe (€)</span>
          <input
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            placeholder="42,50"
            inputMode="decimal"
            className="input-monto"
          />
        </label>

        <div className="campo">
          <span>Categoría</span>
          <div className="chips">
            {CATEGORIAS.map((c) => (
              <button
                key={c.id}
                className={"chip" + (cat === c.id ? " activo" : "")}
                style={cat === c.id ? { background: c.color, borderColor: c.color } : {}}
                onClick={() => setCat(c.id)}
              >
                {c.emoji} {c.nombre}
              </button>
            ))}
          </div>
        </div>

        <label className="campo">
          <span>¿Quién pagó?</span>
          <select value={pagador} onChange={(e) => setPagador(e.target.value)}>
            {grupo.miembros.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}{m.id === miId ? " (tú)" : ""}
              </option>
            ))}
          </select>
        </label>

        <div className="campo">
          <span>¿Quién participa? ({parts.length})</span>
          <div className="chips">
            {grupo.miembros.map((m) => (
              <button
                key={m.id}
                className={"chip" + (parts.includes(m.id) ? " activo oscuro" : "")}
                onClick={() => togglePart(m.id)}
              >
                {m.nombre}
              </button>
            ))}
          </div>
        </div>

        {valido && (
          <p className="reparto">
            {eur(montoNum / parts.length)} por persona
          </p>
        )}

        <div className="hoja-botones">
          <button className="btn secundario" onClick={onCerrar}>Cancelar</button>
          <button
            className="btn primario"
            disabled={!valido}
            onClick={() =>
              onGuardar({
                id: uid(),
                desc: desc.trim(),
                monto: Math.round(montoNum * 100) / 100,
                categoria: cat,
                pagadorId: pagador,
                participantes: parts,
                fecha: Date.now(),
              })
            }
          >
            Guardar gasto
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- estilos ---------- */
function Estilos() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@500;700;800&family=IBM+Plex+Mono:wght@500;600&display=swap');

      :root {
        --papel: #EFF1EC;
        --tarjeta: #FFFFFF;
        --tinta: #1D2B24;
        --tinta-suave: #5E6C63;
        --linea: #DDE1D8;
        --lima: #CDEF5A;
        --pos: #11834F;
        --neg: #D2492A;
        --radio: 16px;
        --display: 'Bricolage Grotesque', system-ui, sans-serif;
        --mono: 'IBM Plex Mono', ui-monospace, monospace;
      }
      * { box-sizing: border-box; margin: 0; }
      .app {
        min-height: 100vh; background: var(--papel); color: var(--tinta);
        font-family: var(--display); -webkit-font-smoothing: antialiased;
      }
      .pantalla { max-width: 480px; margin: 0 auto; padding: 20px 18px 110px; }
      .centrado { display:flex; align-items:center; justify-content:center; min-height:60vh; }
      .suave { color: var(--tinta-suave); }

      /* hero */
      .hero { padding: 36px 4px 26px; }
      .logo { font-size: 52px; font-weight: 800; letter-spacing: -0.03em; line-height: 1; }
      .logo-punto { color: var(--pos); }
      .claim { margin-top: 12px; color: var(--tinta-suave); font-size: 16px; line-height: 1.5; max-width: 34ch; }

      .acciones-inicio { display: grid; gap: 10px; margin-bottom: 30px; }
      .btn {
        font-family: var(--display); font-weight: 700; font-size: 16px;
        padding: 15px 18px; border-radius: var(--radio); border: 2px solid var(--tinta);
        cursor: pointer; transition: transform .08s ease;
      }
      .btn:active { transform: scale(.98); }
      .btn:focus-visible { outline: 3px solid var(--lima); outline-offset: 2px; }
      .btn.primario { background: var(--tinta); color: var(--lima); }
      .btn.primario:disabled { opacity: .35; cursor: not-allowed; }
      .btn.secundario { background: transparent; color: var(--tinta); }

      .titulo-seccion {
        font-size: 13px; font-weight: 700; text-transform: uppercase;
        letter-spacing: .12em; color: var(--tinta-suave); margin-bottom: 10px;
        display: flex; align-items: center; gap: 8px;
      }
      .titulo-seccion.espacio { margin-top: 28px; }
      .pill {
        background: var(--tinta); color: var(--lima); border-radius: 99px;
        padding: 1px 8px; font-size: 11px;
      }

      .lista-grupos { list-style: none; padding: 0; display: grid; gap: 8px; }
      .tarjeta-grupo {
        width: 100%; display: flex; justify-content: space-between; align-items: center;
        background: var(--tarjeta); border: 1px solid var(--linea); border-radius: var(--radio);
        padding: 16px; cursor: pointer; font-family: var(--display); font-size: 16px;
      }
      .tarjeta-grupo:focus-visible { outline: 3px solid var(--lima); }
      .tg-nombre { font-weight: 700; }
      .tg-codigo { font-family: var(--mono); font-size: 13px; color: var(--tinta-suave); letter-spacing: .1em; }

      .nota-pie { margin-top: 18px; font-size: 12.5px; color: var(--tinta-suave); line-height: 1.5; }

      /* cabecera de grupo */
      .cab-grupo { display: flex; align-items: center; gap: 12px; padding: 8px 0 16px; }
      .volver {
        border: none; background: var(--tarjeta); border: 1px solid var(--linea);
        width: 40px; height: 40px; border-radius: 12px; font-size: 18px; cursor: pointer;
        flex-shrink: 0;
      }
      .cab-info { flex: 1; min-width: 0; }
      .cab-info h1 { font-size: 21px; font-weight: 800; letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .cab-info p { font-size: 13px; color: var(--tinta-suave); }
      .sync { display:inline-block; animation: girar 1s linear infinite; }
      @keyframes girar { to { transform: rotate(360deg); } }
      .btn-codigo {
        font-family: var(--mono); font-weight: 600; font-size: 13px; letter-spacing: .08em;
        background: var(--lima); border: 2px solid var(--tinta); color: var(--tinta);
        padding: 9px 12px; border-radius: 12px; cursor: pointer; flex-shrink: 0;
      }

      /* tabs */
      .tabs {
        display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px;
        background: var(--tarjeta); border: 1px solid var(--linea);
        border-radius: 14px; padding: 4px; margin-bottom: 18px;
      }
      .tab {
        border: none; background: transparent; font-family: var(--display);
        font-weight: 700; font-size: 14px; padding: 10px 4px; border-radius: 10px;
        color: var(--tinta-suave); cursor: pointer;
      }
      .tab.activa { background: var(--tinta); color: var(--lima); }

      /* recibo de gastos */
      .lista-gastos { list-style: none; padding: 0; background: var(--tarjeta);
        border: 1px solid var(--linea); border-radius: var(--radio); overflow: hidden; }
      .gasto {
        display: flex; align-items: center; gap: 12px; padding: 14px;
        border-bottom: 1px dashed var(--linea);
      }
      .gasto:last-child { border-bottom: none; }
      .g-emoji {
        width: 42px; height: 42px; border-radius: 12px; display: flex;
        align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0;
      }
      .g-info { flex: 1; min-width: 0; }
      .g-desc { display: block; font-weight: 700; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .g-meta { font-size: 12.5px; color: var(--tinta-suave); }
      .g-derecha { display: flex; align-items: center; gap: 8px; }
      .g-monto { font-family: var(--mono); font-weight: 600; font-size: 15px; }
      .g-borrar {
        border: none; background: transparent; color: var(--tinta-suave);
        font-size: 20px; cursor: pointer; padding: 2px 6px; border-radius: 8px;
      }
      .g-borrar:hover { color: var(--neg); background: #f6e5e0; }

      .vacio {
        background: var(--tarjeta); border: 1px dashed var(--linea); border-radius: var(--radio);
        padding: 28px 20px; text-align: center; color: var(--tinta-suave); font-size: 15px;
        line-height: 1.5;
      }

      /* saldos */
      .lista-saldos { list-style: none; padding: 0; background: var(--tarjeta);
        border: 1px solid var(--linea); border-radius: var(--radio); overflow: hidden; }
      .saldo { display: flex; justify-content: space-between; align-items: center;
        padding: 13px 16px; border-bottom: 1px solid var(--linea); }
      .saldo:last-child { border-bottom: none; }
      .s-nombre { font-weight: 700; font-size: 15px; }
      .s-nombre em { font-style: normal; color: var(--tinta-suave); font-weight: 500; font-size: 13px; }
      .s-valor { font-family: var(--mono); font-weight: 600; font-size: 15px; }
      .s-valor.pos { color: var(--pos); }
      .s-valor.neg { color: var(--neg); }
      .s-valor.cero { color: var(--tinta-suave); }

      .lista-pagos { list-style: none; padding: 0; display: grid; gap: 8px; }
      .pago {
        display: flex; justify-content: space-between; align-items: center;
        background: var(--tinta); color: #fff; border-radius: var(--radio); padding: 15px 16px;
      }
      .p-linea { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 15px; min-width: 0; flex-wrap: wrap; }
      .p-flecha { color: var(--lima); }
      .p-monto { font-family: var(--mono); font-weight: 600; font-size: 16px; color: var(--lima); flex-shrink: 0; }

      /* gráfico */
      .donut-wrap { display: flex; justify-content: center; padding: 6px 0 14px; }
      .donut { width: 210px; height: 210px; }
      .donut-total { font-family: var(--mono); font-weight: 600; font-size: 17px; fill: var(--tinta); }
      .donut-label { font-size: 11px; fill: var(--tinta-suave); }
      .leyenda { list-style: none; padding: 0; display: grid; gap: 10px;
        background: var(--tarjeta); border: 1px solid var(--linea);
        border-radius: var(--radio); padding: 16px; }
      .ley-item { display: grid; grid-template-columns: 12px auto 1fr auto; gap: 10px; align-items: center; }
      .ley-punto { width: 12px; height: 12px; border-radius: 4px; }
      .ley-nombre { font-weight: 700; font-size: 14px; white-space: nowrap; }
      .ley-barra { height: 8px; background: var(--papel); border-radius: 99px; overflow: hidden; }
      .ley-relleno { display: block; height: 100%; border-radius: 99px; }
      .ley-valor { font-family: var(--mono); font-size: 13px; font-weight: 600; text-align: right; }
      .ley-valor em { display: block; font-style: normal; color: var(--tinta-suave); font-size: 11px; }

      /* fab */
      .fab {
        position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%);
        background: var(--tinta); color: var(--lima); border: none;
        font-family: var(--display); font-weight: 800; font-size: 16px;
        padding: 16px 26px; border-radius: 99px; cursor: pointer;
        box-shadow: 0 8px 24px rgba(29,43,36,.28);
      }
      .fab:focus-visible { outline: 3px solid var(--lima); outline-offset: 2px; }

      /* hoja modal */
      .velo {
        position: fixed; inset: 0; background: rgba(29,43,36,.45);
        display: flex; align-items: flex-end; justify-content: center; z-index: 50;
      }
      .hoja {
        width: 100%; max-width: 480px; background: var(--papel);
        border-radius: 22px 22px 0 0; padding: 10px 18px 24px;
        max-height: 88vh; overflow-y: auto;
        animation: subir .22s ease;
      }
      @keyframes subir { from { transform: translateY(40px); opacity: .6; } }
      @media (prefers-reduced-motion: reduce) { .hoja { animation: none; } .sync { animation: none; } }
      .hoja-asa { width: 40px; height: 4px; background: var(--linea); border-radius: 99px; margin: 4px auto 14px; }
      .hoja-titulo { font-size: 20px; font-weight: 800; margin-bottom: 14px; }

      .form { display: grid; gap: 14px; }
      .campo { display: grid; gap: 6px; margin-bottom: 12px; }
      .campo > span { font-size: 13px; font-weight: 700; color: var(--tinta-suave); }
      .campo input, .campo select {
        font-family: var(--display); font-size: 16px; padding: 13px 14px;
        border: 1px solid var(--linea); border-radius: 12px; background: var(--tarjeta);
        color: var(--tinta); width: 100%;
      }
      .campo input:focus, .campo select:focus { outline: 3px solid var(--lima); border-color: var(--tinta); }
      .input-codigo, .input-monto { font-family: var(--mono); letter-spacing: .15em; font-weight: 600; }
      .input-monto { letter-spacing: .02em; font-size: 18px; }

      .chips { display: flex; flex-wrap: wrap; gap: 8px; }
      .chip {
        font-family: var(--display); font-size: 14px; font-weight: 700;
        padding: 8px 13px; border-radius: 99px; border: 1.5px solid var(--linea);
        background: var(--tarjeta); color: var(--tinta); cursor: pointer;
      }
      .chip.activo { color: #fff; }
      .chip.activo.oscuro { background: var(--tinta); border-color: var(--tinta); color: var(--lima); }

      .reparto {
        font-family: var(--mono); font-size: 14px; font-weight: 600;
        color: var(--pos); text-align: center; margin: 4px 0 8px;
      }
      .hoja-botones { display: grid; grid-template-columns: 1fr 1.4fr; gap: 10px; margin-top: 6px; }

      .toast {
        position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
        background: var(--tinta); color: var(--lima); font-weight: 700; font-size: 14px;
        padding: 11px 18px; border-radius: 99px; z-index: 99;
        box-shadow: 0 6px 20px rgba(29,43,36,.3); max-width: 90vw; text-align: center;
      }
    `}</style>
  );
}
