/* ============================================================
   BOTE — frontend (vanilla JS, sin build)
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

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

/* ---------- estado ---------- */
const S = {
  vista: "cargando", // inicio | crear | unirse | grupo
  grupo: null,
  codigo: null,
  miembroId: null,
  tab: "gastos",
  hoja: null, // estado del formulario de gasto, o null
  sync: false,
  codigoPrevio: "", // para prellenar "unirse" desde un enlace /g/CODE
};

const $app = document.getElementById("app");
let pollTimer = null;

/* ---------- persistencia local (solo mi identidad por grupo) ---------- */
const misGrupos = () => JSON.parse(localStorage.getItem("bote:misGrupos") || "[]");
const guardarMisGrupos = (lista) => localStorage.setItem("bote:misGrupos", JSON.stringify(lista));

/* ---------- API ---------- */
async function api(ruta, opts = {}) {
  const res = await fetch(`/api${ruta}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Algo salió mal. Inténtalo de nuevo.");
  return data;
}

/* ---------- cálculo de saldos y simplificación ---------- */
function calcSaldos(grupo) {
  const bal = {};
  grupo.miembros.forEach((m) => (bal[m.id] = 0));
  for (const g of grupo.gastos) {
    const parts = (g.participantes || []).filter((id) => bal[id] !== undefined);
    if (!parts.length || bal[g.pagadorId] === undefined) continue;
    const cuota = g.monto / parts.length;
    bal[g.pagadorId] += g.monto;
    parts.forEach((id) => (bal[id] -= cuota));
  }
  return bal;
}

// Greedy: el mayor deudor paga al mayor acreedor → mínimo nº de bizums
function simplificar(bal) {
  const deudores = [], acreedores = [];
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

/* ---------- toast ---------- */
function toast(msg) {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

/* ---------- navegación ---------- */
function ir(vista) {
  S.vista = vista;
  if (vista !== "grupo") detenerPoll();
  render();
}

async function abrirGrupo(codigo, miembroId) {
  S.vista = "cargando";
  render();
  try {
    const grupo = await api(`/grupos/${codigo}`);
    S.grupo = grupo;
    S.codigo = grupo.codigo;
    S.miembroId = miembroId;
    S.tab = "gastos";
    S.vista = "grupo";
    history.replaceState(null, "", `/g/${grupo.codigo}`);
    iniciarPoll();
  } catch (e) {
    toast(e.message);
    S.vista = "inicio";
  }
  render();
}

function volverInicio() {
  history.replaceState(null, "", "/");
  ir("inicio");
}

/* ---------- sincronización ---------- */
function iniciarPoll() {
  detenerPoll();
  pollTimer = setInterval(refrescar, 10000);
}
function detenerPoll() {
  clearInterval(pollTimer);
  pollTimer = null;
}
async function refrescar() {
  if (S.vista !== "grupo" || !S.codigo) return;
  try {
    S.sync = true;
    renderSync();
    const grupo = await api(`/grupos/${S.codigo}`);
    S.grupo = grupo;
    if (!S.hoja) render(); // no pisar el formulario abierto
  } catch {
    /* sin conexión: se reintenta en el siguiente ciclo */
  } finally {
    S.sync = false;
    renderSync();
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refrescar();
});

function renderSync() {
  const el = document.querySelector(".sync");
  if (el) el.style.display = S.sync ? "inline-block" : "none";
}

/* ---------- acciones ---------- */
async function crearGrupo(nombre, miNombre) {
  try {
    const { codigo, miembroId } = await api("/grupos", {
      method: "POST",
      body: { nombre, miNombre },
    });
    guardarMisGrupos([...misGrupos(), { codigo, nombre, miembroId }]);
    toast(`Grupo creado · código ${codigo}`);
    abrirGrupo(codigo, miembroId);
  } catch (e) {
    toast(e.message);
  }
}

async function unirse(codigo, miNombre) {
  codigo = codigo.trim().toUpperCase();
  const previo = misGrupos().find((g) => g.codigo === codigo);
  if (previo) return abrirGrupo(codigo, previo.miembroId);
  try {
    const { miembroId, grupo } = await api(`/grupos/${codigo}/miembros`, {
      method: "POST",
      body: { nombre: miNombre },
    });
    guardarMisGrupos([
      ...misGrupos().filter((g) => g.codigo !== codigo),
      { codigo, nombre: grupo.nombre, miembroId },
    ]);
    abrirGrupo(codigo, miembroId);
  } catch (e) {
    toast(e.message);
  }
}

async function agregarGasto(gasto) {
  try {
    const { grupo } = await api(`/grupos/${S.codigo}/gastos`, {
      method: "POST",
      body: gasto,
    });
    S.grupo = grupo;
    S.hoja = null;
    toast("Gasto añadido");
    render();
  } catch (e) {
    toast(e.message);
  }
}

async function borrarGasto(id) {
  if (!confirm("¿Borrar este gasto para todo el grupo?")) return;
  try {
    const { grupo } = await api(`/grupos/${S.codigo}/gastos/${id}`, { method: "DELETE" });
    S.grupo = grupo;
    render();
  } catch (e) {
    toast(e.message);
  }
}

function compartir() {
  const url = `${location.origin}/g/${S.codigo}`;
  const texto = `Únete a nuestro bote "${S.grupo.nombre}" para dividir los gastos del viaje: ${url} (código ${S.codigo})`;
  if (navigator.share) {
    navigator.share({ title: `bote. — ${S.grupo.nombre}`, text: texto, url }).catch(() => {});
  } else if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(texto).then(
      () => toast("Enlace de invitación copiado"),
      () => toast(`Código: ${S.codigo} · ${url}`)
    );
  } else {
    toast(`Código: ${S.codigo} · ${url}`);
  }
}

/* ---------- vistas ---------- */
function vInicio() {
  const grupos = misGrupos();
  return `
    <main class="pantalla">
      <header class="hero">
        <div class="logo">bote<span class="logo-punto">.</span></div>
        <p class="claim">Divide los gastos del viaje sin descargar nada y sin crear cuentas. Un código, un grupo, cuentas claras.</p>
      </header>
      <div class="acciones-inicio">
        <button class="btn primario" data-accion="ir-crear">Crear un grupo</button>
        <button class="btn secundario" data-accion="ir-unirse">Unirme con un código</button>
      </div>
      ${grupos.length ? `
        <section>
          <h2 class="titulo-seccion">Mis grupos</h2>
          <ul class="lista-grupos">
            ${grupos.map((g) => `
              <li>
                <button class="tarjeta-grupo" data-accion="abrir" data-codigo="${esc(g.codigo)}" data-miembro="${esc(g.miembroId)}">
                  <span class="tg-nombre">${esc(g.nombre)}</span>
                  <span class="tg-codigo">${esc(g.codigo)}</span>
                </button>
              </li>`).join("")}
          </ul>
        </section>` : ""}
      <p class="nota-pie">Los gastos del grupo los ve cualquiera que tenga el código o el enlace. No incluyas información sensible.</p>
    </main>`;
}

function vFormulario({ titulo, textoBoton, pideNombreGrupo, pideCodigo }) {
  return `
    <main class="pantalla">
      <header class="cab-grupo">
        <button class="volver" data-accion="volver" aria-label="Volver">←</button>
        <div class="cab-info"><h1>${titulo}</h1></div>
      </header>
      <form class="form" id="form-nuevo">
        ${pideNombreGrupo ? `
          <label class="campo">
            <span>Nombre del grupo</span>
            <input name="campo1" placeholder="Viaje a Lisboa" maxlength="40" required />
          </label>` : ""}
        ${pideCodigo ? `
          <label class="campo">
            <span>Código del grupo</span>
            <input name="campo1" class="input-codigo" placeholder="ABC123" maxlength="6"
                   autocapitalize="characters" value="${esc(S.codigoPrevio)}" required />
          </label>` : ""}
        <label class="campo">
          <span>Tu nombre</span>
          <input name="miNombre" placeholder="María" maxlength="24" required />
        </label>
        <button class="btn primario" type="submit">${textoBoton}</button>
        ${pideCodigo ? `<p class="nota-pie">Pide el código de 6 letras (o el enlace) a quien creó el grupo. Si ya entraste antes con el mismo nombre, recuperarás tu sitio.</p>` : ""}
      </form>
    </main>`;
}

function vGrupo() {
  const g = S.grupo;
  const total = g.gastos.reduce((s, x) => s + x.monto, 0);
  return `
    <main class="pantalla">
      <header class="cab-grupo">
        <button class="volver" data-accion="volver" aria-label="Volver">←</button>
        <div class="cab-info">
          <h1>${esc(g.nombre)}</h1>
          <p>${g.miembros.length} persona${g.miembros.length !== 1 ? "s" : ""} · ${eur(total)} en total <span class="sync" style="display:none">↻</span></p>
        </div>
        <button class="btn-codigo" data-accion="compartir" title="Compartir enlace de invitación">${esc(S.codigo)} ⧉</button>
      </header>

      <nav class="tabs" role="tablist">
        ${[["gastos", "Gastos"], ["saldos", "Saldos"], ["grafico", "Gráfico"]]
          .map(([id, label]) =>
            `<button role="tab" aria-selected="${S.tab === id}" class="tab${S.tab === id ? " activa" : ""}" data-accion="tab" data-tab="${id}">${label}</button>`
          ).join("")}
      </nav>

      ${S.tab === "gastos" ? vTabGastos(g) : S.tab === "saldos" ? vTabSaldos(g) : vTabGrafico(g, total)}

      <button class="fab" data-accion="abrir-hoja">+ Añadir gasto</button>
    </main>
    ${S.hoja ? vHojaGasto(g) : ""}`;
}

function vTabGastos(g) {
  if (!g.gastos.length)
    return `<div class="vacio">Todavía no hay gastos. Añade el primero con el botón de abajo y marca quién participa.</div>`;
  const nombreDe = (id) => g.miembros.find((m) => m.id === id)?.nombre || "¿?";
  return `
    <ul class="lista-gastos">
      ${[...g.gastos].reverse().map((x) => {
        const c = catDe(x.categoria);
        return `
          <li class="gasto">
            <span class="g-emoji" style="background:${c.color}22">${c.emoji}</span>
            <div class="g-info">
              <span class="g-desc">${esc(x.desc)}</span>
              <span class="g-meta">${esc(nombreDe(x.pagadorId))} pagó · ${x.participantes.length} part.</span>
            </div>
            <div class="g-derecha">
              <span class="g-monto">${eur(x.monto)}</span>
              <button class="g-borrar" data-accion="borrar-gasto" data-id="${esc(x.id)}" aria-label="Borrar ${esc(x.desc)}">×</button>
            </div>
          </li>`;
      }).join("")}
    </ul>`;
}

function vTabSaldos(g) {
  const saldos = calcSaldos(g);
  const pagos = simplificar(saldos);
  const nombreDe = (id) => g.miembros.find((m) => m.id === id)?.nombre || "¿?";
  return `
    <section>
      <h2 class="titulo-seccion">Saldo de cada persona</h2>
      <ul class="lista-saldos">
        ${g.miembros.map((m) => {
          const v = saldos[m.id] || 0;
          const clase = v > 0.005 ? "pos" : v < -0.005 ? "neg" : "cero";
          return `
            <li class="saldo">
              <span class="s-nombre">${esc(m.nombre)}${m.id === S.miembroId ? "<em> (tú)</em>" : ""}</span>
              <span class="s-valor ${clase}">${v > 0.005 ? "+" : ""}${eur(v)}</span>
            </li>`;
        }).join("")}
      </ul>

      <h2 class="titulo-seccion espacio">Bizums sugeridos <span class="pill">${pagos.length}</span></h2>
      ${!pagos.length
        ? `<div class="vacio">Todo cuadra: nadie debe nada a nadie. 🎉</div>`
        : `<ul class="lista-pagos">
            ${pagos.map((p) => `
              <li class="pago">
                <div class="p-linea">
                  <span>${esc(nombreDe(p.de))}</span>
                  <span class="p-flecha">→</span>
                  <span>${esc(nombreDe(p.a))}</span>
                </div>
                <span class="p-monto">${eur(p.monto)}</span>
              </li>`).join("")}
          </ul>`}
      <p class="nota-pie">Calculado para que hagáis el mínimo número de transferencias posible.</p>
    </section>`;
}

function vTabGrafico(g, total) {
  if (!total) return `<div class="vacio">Añade gastos para ver en qué se va el dinero.</div>`;
  const map = {};
  g.gastos.forEach((x) => (map[x.categoria] = (map[x.categoria] || 0) + x.monto));
  const datos = CATEGORIAS.filter((c) => map[c.id] > 0)
    .map((c) => ({ ...c, total: map[c.id] }))
    .sort((a, b) => b.total - a.total);

  const R = 62, C = 2 * Math.PI * R;
  let offset = 0;
  const arcos = datos.map((d) => {
    const frac = d.total / total;
    const s = `<circle cx="80" cy="80" r="${R}" fill="none" stroke="${d.color}" stroke-width="18"
      stroke-dasharray="${frac * C} ${C}" stroke-dashoffset="${-offset * C}" transform="rotate(-90 80 80)"/>`;
    offset += frac;
    return s;
  }).join("");

  return `
    <section>
      <div class="donut-wrap">
        <svg viewBox="0 0 160 160" class="donut" role="img" aria-label="Gasto por categoría">
          <circle cx="80" cy="80" r="${R}" fill="none" stroke="var(--linea)" stroke-width="18"/>
          ${arcos}
          <text x="80" y="74" text-anchor="middle" class="donut-total">${eur(total)}</text>
          <text x="80" y="94" text-anchor="middle" class="donut-label">total</text>
        </svg>
      </div>
      <ul class="leyenda">
        ${datos.map((c) => `
          <li class="ley-item">
            <span class="ley-punto" style="background:${c.color}"></span>
            <span class="ley-nombre">${c.emoji} ${c.nombre}</span>
            <span class="ley-barra"><span class="ley-relleno" style="width:${(c.total / total) * 100}%;background:${c.color}"></span></span>
            <span class="ley-valor">${eur(c.total)}<em>${Math.round((c.total / total) * 100)}%</em></span>
          </li>`).join("")}
      </ul>
    </section>`;
}

function vHojaGasto(g) {
  const h = S.hoja;
  const montoNum = parseFloat(String(h.monto).replace(",", "."));
  const valido = h.desc.trim() && montoNum > 0 && h.parts.length > 0 && h.pagador;
  return `
    <div class="velo" data-accion="cerrar-hoja">
      <div class="hoja" data-detener>
        <div class="hoja-asa"></div>
        <h2 class="hoja-titulo">Nuevo gasto</h2>

        <label class="campo">
          <span>¿Qué fue?</span>
          <input id="h-desc" value="${esc(h.desc)}" placeholder="Cena en la playa" maxlength="60" />
        </label>

        <label class="campo">
          <span>Importe (€)</span>
          <input id="h-monto" class="input-monto" value="${esc(h.monto)}" placeholder="42,50" inputmode="decimal" />
        </label>

        <div class="campo">
          <span>Categoría</span>
          <div class="chips">
            ${CATEGORIAS.map((c) => `
              <button type="button" class="chip${h.cat === c.id ? " activo" : ""}"
                style="${h.cat === c.id ? `background:${c.color};border-color:${c.color}` : ""}"
                data-accion="h-cat" data-cat="${c.id}">${c.emoji} ${c.nombre}</button>`).join("")}
          </div>
        </div>

        <label class="campo">
          <span>¿Quién pagó?</span>
          <select id="h-pagador">
            ${g.miembros.map((m) => `
              <option value="${esc(m.id)}" ${h.pagador === m.id ? "selected" : ""}>
                ${esc(m.nombre)}${m.id === S.miembroId ? " (tú)" : ""}
              </option>`).join("")}
          </select>
        </label>

        <div class="campo">
          <span>¿Quién participa? (${h.parts.length})</span>
          <div class="chips">
            ${g.miembros.map((m) => `
              <button type="button" class="chip${h.parts.includes(m.id) ? " activo oscuro" : ""}"
                data-accion="h-part" data-id="${esc(m.id)}">${esc(m.nombre)}</button>`).join("")}
          </div>
        </div>

        <p class="reparto">${valido ? `${eur(montoNum / h.parts.length)} por persona` : ""}</p>

        <div class="hoja-botones">
          <button class="btn secundario" data-accion="cerrar-hoja">Cancelar</button>
          <button class="btn primario" data-accion="guardar-gasto" ${valido ? "" : "disabled"}>Guardar gasto</button>
        </div>
      </div>
    </div>`;
}

/* ---------- render + eventos ---------- */
function render() {
  switch (S.vista) {
    case "cargando":
      $app.innerHTML = `<div class="centrado suave">Abriendo el bote…</div>`;
      break;
    case "inicio":
      $app.innerHTML = vInicio();
      break;
    case "crear":
      $app.innerHTML = vFormulario({ titulo: "Crear grupo", textoBoton: "Crear el bote", pideNombreGrupo: true });
      break;
    case "unirse":
      $app.innerHTML = vFormulario({ titulo: "Unirme a un grupo", textoBoton: "Entrar al bote", pideCodigo: true });
      break;
    case "grupo":
      $app.innerHTML = vGrupo();
      break;
  }
}

// lee los inputs del formulario de gasto sin re-renderizar (para no perder el foco)
function sincronizarHoja() {
  if (!S.hoja) return;
  S.hoja.desc = document.getElementById("h-desc")?.value ?? S.hoja.desc;
  S.hoja.monto = document.getElementById("h-monto")?.value ?? S.hoja.monto;
  S.hoja.pagador = document.getElementById("h-pagador")?.value ?? S.hoja.pagador;
}

document.addEventListener("input", (e) => {
  if (!S.hoja) return;
  if (["h-desc", "h-monto"].includes(e.target.id)) {
    sincronizarHoja();
    // actualizar solo el reparto y el botón, sin re-render completo
    const montoNum = parseFloat(String(S.hoja.monto).replace(",", "."));
    const valido = S.hoja.desc.trim() && montoNum > 0 && S.hoja.parts.length > 0;
    const rep = document.querySelector(".reparto");
    if (rep) rep.textContent = valido ? `${eur(montoNum / S.hoja.parts.length)} por persona` : "";
    const btn = document.querySelector('[data-accion="guardar-gasto"]');
    if (btn) btn.disabled = !valido;
  }
});

document.addEventListener("change", (e) => {
  if (S.hoja && e.target.id === "h-pagador") sincronizarHoja();
});

document.addEventListener("submit", (e) => {
  if (e.target.id !== "form-nuevo") return;
  e.preventDefault();
  const f = new FormData(e.target);
  const campo1 = (f.get("campo1") || "").toString().trim();
  const miNombre = (f.get("miNombre") || "").toString().trim();
  if (!campo1 || !miNombre) return;
  if (S.vista === "crear") crearGrupo(campo1, miNombre);
  else unirse(campo1, miNombre);
});

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-accion]");
  // cerrar la hoja al tocar el velo, pero no al tocar dentro
  if (!el) return;
  if (el.dataset.accion === "cerrar-hoja" && e.target.closest("[data-detener]") && el.classList.contains("velo")) return;

  switch (el.dataset.accion) {
    case "ir-crear": ir("crear"); break;
    case "ir-unirse": S.codigoPrevio = ""; ir("unirse"); break;
    case "volver": volverInicio(); break;
    case "abrir": abrirGrupo(el.dataset.codigo, el.dataset.miembro); break;
    case "compartir": compartir(); break;
    case "tab": S.tab = el.dataset.tab; render(); break;
    case "abrir-hoja":
      S.hoja = {
        desc: "", monto: "", cat: "comida",
        pagador: S.miembroId || S.grupo.miembros[0]?.id,
        parts: S.grupo.miembros.map((m) => m.id),
      };
      render();
      document.getElementById("h-desc")?.focus();
      break;
    case "cerrar-hoja": S.hoja = null; render(); break;
    case "h-cat": sincronizarHoja(); S.hoja.cat = el.dataset.cat; render(); break;
    case "h-part": {
      sincronizarHoja();
      const id = el.dataset.id;
      S.hoja.parts = S.hoja.parts.includes(id)
        ? S.hoja.parts.filter((x) => x !== id)
        : [...S.hoja.parts, id];
      render();
      break;
    }
    case "guardar-gasto": {
      sincronizarHoja();
      const montoNum = parseFloat(String(S.hoja.monto).replace(",", "."));
      if (!(S.hoja.desc.trim() && montoNum > 0 && S.hoja.parts.length)) return;
      agregarGasto({
        desc: S.hoja.desc.trim(),
        monto: montoNum,
        categoria: S.hoja.cat,
        pagadorId: S.hoja.pagador,
        participantes: S.hoja.parts,
      });
      break;
    }
    case "borrar-gasto": borrarGasto(el.dataset.id); break;
  }
});

/* ---------- arranque ---------- */
(function iniciar() {
  const m = location.pathname.match(/^\/g\/([A-Za-z0-9]{6})$/);
  if (m) {
    const codigo = m[1].toUpperCase();
    const previo = misGrupos().find((g) => g.codigo === codigo);
    if (previo) return abrirGrupo(codigo, previo.miembroId);
    S.codigoPrevio = codigo;
    return ir("unirse");
  }
  ir("inicio");
})();
