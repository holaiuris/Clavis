// ============================================================
// Link público de reservas. Dos formas de identificar el comercio:
//   - reservar.html?c=<peluquero_id> (el link "de toda la vida", uuid)
//   - reservar.html?slug=<slug> (lo que resuelve /r/<slug> vía rewrite
//     del hosting, ver vercel.json/DEPLOY.md — más lindo para compartir)
// Sin login: un cliente elige profesional, servicio y horario, y
// reserva directo. Ve solo lo que las políticas públicas permiten
// (ver migracion_v3.sql) — nunca datos de otros clientes.
// ============================================================

const db = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
const app = document.getElementById("reservar-app");

const urlParams = new URLSearchParams(location.search);

// Un rewrite (vercel.json: /r/:slug -> /reservar.html?slug=:slug) no
// cambia lo que el navegador ve en `location` — la pestaña sigue
// mostrando /r/<slug> tal cual, sin query string, así que
// location.search nunca trae ?slug=. Lo que SÍ sigue viéndose es el
// path original, así que si vinimos por /r/algo lo sacamos de ahí.
const slugDelPath = location.pathname.match(/^\/r\/([a-z0-9-]+)\/?$/i);

const state = {
  comercioId: urlParams.get("c"),
  slug: urlParams.get("slug") || (slugDelPath ? slugDelPath[1] : null),
  turnoGestionId: urlParams.get("turno"),
  turnoGestion: null,
  peluquero: null,
  profesionales: [],
  servicios: [],
  profesionalId: null,
  servicioId: null,
  fecha: todayISO(),
  huecos: [],
  huecoElegido: null,
  listaEsperaOk: false,
  error: null,
};

function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function todayISO() {
  return isoDate(new Date());
}
function hhmm(t) {
  return t ? t.slice(0, 5) : "";
}
function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Personaliza el link público con el color/logo/nombre que cargó el
// comercio en Horarios ("Marca del link público"). Si no configuró
// nada, queda el celeste y el wordmark de Clavis por defecto.
function aplicarMarca(peluquero) {
  document.title = `Reservar turno — ${peluquero.nombre}`;

  if (peluquero.color_acento && /^#[0-9a-f]{6}$/i.test(peluquero.color_acento)) {
    document.documentElement.style.setProperty("--accent", peluquero.color_acento);
  }
  if (peluquero.color_fondo && /^#[0-9a-f]{6}$/i.test(peluquero.color_fondo)) {
    document.documentElement.style.setProperty("--bg", peluquero.color_fondo);
  }

  const brand = document.getElementById("reservar-brand");
  if (peluquero.logo_url) {
    brand.innerHTML = `<img src="${escapeHtml(peluquero.logo_url)}" alt="${escapeHtml(peluquero.nombre)}" style="height:34px;width:auto;border-radius:6px;" />`;
  } else {
    // Sin logo propio: mostramos el nombre del comercio solo, sin el
    // isologo de Clavis — mezclar las dos marcas en la página de ESE
    // comercio confunde más de lo que suma.
    brand.innerHTML = `<span style="font-weight:800;font-size:18px;">${escapeHtml(peluquero.nombre)}</span>`;
  }
}

// reservar.html?turno=<id> — link para que el cliente gestione (vea/
// cancele) SU turno, sin login. El id del turno hace de contraseña
// (ver comentario en migracion_v10.sql) — no pasa por el flujo normal
// de reservar (no necesita saber de qué comercio es).
async function initGestionTurno() {
  try {
    const { data, error } = await db.rpc("obtener_turno_cliente", { p_turno_id: state.turnoGestionId });
    if (error) throw error;
    if (!data || !data.length) {
      app.innerHTML = `<h1>No encontramos este turno</h1><p class="hint">Puede que ya lo hayas cancelado, o que el link esté mal copiado.</p>`;
      return;
    }
    state.turnoGestion = data[0];
    renderGestionTurno();
  } catch (err) {
    console.error(err);
    app.innerHTML = `<h1>No se pudo cargar</h1><p class="error-msg">${escapeHtml(err.message || "Error inesperado")}</p>`;
  }
}

function renderGestionTurno() {
  const t = state.turnoGestion;
  const fechaLarga = new Date(`${t.fecha}T${t.hora_inicio}`).toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  app.innerHTML = `
    <h1>Tu turno en ${escapeHtml(t.comercio_nombre)}</h1>
    <p class="hint">${escapeHtml(t.servicio_nombre || "")}${t.profesional_nombre ? " con " + escapeHtml(t.profesional_nombre) : ""}<br/>${escapeHtml(fechaLarga)} · ${hhmm(t.hora_inicio)} - ${hhmm(t.hora_fin)}</p>
    <div class="actions">
      <button type="button" class="danger" id="btn-cancelar-turno">Cancelar turno</button>
    </div>
  `;
  document.getElementById("btn-cancelar-turno").addEventListener("click", renderConfirmarCancelacionTurno);
}

function renderConfirmarCancelacionTurno() {
  const t = state.turnoGestion;
  app.innerHTML = `
    <h1>¿Cancelar tu turno?</h1>
    <p class="hint">Esta acción no se puede deshacer. Le avisamos a ${escapeHtml(t.comercio_nombre)}.</p>
    <div class="actions">
      <button type="button" class="secondary" id="btn-volver-gestion">Volver</button>
      <button type="button" class="danger" id="btn-confirmar-cancelacion">Sí, cancelar</button>
    </div>
    <div class="error-msg" id="gestion-error"></div>
  `;
  document.getElementById("btn-volver-gestion").addEventListener("click", renderGestionTurno);
  document.getElementById("btn-confirmar-cancelacion").addEventListener("click", async (e) => {
    const btn = e.target;
    const errorEl = document.getElementById("gestion-error");
    btn.disabled = true;
    try {
      const { error } = await db.rpc("cancelar_turno_cliente", { p_turno_id: state.turnoGestionId });
      if (error) throw error;
      app.innerHTML = `<h1>Listo, tu turno quedó cancelado</h1><p class="hint">Le avisamos a ${escapeHtml(t.comercio_nombre)}.</p>`;
    } catch (err) {
      console.error(err);
      errorEl.textContent = err.message || "No se pudo cancelar";
      btn.disabled = false;
    }
  });
}

async function init() {
  if (state.turnoGestionId) return initGestionTurno();

  if (!state.comercioId && !state.slug) {
    app.innerHTML = `<h1>Link incompleto</h1><p class="hint">Este link no tiene el comercio identificado. Pedile al negocio que te pase el link completo.</p>`;
    return;
  }

  try {
    // peluqueros_publico (vista, migracion_v7.sql): solo lo que este
    // link necesita mostrar — telefono/plan/etc. del comercio NO están
    // acá a propósito, ver el comentario de la vista en la migración.
    const peluqueroRes = state.slug
      ? await db.from("peluqueros_publico").select("*").eq("slug", state.slug).maybeSingle()
      : await db.from("peluqueros_publico").select("*").eq("id", state.comercioId).maybeSingle();
    if (peluqueroRes.error) throw peluqueroRes.error;

    if (!peluqueroRes.data) {
      app.innerHTML = `<h1>No encontramos este comercio</h1><p class="hint">Puede que el link esté mal copiado.</p>`;
      return;
    }
    state.peluquero = peluqueroRes.data;
    state.comercioId = state.peluquero.id;
    aplicarMarca(state.peluquero);

    const [profesionalesRes, serviciosRes] = await Promise.all([
      db.from("profesionales").select("*").eq("peluquero_id", state.comercioId).eq("activo", true).order("creado_en"),
      db.from("servicios").select("*").eq("peluquero_id", state.comercioId).eq("activo", true).order("nombre"),
    ]);
    if (profesionalesRes.error) throw profesionalesRes.error;
    if (serviciosRes.error) throw serviciosRes.error;
    state.profesionales = profesionalesRes.data;
    state.servicios = serviciosRes.data;
    state.profesionalId = state.profesionales[0] ? state.profesionales[0].id : null;
    state.servicioId = state.servicios[0] ? state.servicios[0].id : null;

    if (state.profesionalId && state.servicioId) await cargarHuecos();
    render();
  } catch (err) {
    console.error(err);
    app.innerHTML = `<h1>No se pudo cargar</h1><p class="error-msg">${escapeHtml(err.message || "Error inesperado")}</p>`;
  }
}

async function cargarHuecos() {
  state.huecos = [];
  if (!state.profesionalId || !state.servicioId) return;
  const { data, error } = await db.rpc("generar_huecos_disponibles", {
    p_peluquero_id: state.comercioId,
    p_fecha: state.fecha,
    p_servicio_id: state.servicioId,
    p_profesional_id: state.profesionalId,
  });
  if (error) throw error;

  // Aviso mínimo: filtra del lado del cliente los huecos que arrancan
  // antes de esa cantidad de horas desde ahora. No es una medida de
  // seguridad (igual está protegido por el exclude constraint en la
  // base) — es solo para no dejar reservar "para dentro de 10 minutos".
  const avisoMs = (state.peluquero.aviso_minimo_horas || 0) * 60 * 60 * 1000;
  const limite = Date.now() + avisoMs;
  state.huecos = (data || []).filter((h) => new Date(`${state.fecha}T${h.hora_inicio}`).getTime() >= limite);
}

// Tira de días para elegir fecha — más intuitivo que un <input
// type="date"> pelado, y hace obvio que "probar otro día" es una
// opción antes de anotarse en la lista de espera.
function generarDiasStrip(cantidad) {
  const dias = [];
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  for (let i = 0; i < cantidad; i++) {
    const d = new Date(hoy);
    d.setDate(hoy.getDate() + i);
    const nombreDia = i === 0 ? "Hoy" : i === 1 ? "Mañana" : d.toLocaleDateString("es-AR", { weekday: "long" });
    dias.push({
      iso: isoDate(d),
      nombre: nombreDia.charAt(0).toUpperCase() + nombreDia.slice(1),
      diaMes: d.toLocaleDateString("es-AR", { day: "numeric", month: "short" }).replace(".", ""),
    });
  }
  return dias;
}

function render() {
  if (!state.profesionales.length || !state.servicios.length) {
    app.innerHTML = `
      <h1>Reservar en ${escapeHtml(state.peluquero.nombre)}</h1>
      <p class="hint">Este comercio todavía no tiene servicios o profesionales cargados para reservar online.</p>
    `;
    return;
  }

  const profesionalesOptions = state.profesionales
    .map((p) => `<option value="${p.id}" ${p.id === state.profesionalId ? "selected" : ""}>${escapeHtml(p.nombre)}</option>`)
    .join("");
  const serviciosOptions = state.servicios
    .map((s) => {
      const precio = s.precio ? ` — $${Number(s.precio).toLocaleString("es-AR")}` : "";
      return `<option value="${s.id}" ${s.id === state.servicioId ? "selected" : ""}>${escapeHtml(s.nombre)} (${s.duracion_minutos}')${precio}</option>`;
    })
    .join("");

  let huecosHtml;
  if (state.huecos.length) {
    huecosHtml = `<div class="huecos-grid">${state.huecos
      .map((h) => `<button type="button" class="hueco-btn" data-inicio="${h.hora_inicio}" data-fin="${h.hora_fin}">${hhmm(h.hora_inicio)}</button>`)
      .join("")}</div>`;
  } else if (state.listaEsperaOk) {
    huecosHtml = `<p class="hint">Listo, te anotamos. Si se libera algo ese día te avisamos por WhatsApp.</p>`;
  } else {
    huecosHtml = `
      <p class="hint">No hay huecos libres para el día que elegiste arriba — probá otro día.</p>
      <div class="espera-cta">
        <p class="hint" style="margin:0 0 6px;">¿Ya probaste otros días y ninguno te sirve?</p>
        <form id="espera-form">
          <input type="text" id="espera-nombre" placeholder="Tu nombre" required />
          <input type="tel" id="espera-telefono" placeholder="Tu teléfono" required style="margin-top:6px;" />
          <button type="submit" class="secondary" id="espera-submit">Avisame si se libera algo</button>
          <div class="error-msg" id="espera-error"></div>
        </form>
      </div>
    `;
  }

  const diasStrip = generarDiasStrip(21);
  const diasStripHtml = diasStrip
    .map(
      (d) => `
    <button type="button" class="dia-pill ${d.iso === state.fecha ? "active" : ""}" data-fecha="${d.iso}">
      <span class="dia-pill-nombre">${escapeHtml(d.nombre)}</span>
      <span class="dia-pill-num">${escapeHtml(d.diaMes)}</span>
    </button>`
    )
    .join("");

  app.innerHTML = `
    <h1>Reservar en ${escapeHtml(state.peluquero.nombre)}</h1>
    <p class="hint">Elegí profesional, servicio y día.</p>
    <form id="filtros-form" onsubmit="return false">
      <div>
        <label>Profesional</label>
        <select id="sel-profesional">${profesionalesOptions}</select>
      </div>
      <div>
        <label>Servicio</label>
        <select id="sel-servicio">${serviciosOptions}</select>
      </div>
    </form>
    <div style="margin-top:16px;">
      <label>¿Qué día?</label>
      <div class="dias-strip">${diasStripHtml}</div>
      <p class="hint" style="margin:6px 0 0;">
        ¿Buscás una fecha más lejana? <a href="#" id="otra-fecha-link">Elegí del calendario</a>
        <input type="date" id="sel-fecha" value="${state.fecha}" min="${todayISO()}" style="display:none; margin-top:6px;" />
      </p>
    </div>
    <div style="margin-top:16px;">
      <label>Horarios disponibles</label>
      ${huecosHtml}
    </div>
    ${state.error ? `<p class="error-msg">${escapeHtml(state.error)}</p>` : ""}
  `;

  document.querySelectorAll(".dia-pill").forEach((btn) => {
    btn.addEventListener("click", async () => {
      state.fecha = btn.dataset.fecha;
      await refrescar();
    });
  });
  document.getElementById("otra-fecha-link").addEventListener("click", (e) => {
    e.preventDefault();
    const input = document.getElementById("sel-fecha");
    input.style.display = "block";
    input.focus();
    if (input.showPicker) input.showPicker();
  });
  document.getElementById("sel-profesional").addEventListener("change", async (e) => {
    state.profesionalId = e.target.value;
    await refrescar();
  });
  document.getElementById("sel-servicio").addEventListener("change", async (e) => {
    state.servicioId = e.target.value;
    await refrescar();
  });
  document.getElementById("sel-fecha").addEventListener("change", async (e) => {
    state.fecha = e.target.value;
    await refrescar();
  });
  document.querySelectorAll(".hueco-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.huecoElegido = { hora_inicio: btn.dataset.inicio, hora_fin: btn.dataset.fin };
      renderConfirmacion();
    });
  });

  const esperaForm = document.getElementById("espera-form");
  if (esperaForm) {
    esperaForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const errorEl = document.getElementById("espera-error");
      const submitBtn = esperaForm.querySelector("button[type=submit]");
      submitBtn.disabled = true;
      try {
        const { error } = await db.from("lista_espera").insert({
          peluquero_id: state.comercioId,
          profesional_id: state.profesionalId,
          servicio_id: state.servicioId,
          fecha: state.fecha,
          cliente_nombre: document.getElementById("espera-nombre").value.trim(),
          cliente_telefono: document.getElementById("espera-telefono").value.trim(),
        });
        if (error) throw error;
        state.listaEsperaOk = true;
        render();
      } catch (err) {
        console.error(err);
        errorEl.textContent = err.message || "No se pudo anotar";
        submitBtn.disabled = false;
      }
    });
  }
}

async function refrescar() {
  state.error = null;
  state.listaEsperaOk = false;
  try {
    await cargarHuecos();
  } catch (err) {
    console.error(err);
    state.error = err.message || "No se pudo cargar la disponibilidad";
  }
  render();
}

function renderConfirmacion() {
  const h = state.huecoElegido;
  const servicio = state.servicios.find((s) => s.id === state.servicioId);
  const profesional = state.profesionales.find((p) => p.id === state.profesionalId);
  const fechaLarga = new Date(state.fecha + "T00:00:00").toLocaleDateString("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const precioTexto = servicio && servicio.precio ? ` · $${Number(servicio.precio).toLocaleString("es-AR")}` : "";

  app.innerHTML = `
    <h1>Confirmá tu turno</h1>
    <p class="hint">${escapeHtml(servicio ? servicio.nombre : "")} con ${escapeHtml(profesional ? profesional.nombre : "")}${precioTexto}<br/>${escapeHtml(fechaLarga)} · ${hhmm(h.hora_inicio)} - ${hhmm(h.hora_fin)}</p>
    <form id="confirmar-form">
      <div>
        <label>Tu nombre</label>
        <input type="text" id="cli-nombre" required />
      </div>
      <div>
        <label>Tu teléfono</label>
        <input type="tel" id="cli-telefono" required placeholder="Para avisarte si el comercio cancela o mueve tu turno" />
      </div>
      <div class="hp-field" aria-hidden="true">
        <label for="cli-empresa">No completar</label>
        <input type="text" id="cli-empresa" name="empresa" tabindex="-1" autocomplete="off" />
      </div>
      <div class="actions">
        <button type="button" class="secondary" id="cli-volver">Volver</button>
        <button type="submit">Confirmar turno</button>
      </div>
      <div class="error-msg" id="confirmar-error"></div>
    </form>
  `;

  document.getElementById("cli-volver").addEventListener("click", () => {
    state.huecoElegido = null;
    render();
  });

  document.getElementById("confirmar-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    // Honeypot: un campo invisible para humanos (ver CSS .hp-field) que
    // los bots de formularios suelen completar igual. Si tiene algo,
    // cortamos en silencio — sin error, para no darle pistas al bot.
    if (document.getElementById("cli-empresa").value.trim()) return;
    const errorEl = document.getElementById("confirmar-error");
    const submitBtn = e.target.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    try {
      const { error } = await db.from("turnos").insert({
        peluquero_id: state.comercioId,
        profesional_id: state.profesionalId,
        servicio_id: state.servicioId,
        fecha: state.fecha,
        hora_inicio: h.hora_inicio,
        hora_fin: h.hora_fin,
        estado: "ocupado",
        origen: "web",
        cliente_nombre: document.getElementById("cli-nombre").value.trim(),
        cliente_telefono: document.getElementById("cli-telefono").value.trim(),
      });
      if (error) throw error;
      renderExito(fechaLarga);
    } catch (err) {
      console.error(err);
      errorEl.textContent =
        err.code === "23P01" ? "Justo se ocupó ese horario. Volvé y elegí otro." : err.message || "No se pudo reservar";
      submitBtn.disabled = false;
    }
  });
}

function renderExito(fechaLarga) {
  const h = state.huecoElegido;
  app.innerHTML = `
    <h1>¡Listo!</h1>
    <p class="hint">Tu turno quedó reservado para ${escapeHtml(fechaLarga)} a las ${hhmm(h.hora_inicio)}.</p>
    <p class="hint">${state.peluquero ? escapeHtml(state.peluquero.nombre) : ""} te espera. Si necesitás cambiarlo, contactalos directamente.</p>
  `;
}

init();
