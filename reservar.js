// ============================================================
// Link público de reservas (reservar.html?c=<peluquero_id>).
// Sin login: un cliente elige profesional, servicio y horario, y
// reserva directo. Ve solo lo que las políticas públicas permiten
// (ver migracion_v3.sql) — nunca datos de otros clientes.
// ============================================================

const db = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
const app = document.getElementById("reservar-app");

const state = {
  comercioId: new URLSearchParams(location.search).get("c"),
  peluquero: null,
  profesionales: [],
  servicios: [],
  profesionalId: null,
  servicioId: null,
  fecha: todayISO(),
  huecos: [],
  huecoElegido: null,
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

  const brand = document.getElementById("reservar-brand");
  if (peluquero.logo_url) {
    brand.innerHTML = `<img src="${escapeHtml(peluquero.logo_url)}" alt="${escapeHtml(peluquero.nombre)}" style="height:34px;width:auto;border-radius:6px;" />`;
  } else {
    brand.innerHTML = `<span class="brand-mark"></span>${escapeHtml(peluquero.nombre)}`;
  }
}

async function init() {
  if (!state.comercioId) {
    app.innerHTML = `<h1>Link incompleto</h1><p class="hint">Este link no tiene el comercio identificado. Pedile al negocio que te pase el link completo.</p>`;
    return;
  }

  try {
    const [peluqueroRes, profesionalesRes, serviciosRes] = await Promise.all([
      db.from("peluqueros").select("id, nombre, aviso_minimo_horas, color_acento, logo_url").eq("id", state.comercioId).maybeSingle(),
      db.from("profesionales").select("*").eq("peluquero_id", state.comercioId).eq("activo", true).order("creado_en"),
      db.from("servicios").select("*").eq("peluquero_id", state.comercioId).eq("activo", true).order("nombre"),
    ]);
    if (peluqueroRes.error) throw peluqueroRes.error;
    if (profesionalesRes.error) throw profesionalesRes.error;
    if (serviciosRes.error) throw serviciosRes.error;

    if (!peluqueroRes.data) {
      app.innerHTML = `<h1>No encontramos este comercio</h1><p class="hint">Puede que el link esté mal copiado.</p>`;
      return;
    }
    state.peluquero = peluqueroRes.data;
    aplicarMarca(state.peluquero);
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
    .map((s) => `<option value="${s.id}" ${s.id === state.servicioId ? "selected" : ""}>${escapeHtml(s.nombre)} (${s.duracion_minutos}')</option>`)
    .join("");

  const huecosHtml = state.huecos.length
    ? `<div class="huecos-grid">${state.huecos
        .map((h) => `<button type="button" class="hueco-btn" data-inicio="${h.hora_inicio}" data-fin="${h.hora_fin}">${hhmm(h.hora_inicio)}</button>`)
        .join("")}</div>`
    : `<p class="hint">No hay huecos libres para esa fecha. Probá otro día.</p>`;

  app.innerHTML = `
    <h1>Reservar en ${escapeHtml(state.peluquero.nombre)}</h1>
    <p class="hint">Elegí profesional, servicio y horario.</p>
    <form id="filtros-form" onsubmit="return false">
      <div>
        <label>Profesional</label>
        <select id="sel-profesional">${profesionalesOptions}</select>
      </div>
      <div>
        <label>Servicio</label>
        <select id="sel-servicio">${serviciosOptions}</select>
      </div>
      <div>
        <label>Fecha</label>
        <input type="date" id="sel-fecha" value="${state.fecha}" min="${todayISO()}" />
      </div>
    </form>
    <div style="margin-top:16px;">
      <label>Horarios disponibles</label>
      ${huecosHtml}
    </div>
    ${state.error ? `<p class="error-msg">${escapeHtml(state.error)}</p>` : ""}
  `;

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
}

async function refrescar() {
  state.error = null;
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

  app.innerHTML = `
    <h1>Confirmá tu turno</h1>
    <p class="hint">${escapeHtml(servicio ? servicio.nombre : "")} con ${escapeHtml(profesional ? profesional.nombre : "")}<br/>${escapeHtml(fechaLarga)} · ${hhmm(h.hora_inicio)} - ${hhmm(h.hora_fin)}</p>
    <form id="confirmar-form">
      <div>
        <label>Tu nombre</label>
        <input type="text" id="cli-nombre" required />
      </div>
      <div>
        <label>Tu teléfono (opcional)</label>
        <input type="tel" id="cli-telefono" />
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
        cliente_telefono: document.getElementById("cli-telefono").value.trim() || null,
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
