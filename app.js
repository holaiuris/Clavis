// ============================================================
// Clavis — lógica de la app: auth, fetch de datos, agenda, modales.
// Vanilla JS, sin build step. Toda la disponibilidad se calcula en
// SQL (generar_huecos_disponibles) — acá solo se pinta y se manda
// a guardar lo que el usuario carga.
// ============================================================

const db = window.supabase.createClient(
  window.SUPABASE_URL,
  window.SUPABASE_ANON_KEY
);

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const DIAS_ORDEN = [1, 2, 3, 4, 5, 6, 0]; // lunes primero, como en la UI de Horarios
const DIAS_LETRA = ["D", "L", "M", "X", "J", "V", "S"]; // index = getDay()

const state = {
  session: null,
  peluquero: null,
  servicios: [],
  horarios: [],
  profesionales: [],
  fecha: todayISO(),
  servicioId: null,
  profesionalId: null,
  huecos: [],
  turnos: [],
  agendaFiltro: "todos", // todos | confirmado | atendido | ausente | bloqueado
  view: "agenda", // agenda | metricas | horarios
  metricas: null,
  horariosWeekCounts: {},
  loading: false,
  error: null,
};

const app = document.getElementById("app");

function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayISO() {
  return isoDate(new Date());
}

function mondayOf(d) {
  const monday = new Date(d);
  const dow = monday.getDay();
  monday.setDate(monday.getDate() + (dow === 0 ? -6 : 1 - dow));
  return monday;
}

function hhmm(t) {
  return t ? t.slice(0, 5) : "";
}

function timeToMin(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function getDiaSemana(fechaISO) {
  return new Date(fechaISO + "T00:00:00").getDay();
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

function iniciales(nombre) {
  const partes = (nombre || "").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "?";
  return (partes[0][0] + (partes[1] ? partes[1][0] : "")).toUpperCase();
}

function formatFechaLarga(fechaISO) {
  const d = new Date(fechaISO + "T00:00:00");
  const s = d.toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// El trial nunca bloquea nada al vencer, solo avisa — salvo que ya
// se haya pagado un plan, ahí no hay cuenta regresiva que mostrar.
function trialLabel() {
  if (state.peluquero.plan && state.peluquero.plan !== "trial") {
    const nombre = state.peluquero.plan.charAt(0).toUpperCase() + state.peluquero.plan.slice(1);
    return `Plan ${nombre} activo`;
  }
  if (!state.peluquero.trial_inicio) return "";
  const inicio = new Date(state.peluquero.trial_inicio);
  const dias = Math.ceil(14 - (Date.now() - inicio.getTime()) / 86400000);
  if (dias > 0) return `Te quedan ${dias} día${dias === 1 ? "" : "s"}`;
  return "Prueba vencida";
}

// ------------------------------------------------------------
// Arranque / sesión
// ------------------------------------------------------------
async function init() {
  const { data } = await db.auth.getSession();
  state.session = data.session;
  db.auth.onAuthStateChange((_event, session) => {
    state.session = session;
    boot();
  });
  boot();
}

async function boot() {
  state.error = null;
  if (!state.session) {
    renderLogin();
    return;
  }
  try {
    await loadPeluquero();
    if (!state.peluquero) {
      renderSetup();
      return;
    }
    await loadConfiguracion();
    await loadTablero();
    renderApp();
    avisarVueltaDePago();
  } catch (err) {
    console.error(err);
    state.error = err.message || "Error inesperado";
    renderApp();
  }
}

// Mercado Pago te trae de vuelta con ?pago=exito|error|pendiente en la URL.
// El webhook (server/payments.js) es la fuente de verdad del plan — esto
// es solo un cartel de cortesía, no confirma el pago por sí mismo.
function avisarVueltaDePago() {
  const pago = new URLSearchParams(location.search).get("pago");
  if (!pago) return;
  history.replaceState(null, "", location.pathname);
  const mensajes = {
    exito: "¡Pago recibido! Puede tardar unos segundos en reflejarse acá — si no ves el plan activo, refrescá en un ratito.",
    pendiente: "Tu pago quedó pendiente de aprobación en Mercado Pago. Te avisamos apenas se confirme.",
    error: "El pago no se pudo completar. Podés intentar de nuevo desde Configuración.",
  };
  if (!mensajes[pago]) return;
  openModal(`
    <h3>Mercado Pago</h3>
    <p class="hint">${mensajes[pago]}</p>
    <div class="actions"><button type="button" class="secondary" id="pago-close">Cerrar</button></div>
  `);
  document.getElementById("pago-close").addEventListener("click", closeModal);
}

async function loadPeluquero() {
  const { data, error } = await db
    .from("peluqueros")
    .select("*")
    .eq("user_id", state.session.user.id)
    .maybeSingle();
  if (error) throw error;
  state.peluquero = data;
}

// Servicios, horarios de atención y profesionales — todo lo que se
// gestiona desde la vista "Horarios" y que la agenda necesita para
// calcular huecos y renderizar los selectores.
async function loadConfiguracion() {
  const [servicios, horarios, profesionales] = await Promise.all([
    db.from("servicios").select("*").eq("activo", true).order("nombre"),
    db.from("horarios_atencion").select("*").order("dia_semana").order("hora_apertura"),
    db.from("profesionales").select("*").eq("activo", true).order("creado_en"),
  ]);
  if (servicios.error) throw servicios.error;
  if (horarios.error) throw horarios.error;
  if (profesionales.error) throw profesionales.error;
  state.servicios = servicios.data;
  state.horarios = horarios.data;
  state.profesionales = profesionales.data;

  if (!state.servicios.some((s) => s.id === state.servicioId)) {
    state.servicioId = state.servicios[0] ? state.servicios[0].id : null;
  }
  if (!state.profesionales.some((p) => p.id === state.profesionalId)) {
    state.profesionalId = state.profesionales[0] ? state.profesionales[0].id : null;
  }
}

async function loadTablero() {
  state.huecos = [];
  state.turnos = [];
  if (!state.profesionalId) return;

  const turnosRes = await db
    .from("turnos")
    .select("*, clientes(nombre, telefono, creado_en)")
    .eq("fecha", state.fecha)
    .eq("profesional_id", state.profesionalId)
    .in("estado", ["ocupado", "bloqueado"])
    .order("hora_inicio");
  if (turnosRes.error) throw turnosRes.error;
  state.turnos = turnosRes.data;

  if (state.servicioId) {
    const { data, error } = await db.rpc("generar_huecos_disponibles", {
      p_peluquero_id: state.peluquero.id,
      p_fecha: state.fecha,
      p_servicio_id: state.servicioId,
      p_profesional_id: state.profesionalId,
    });
    if (error) throw error;
    state.huecos = data || [];
  }
}

// Busca un cliente existente del comercio por teléfono (o por nombre si
// no hay teléfono) y si no existe lo crea. Así el turno puede mostrar
// "cliente desde X" en vez de tratar cada uno como un desconocido.
async function findOrCreateCliente(nombre, telefono) {
  let query = db.from("clientes").select("id, nombre").eq("peluquero_id", state.peluquero.id);
  query = telefono ? query.eq("telefono", telefono) : query.is("telefono", null).eq("nombre", nombre);
  // limit(1): sin teléfono, dos clientes distintos podrían compartir nombre
  // (o una carrera entre dos altas casi simultáneas duplicarlos) — sin esto
  // maybeSingle() explota apenas hay más de una fila candidata.
  const { data: existing, error: findErr } = await query.limit(1).maybeSingle();
  if (findErr) throw findErr;
  if (existing) {
    if (telefono && existing.nombre !== nombre) {
      await db.from("clientes").update({ nombre }).eq("id", existing.id);
    }
    return existing.id;
  }
  const { data: created, error: insertErr } = await db
    .from("clientes")
    .insert({ peluquero_id: state.peluquero.id, nombre, telefono: telefono || null })
    .select("id")
    .single();
  if (insertErr) throw insertErr;
  return created.id;
}

async function withLoading(fn) {
  state.loading = true;
  try {
    await fn();
  } catch (err) {
    console.error(err);
    state.error = err.message || "Error inesperado";
  } finally {
    state.loading = false;
  }
}

// ------------------------------------------------------------
// Login (split panel)
// ------------------------------------------------------------
// El alta de comercios nuevos es manual (invitación desde el dashboard de
// Supabase), no self-service — por eso no hay tab de "crear cuenta" acá.
function renderLogin() {
  app.innerHTML = `
    <div class="login-shell">
      <div class="login-aside">
        <div class="brand"><span class="brand-mark"></span>Clavis</div>
        <img class="login-illustration" src="assets/login-ilustracion.svg" alt="" />
        <h2>El cuaderno de turnos ya cumplió.</h2>
        <p>Entrá y mirá la agenda de hoy, sin llamados ni idas y vueltas.</p>
        <div class="login-testimonial">
          <span class="dot"></span>
          <span>“Bajamos los ausentes a la mitad.” — Lucía, Rosario</span>
        </div>
      </div>
      <div class="login-form-side">
        <div class="login-form-card">
          <h2>Hola de nuevo</h2>
          <p class="hint">Tu agenda de hoy te está esperando.</p>
          <form id="login-form">
            <div>
              <label for="login-email">Email</label>
              <input type="email" id="login-email" placeholder="hola@micomercio.com" required autocomplete="email" />
            </div>
            <div>
              <label for="login-password">Contraseña</label>
              <input type="password" id="login-password" placeholder="••••••••" required autocomplete="current-password" minlength="6" />
            </div>
            <div style="display:flex; align-items:center; justify-content:space-between; font-size:13px;">
              <label style="display:flex; align-items:center; gap:6px; font-weight:400;">
                <input type="checkbox" id="login-mantener" checked style="width:auto;" />
                Mantenerme conectado
              </label>
              <a href="#" id="login-olvide" style="color:var(--bloqueado); font-weight:600;">Olvidé mi contraseña</a>
            </div>
            <button type="submit" id="login-submit" class="dark">Ingresar</button>
            <div class="error-msg" id="login-error"></div>
          </form>
          <div style="display:flex; align-items:center; gap:10px; margin:16px 0; color:var(--text-muted); font-size:12px;">
            <div style="flex:1; height:1px; background:var(--border);"></div>o<div style="flex:1; height:1px; background:var(--border);"></div>
          </div>
          <button type="button" class="secondary" id="login-google" style="width:100%;">Continuar con Google</button>
          <p class="hint" style="margin-top:16px;"><a href="index.html">← Volver al inicio</a></p>
        </div>
      </div>
    </div>
  `;

  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("login-error");
    const submitBtn = document.getElementById("login-submit");
    errorEl.textContent = "";
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    submitBtn.disabled = true;
    try {
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (err) {
      errorEl.textContent = err.message || "No se pudo iniciar sesión";
    } finally {
      submitBtn.disabled = false;
    }
  });

  document.getElementById("login-olvide").addEventListener("click", (e) => {
    e.preventDefault();
    openModal(`
      <h3>Recuperar contraseña</h3>
      <p class="hint">Te mandamos un link para elegir una nueva.</p>
      <form id="olvide-form">
        <input type="email" id="olvide-email" placeholder="hola@micomercio.com" required />
        <div class="actions">
          <button type="button" class="secondary" id="olvide-cancel">Cancelar</button>
          <button type="submit">Mandar link</button>
        </div>
        <div class="error-msg" id="olvide-error"></div>
      </form>
    `);
    document.getElementById("olvide-cancel").addEventListener("click", closeModal);
    document.getElementById("olvide-form").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const errorEl = document.getElementById("olvide-error");
      const email = document.getElementById("olvide-email").value.trim();
      try {
        const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: location.href });
        if (error) throw error;
        openModal(`
          <h3>Listo</h3>
          <p class="hint">Si ${escapeHtml(email)} tiene una cuenta, le va a llegar un mail con el link.</p>
          <div class="actions"><button type="button" class="secondary" id="olvide-close">Cerrar</button></div>
        `);
        document.getElementById("olvide-close").addEventListener("click", closeModal);
      } catch (err) {
        errorEl.textContent = err.message || "No se pudo enviar el link";
      }
    });
  });

  document.getElementById("login-google").addEventListener("click", async () => {
    const errorEl = document.getElementById("login-error");
    errorEl.textContent = "";
    try {
      const { error } = await db.auth.signInWithOAuth({ provider: "google" });
      if (error) throw error;
    } catch (err) {
      // Esperable hasta que se configure Google en Supabase (Authentication
      // → Providers → Google) — ver SETUP.md.
      errorEl.textContent = err.message || "Google todavía no está configurado para este proyecto";
    }
  });
}

// ------------------------------------------------------------
// Alta de comercio (primer login)
// ------------------------------------------------------------
function renderSetup() {
  app.innerHTML = `
    <div class="setup-box">
      <h2>¡Bienvenido/a a Clavis!</h2>
      <p class="hint">Contanos tu nombre para armar tu agenda.</p>
      <form id="setup-form">
        <input type="text" id="setup-nombre" placeholder="Tu nombre" required />
        <input type="tel" id="setup-telefono" placeholder="Teléfono (opcional)" />
        <button type="submit" id="setup-submit">Crear mi agenda</button>
        <div class="error-msg" id="setup-error"></div>
      </form>
      <p class="hint"><a href="#" id="setup-logout">Cerrar sesión</a></p>
    </div>
  `;

  document.getElementById("setup-logout").addEventListener("click", async (e) => {
    e.preventDefault();
    await db.auth.signOut();
  });

  document.getElementById("setup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById("setup-submit");
    const errorEl = document.getElementById("setup-error");
    const nombre = document.getElementById("setup-nombre").value.trim();
    const telefono = document.getElementById("setup-telefono").value.trim();
    submitBtn.disabled = true;
    errorEl.textContent = "";
    try {
      const { data: nuevoPeluquero, error } = await db
        .from("peluqueros")
        .insert({ user_id: state.session.user.id, nombre, telefono: telefono || null })
        .select("id")
        .single();
      if (error) throw error;
      // Todo comercio arranca con un profesional "Vos" para no forzar a
      // configurar el equipo antes de poder usar la agenda.
      await db.from("profesionales").insert({ peluquero_id: nuevoPeluquero.id, nombre: "Vos" });
      await boot();
    } catch (err) {
      errorEl.textContent = err.message || "No se pudo crear tu agenda";
      submitBtn.disabled = false;
    }
  });
}

// ------------------------------------------------------------
// Shell: sidebar + vista activa
// ------------------------------------------------------------
function renderApp() {
  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="sidebar-brand"><span class="brand-mark"></span>Clavis</div>
        <div class="sidebar-comercio">${escapeHtml(state.peluquero.nombre)}</div>
        <nav class="sidebar-nav">
          <button class="nav-item ${state.view === "agenda" ? "active" : ""}" data-view="agenda"><span class="navdot"></span>Agenda</button>
          <button class="nav-item ${state.view === "metricas" ? "active" : ""}" data-view="metricas"><span class="navdot"></span>Métricas</button>
          <button class="nav-item ${state.view === "horarios" ? "active" : ""}" data-view="horarios"><span class="navdot"></span>Horarios</button>
        </nav>
        <div class="sidebar-footer">
          <div class="sidebar-plan">
            <div class="sidebar-plan-label">Plan</div>
            <div class="sidebar-plan-dias">${trialLabel()}</div>
            ${
              state.peluquero.plan && state.peluquero.plan !== "trial"
                ? ""
                : `<button type="button" class="secondary" id="btn-activar-plan">Activar plan</button>`
            }
          </div>
          <button class="secondary" id="btn-logout">Cerrar sesión</button>
        </div>
      </aside>
      <main class="content">
        ${state.error ? `<div class="error-msg">${escapeHtml(state.error)}</div>` : ""}
        ${state.view === "agenda" ? renderAgendaView() : ""}
        ${state.view === "metricas" ? renderMetricasView() : ""}
        ${state.view === "horarios" ? renderHorariosView() : ""}
      </main>
    </div>
    <div class="modal-backdrop" id="modal-backdrop"></div>
  `;

  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => goToView(btn.dataset.view));
  });
  document.getElementById("btn-logout").addEventListener("click", async () => {
    await db.auth.signOut();
  });
  const btnActivarPlan = document.getElementById("btn-activar-plan");
  if (btnActivarPlan) {
    btnActivarPlan.addEventListener("click", async () => {
      openModal(`<h3>Activando plan Comercio</h3><p class="hint">Te llevamos a Mercado Pago...</p>`);
      try {
        const res = await fetch(`${window.PAYMENTS_API_URL}/crear-preferencia`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ peluqueroId: state.peluquero.id }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "No se pudo iniciar el pago");
        const { init_point } = await res.json();
        location.href = init_point;
      } catch (err) {
        console.error(err);
        openModal(`
          <h3>No se pudo iniciar el pago</h3>
          <p class="error-msg">${escapeHtml(err.message)}</p>
          <p class="hint">¿Está corriendo <code>server/payments.js</code>? Ver <code>server/README.md</code>.</p>
          <div class="actions"><button type="button" class="secondary" id="plan-close">Cerrar</button></div>
        `);
        document.getElementById("plan-close").addEventListener("click", closeModal);
      }
    });
  }

  if (state.view === "agenda") wireAgendaView();
  if (state.view === "metricas") wireMetricasView();
  if (state.view === "horarios") wireHorariosView();
}

async function goToView(view) {
  state.view = view;
  if (view === "metricas") {
    renderApp();
    await withLoading(loadMetricas);
    renderApp();
    return;
  }
  if (view === "horarios") {
    renderApp();
    await withLoading(loadHorariosWeekCounts);
    renderApp();
    return;
  }
  renderApp();
}

// ------------------------------------------------------------
// Vista: Agenda
// ------------------------------------------------------------
// Los huecos que devuelve la RPC se solapan a propósito (una opción de
// inicio cada 15'); acá los fusionamos para mostrar una sola franja libre
// continua en la lista, en vez de decenas de filas casi idénticas.
function mergeFreeRegions(huecos) {
  if (!huecos.length) return [];
  const sorted = [...huecos].sort((a, b) => timeToMin(a.hora_inicio) - timeToMin(b.hora_inicio));
  const merged = [{ inicio: sorted[0].hora_inicio, fin: sorted[0].hora_fin }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const last = merged[merged.length - 1];
    if (timeToMin(cur.hora_inicio) <= timeToMin(last.fin)) {
      if (timeToMin(cur.hora_fin) > timeToMin(last.fin)) last.fin = cur.hora_fin;
    } else {
      merged.push({ inicio: cur.hora_inicio, fin: cur.hora_fin });
    }
  }
  return merged;
}

function computeDayWindow() {
  const dia = getDiaSemana(state.fecha);
  const franjas = state.horarios.filter((h) => h.dia_semana === dia);
  if (!franjas.length) return null;
  return {
    startMin: Math.min(...franjas.map((f) => timeToMin(f.hora_apertura))),
    endMin: Math.max(...franjas.map((f) => timeToMin(f.hora_cierre))),
  };
}

const FILTROS_ESTADO_AGENDA = [
  { id: "todos", label: "Todos" },
  { id: "confirmado", label: "Confirmados" },
  { id: "atendido", label: "Atendidos" },
  { id: "ausente", label: "Ausentes" },
  { id: "bloqueado", label: "Bloqueados" },
];

function estadoFiltroTurno(t) {
  if (t.estado === "bloqueado") return "bloqueado";
  if (t.asistio === true) return "atendido";
  if (t.asistio === false) return "ausente";
  return "confirmado";
}

function renderAgendaView() {
  if (!state.profesionales.length) {
    return `<div class="content-header"><h2>Agenda</h2></div><div class="empty-msg">Agregá al menos un profesional en Horarios para ver la agenda.</div>`;
  }

  const libres = mergeFreeRegions(state.huecos);
  const win = computeDayWindow();
  const minutosOcupados = state.turnos.reduce((acc, t) => acc + (timeToMin(t.hora_fin) - timeToMin(t.hora_inicio)), 0);
  const pctOcupado = win && win.endMin > win.startMin ? Math.round((minutosOcupados / (win.endMin - win.startMin)) * 100) : null;

  const profesionalChips = state.profesionales
    .map((p) => `<button class="chip ${p.id === state.profesionalId ? "active" : ""}" data-profesional="${p.id}">${escapeHtml(p.nombre)}</button>`)
    .join("");

  const estadoChips = FILTROS_ESTADO_AGENDA.map(
    (f) => `<button class="chip ${state.agendaFiltro === f.id ? "active" : ""}" data-estado-filtro="${f.id}">${f.label}</button>`
  ).join("");

  const serviciosOptions = state.servicios
    .map((s) => `<option value="${s.id}" ${s.id === state.servicioId ? "selected" : ""}>${escapeHtml(s.nombre)} (${s.duracion_minutos}')</option>`)
    .join("");

  // Filas cronológicas: mezclamos huecos libres (fusionados) y turnos.
  // El filtro de estado solo esconde turnos — los huecos libres siempre
  // se ven, para no tapar dónde se puede agendar.
  const turnosFiltrados =
    state.agendaFiltro === "todos" ? state.turnos : state.turnos.filter((t) => estadoFiltroTurno(t) === state.agendaFiltro);
  const filas = [
    ...libres.map((r) => ({ tipo: "libre", inicio: r.inicio, fin: r.fin })),
    ...turnosFiltrados.map((t) => ({ tipo: "turno", inicio: t.hora_inicio, fin: t.hora_fin, turno: t })),
  ].sort((a, b) => timeToMin(a.inicio) - timeToMin(b.inicio));

  // Día sin ningún turno cargado: en vez de la lista de huecos sueltos
  // (podían ser decenas, uno cada 15'), un estado grande que ocupa el
  // espacio disponible con un solo botón para agendar.
  let filasHtml;
  if (!filas.length) {
    filasHtml = `<div class="empty-illustration hero">
        <img src="assets/sin-turnos.svg" alt="" />
        <p class="titulo">No hay horario de atención cargado para este día</p>
        <p class="sub">Agregalo en Horarios.</p>
      </div>`;
  } else if (state.turnos.length === 0) {
    filasHtml = `<div class="empty-illustration hero">
        <img src="assets/sin-turnos.svg" alt="" />
        <p class="titulo">Sin turnos este día</p>
        <p class="sub">Toda la agenda está libre.</p>
        <button type="button" id="btn-nuevo-turno-hero">+ Agregar turno</button>
      </div>`;
  } else {
    filasHtml = filas
      .map((f) => {
        if (f.tipo === "libre") {
          return `
            <div class="agenda-row">
              <div class="row-hora">${hhmm(f.inicio)}</div>
              <button type="button" class="slot-empty" data-libre-inicio="${f.inicio}">+ Libre — agregar turno</button>
            </div>`;
        }
        const t = f.turno;
        const servicio = state.servicios.find((s) => s.id === t.servicio_id);
        let badge = "";
        if (t.estado === "ocupado") {
          if (t.asistio === true) badge = `<span class="status-badge atendido">Atendido</span>`;
          else if (t.asistio === false) badge = `<span class="status-badge ausente">Ausente</span>`;
          else badge = `<span class="status-badge confirmado">Confirmado</span>`;
        }
        const nombre = t.estado === "ocupado" ? escapeHtml(t.cliente_nombre || "Sin nombre") : "Bloqueado";
        const sub =
          t.estado === "ocupado"
            ? `${servicio ? escapeHtml(servicio.nombre) + " · " : ""}${hhmm(t.hora_inicio)}–${hhmm(t.hora_fin)}`
            : `${escapeHtml(t.notas || "Motivo no especificado")} · ${hhmm(t.hora_inicio)}–${hhmm(t.hora_fin)}`;
        const precio = t.estado === "ocupado" && servicio && servicio.precio ? `$${Number(servicio.precio).toLocaleString("es-AR")}` : "";
        return `
          <div class="agenda-row">
            <div class="row-hora">${hhmm(t.hora_inicio)}</div>
            <div class="turno-card" data-estado="${t.estado}" data-turno-id="${t.id}">
              <div>
                <span class="turno-nombre">${nombre}</span>${badge}
                <div class="turno-sub">${sub}</div>
              </div>
              <div class="turno-precio">${precio}</div>
            </div>
          </div>`;
      })
      .join("");
  }

  return `
    <div class="content-header">
      <h2>Agenda del día</h2>
      <p class="sub">${state.turnos.length} turno${state.turnos.length === 1 ? "" : "s"} · ${libres.length} hueco${libres.length === 1 ? "" : "s"} libre${libres.length === 1 ? "" : "s"}${pctOcupado === null ? "" : ` · ${pctOcupado}% ocupado`}</p>
    </div>
    <div class="agenda-toolbar">
      <div class="date-nav">
        <button type="button" id="fecha-prev" aria-label="Día anterior">‹</button>
        <span>${formatFechaLarga(state.fecha)}</span>
        <button type="button" id="fecha-next" aria-label="Día siguiente">›</button>
      </div>
      <input type="date" id="fecha-input" value="${state.fecha}" style="max-width:150px" />
      ${state.servicios.length ? `<select id="servicio-select">${serviciosOptions}</select>` : `<span class="hint">Agregá un servicio en Horarios</span>`}
      <button type="button" id="btn-nuevo-turno">+ Nuevo turno</button>
    </div>
    <div class="chip-row">${profesionalChips}</div>
    <div class="chip-row">${estadoChips}</div>
    <div class="agenda-list">${filasHtml}</div>
  `;
}

function wireAgendaView() {
  document.getElementById("fecha-input").addEventListener("change", async (e) => {
    state.fecha = e.target.value;
    await withLoading(loadTablero);
    renderApp();
  });

  const shiftFecha = async (days) => {
    const d = new Date(state.fecha + "T00:00:00");
    d.setDate(d.getDate() + days);
    state.fecha = isoDate(d);
    await withLoading(loadTablero);
    renderApp();
  };
  document.getElementById("fecha-prev").addEventListener("click", () => shiftFecha(-1));
  document.getElementById("fecha-next").addEventListener("click", () => shiftFecha(1));

  const servicioSelect = document.getElementById("servicio-select");
  if (servicioSelect) {
    servicioSelect.addEventListener("change", async (e) => {
      state.servicioId = e.target.value;
      await withLoading(loadTablero);
      renderApp();
    });
  }

  document.querySelectorAll("[data-profesional]").forEach((chip) => {
    chip.addEventListener("click", async () => {
      state.profesionalId = chip.dataset.profesional;
      await withLoading(loadTablero);
      renderApp();
    });
  });

  document.querySelectorAll("[data-estado-filtro]").forEach((chip) => {
    chip.addEventListener("click", () => {
      state.agendaFiltro = chip.dataset.estadoFiltro;
      renderApp();
    });
  });

  document.querySelectorAll("[data-libre-inicio]").forEach((el) => {
    el.addEventListener("click", () => openSlotChooser(timeToMin(el.dataset.libreInicio)));
  });

  document.querySelectorAll(".turno-card").forEach((el) => {
    el.addEventListener("click", () => {
      const turno = state.turnos.find((t) => t.id === el.dataset.turnoId);
      if (turno) renderTurnoDetailModal(turno);
    });
  });

  const onNuevoTurno = () => {
    if (!state.huecos.length) {
      openModal(`
        <h3>Sin huecos libres</h3>
        <p class="hint">No queda ningún hueco libre este día para "${escapeHtml((state.servicios.find((s) => s.id === state.servicioId) || {}).nombre || "el servicio elegido")}".</p>
        <div class="actions"><button type="button" class="secondary" id="chooser-close">Cerrar</button></div>
      `);
      document.getElementById("chooser-close").addEventListener("click", closeModal);
      return;
    }
    openSlotChooser(timeToMin(state.huecos[0].hora_inicio));
  };
  const btnNuevo = document.getElementById("btn-nuevo-turno");
  if (btnNuevo) btnNuevo.addEventListener("click", onNuevoTurno);
  const btnNuevoHero = document.getElementById("btn-nuevo-turno-hero");
  if (btnNuevoHero) btnNuevoHero.addEventListener("click", onNuevoTurno);
}

function openSlotChooser(clickedMin) {
  if (!state.huecos.length) return;
  let nearest = state.huecos[0];
  let bestDiff = Infinity;
  for (const h of state.huecos) {
    const diff = Math.abs(timeToMin(h.hora_inicio) - clickedMin);
    if (diff < bestDiff) {
      bestDiff = diff;
      nearest = h;
    }
  }
  openModal(`
    <h3>${hhmm(nearest.hora_inicio)} - ${hhmm(nearest.hora_fin)}</h3>
    <div class="actions">
      <button type="button" class="secondary" id="chooser-bloquear">Bloquear horario</button>
      <button type="button" id="chooser-asignar">Asignar turno</button>
    </div>
  `);
  document
    .getElementById("chooser-asignar")
    .addEventListener("click", () => openBookingModal(nearest.hora_inicio, nearest.hora_fin, "ocupado"));
  document
    .getElementById("chooser-bloquear")
    .addEventListener("click", () => openBookingModal(nearest.hora_inicio, nearest.hora_fin, "bloqueado"));
}

// ------------------------------------------------------------
// Modal genérico
// ------------------------------------------------------------
function openModal(html, wide) {
  const backdrop = document.getElementById("modal-backdrop");
  backdrop.innerHTML = `<div class="modal ${wide ? "modal-wide" : ""}">${html}</div>`;
  backdrop.classList.add("visible");
  backdrop.onclick = (e) => {
    if (e.target === backdrop) closeModal();
  };
}

function closeModal() {
  const backdrop = document.getElementById("modal-backdrop");
  backdrop.classList.remove("visible");
  backdrop.innerHTML = "";
}

async function openBookingModal(horaInicio, horaFin, target) {
  const isOcupado = target === "ocupado";
  openModal(`
    <h3>${isOcupado ? "Asignar turno" : "Bloquear horario"}</h3>
    <p class="hint">${hhmm(horaInicio)} - ${hhmm(horaFin)}</p>
    <form id="booking-form">
      ${
        isOcupado
          ? `
        <input type="text" id="booking-cliente" placeholder="Nombre del cliente" required />
        <input type="tel" id="booking-telefono" placeholder="Teléfono (opcional)" />
        <input type="text" id="booking-nota" placeholder="Nota (opcional)" />
      `
          : `<input type="text" id="booking-notas" placeholder="Motivo (opcional, ej: almuerzo)" />`
      }
      <div class="actions">
        <button type="button" class="secondary" id="booking-cancel">Cancelar</button>
        <button type="submit">Guardar</button>
      </div>
      <div class="error-msg" id="booking-error"></div>
    </form>
  `);

  document.getElementById("booking-cancel").addEventListener("click", closeModal);
  document.getElementById("booking-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("booking-error");
    const submitBtn = e.target.querySelector("button[type=submit]");
    const row = {
      peluquero_id: state.peluquero.id,
      profesional_id: state.profesionalId,
      fecha: state.fecha,
      hora_inicio: horaInicio,
      hora_fin: horaFin,
      estado: target,
      origen: "manual",
    };
    submitBtn.disabled = true;
    try {
      if (isOcupado) {
        const nombre = document.getElementById("booking-cliente").value.trim();
        const telefono = document.getElementById("booking-telefono").value.trim() || null;
        row.cliente_nombre = nombre;
        row.cliente_telefono = telefono;
        row.servicio_id = state.servicioId;
        row.notas = document.getElementById("booking-nota").value.trim() || null;
        row.cliente_id = await findOrCreateCliente(nombre, telefono);
      } else {
        row.notas = document.getElementById("booking-notas").value.trim() || null;
      }
      const { error } = await db.from("turnos").insert(row);
      if (error) throw error;
      closeModal();
      await withLoading(loadTablero);
      renderApp();
    } catch (err) {
      console.error(err);
      errorEl.textContent =
        err.code === "23P01" ? "Ese horario ya no está disponible." : err.message || "No se pudo guardar";
      submitBtn.disabled = false;
    }
  });
}

function renderTurnoDetailModal(turno) {
  if (turno.estado !== "ocupado") {
    openModal(`
      <h3>${hhmm(turno.hora_inicio)} - ${hhmm(turno.hora_fin)}</h3>
      <p class="hint">Bloqueado — ${escapeHtml(turno.notas || "sin motivo especificado")}</p>
      <div class="actions">
        <button type="button" class="danger" id="turno-liberar">Liberar horario</button>
      </div>
      <div class="error-msg" id="turno-detail-error"></div>
    `);
    document.getElementById("turno-liberar").addEventListener("click", () =>
      mutateTurno(() => db.from("turnos").delete().eq("id", turno.id))
    );
    return;
  }

  const servicio = state.servicios.find((s) => s.id === turno.servicio_id);
  const profesional = state.profesionales.find((p) => p.id === turno.profesional_id);
  const cliente = turno.clientes;
  const clienteDesde =
    cliente && cliente.creado_en
      ? new Date(cliente.creado_en).toLocaleDateString("es-AR", { year: "numeric", month: "long" })
      : null;

  let badge = `<span class="status-badge confirmado">Confirmado</span>`;
  if (turno.asistio === true) badge = `<span class="status-badge atendido">Atendido</span>`;
  else if (turno.asistio === false) badge = `<span class="status-badge ausente">Ausente</span>`;

  openModal(
    `
    <div class="turno-detail-head">
      <div class="avatar">${escapeHtml(iniciales(turno.cliente_nombre))}</div>
      <div>
        <div class="turno-detail-name">${escapeHtml(turno.cliente_nombre || "Sin nombre")} ${badge}</div>
        <div class="turno-detail-contact">
          ${turno.cliente_telefono ? escapeHtml(turno.cliente_telefono) + " · " : ""}${clienteDesde ? "cliente desde " + escapeHtml(clienteDesde) : "cliente nuevo"}
        </div>
      </div>
    </div>
    <div class="turno-detail-grid">
      <div><div class="g-label">Servicio</div><div class="g-value">${servicio ? escapeHtml(servicio.nombre) : "—"}</div></div>
      <div><div class="g-label">Horario</div><div class="g-value">${hhmm(turno.hora_inicio)} – ${hhmm(turno.hora_fin)}</div></div>
      <div><div class="g-label">Profesional</div><div class="g-value">${profesional ? escapeHtml(profesional.nombre) : "—"}</div></div>
      <div><div class="g-label">Precio</div><div class="g-value">${servicio && servicio.precio ? "$" + Number(servicio.precio).toLocaleString("es-AR") : "—"}</div></div>
    </div>
    ${turno.notas ? `<p class="turno-nota">“${escapeHtml(turno.notas)}”</p>` : ""}
    <div class="actions">
      <button type="button" class="secondary" id="turno-asistio">Asistió</button>
      <button type="button" class="secondary" id="turno-ausente">Ausente</button>
    </div>
    <div class="actions">
      <button type="button" class="dark" id="turno-reprogramar">Reprogramar</button>
      <button type="button" class="danger" id="turno-liberar">Cancelar turno</button>
    </div>
    ${renderActividadTurno(turno)}
    <div class="error-msg" id="turno-detail-error"></div>
  `,
    true
  );

  document.getElementById("turno-asistio").addEventListener("click", () =>
    mutateTurno(() => db.from("turnos").update({ asistio: true }).eq("id", turno.id))
  );
  document.getElementById("turno-ausente").addEventListener("click", () =>
    mutateTurno(() => db.from("turnos").update({ asistio: false }).eq("id", turno.id))
  );
  document.getElementById("turno-reprogramar").addEventListener("click", () => openReprogramarModal(turno));
  document.getElementById("turno-liberar").addEventListener("click", () =>
    mutateTurno(() => db.from("turnos").delete().eq("id", turno.id))
  );
}

// Log de actividad con datos reales (nunca inventados): cuándo se
// reservó y por dónde, si salió el recordatorio de WhatsApp, y cuándo
// se marcó la asistencia. No hay tracking de "confirmó por WhatsApp"
// todavía porque el server solo manda mensajes, no procesa respuestas.
function formatFechaHora(iso) {
  return new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function renderActividadTurno(turno) {
  const origenTexto = { manual: "Cargado a mano por el comercio", web: "Reservó desde el link público", whatsapp: "Reservó por WhatsApp" };
  const eventos = [{ texto: origenTexto[turno.origen] || "Reservado", fecha: turno.creado_en }];

  if (turno.recordatorio_enviado) {
    eventos.push({ texto: "Recordatorio de WhatsApp enviado", fecha: null });
  }
  if (turno.asistio === true) eventos.push({ texto: "Marcado como atendido", fecha: turno.actualizado_en });
  if (turno.asistio === false) eventos.push({ texto: "Marcado como ausente", fecha: turno.actualizado_en });

  return `
    <div class="metrics-card" style="margin-top:14px;">
      <h4>Actividad</h4>
      <div class="row-list">
        ${eventos
          .map(
            (ev) => `
          <div class="row-item" style="flex-direction:column;align-items:flex-start;gap:0;">
            <span>${escapeHtml(ev.texto)}</span>
            ${ev.fecha ? `<span class="hint" style="margin:0;">${escapeHtml(formatFechaHora(ev.fecha))}</span>` : ""}
          </div>`
          )
          .join("")}
      </div>
    </div>
  `;
}

async function openReprogramarModal(turno) {
  openModal(
    `
    <h3>Reprogramar turno</h3>
    <p class="hint">${escapeHtml(turno.cliente_nombre || "Turno")} — elegí la nueva fecha y horario.</p>
    <div>
      <label>Nueva fecha</label>
      <input type="date" id="reprogramar-fecha" value="${turno.fecha}" min="${todayISO()}" />
    </div>
    <div id="reprogramar-huecos" style="margin-top:10px;"><p class="hint">Buscando horarios...</p></div>
    <div class="actions"><button type="button" class="secondary" id="reprogramar-cancel">Cancelar</button></div>
    <div class="error-msg" id="reprogramar-error"></div>
  `,
    true
  );

  document.getElementById("reprogramar-cancel").addEventListener("click", closeModal);

  const cargar = async (fecha) => {
    const cont = document.getElementById("reprogramar-huecos");
    cont.innerHTML = `<p class="hint">Buscando horarios...</p>`;
    try {
      const { data, error } = await db.rpc("generar_huecos_disponibles", {
        p_peluquero_id: state.peluquero.id,
        p_fecha: fecha,
        p_servicio_id: turno.servicio_id,
        p_profesional_id: turno.profesional_id,
      });
      if (error) throw error;
      const libres = mergeFreeRegions(data || []);
      if (!libres.length) {
        cont.innerHTML = `<p class="hint">No hay huecos libres ese día.</p>`;
        return;
      }
      cont.innerHTML = `<div class="huecos-grid">${libres
        .map((r) => `<button type="button" class="hueco-btn" data-inicio="${r.inicio}" data-fin="${r.fin}">${hhmm(r.inicio)}</button>`)
        .join("")}</div>`;
      cont.querySelectorAll(".hueco-btn").forEach((btn) => {
        btn.addEventListener("click", () =>
          mutateTurno(() =>
            db
              .from("turnos")
              .update({
                fecha,
                hora_inicio: btn.dataset.inicio,
                hora_fin: btn.dataset.fin,
                asistio: null,
                recordatorio_enviado: false,
              })
              .eq("id", turno.id)
          )
        );
      });
    } catch (err) {
      console.error(err);
      cont.innerHTML = `<p class="error-msg">${escapeHtml(err.message || "No se pudo cargar")}</p>`;
    }
  };

  document.getElementById("reprogramar-fecha").addEventListener("change", (e) => cargar(e.target.value));
  cargar(turno.fecha);
}

async function mutateTurno(fn) {
  const errorEl = document.getElementById("turno-detail-error");
  try {
    const { error } = await fn();
    if (error) throw error;
    closeModal();
    await withLoading(loadTablero);
    renderApp();
  } catch (err) {
    console.error(err);
    if (errorEl) {
      errorEl.textContent = err.code === "23P01" ? "Ese horario ya no está disponible." : err.message || "No se pudo guardar";
    }
  }
}

// ------------------------------------------------------------
// Vista: Métricas
// ------------------------------------------------------------
async function loadMetricas() {
  const hoy = new Date();
  const hoyISO = todayISO();
  const monthStart = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const monthEnd = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
  const weekStart = mondayOf(hoy);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const weekStartISO = isoDate(weekStart);
  const weekEndISO = isoDate(weekEnd);
  const monthStartISO = isoDate(monthStart);
  const monthEndISO = isoDate(monthEnd);

  // Todo el mes, de TODOS los profesionales: las métricas son del negocio
  // entero, no de la agenda puntual que estés mirando.
  const { data, error } = await db
    .from("turnos")
    .select("fecha, hora_inicio, hora_fin, estado, asistio, servicio_id, servicios(nombre, precio)")
    .in("estado", ["ocupado", "bloqueado"])
    .gte("fecha", monthStartISO)
    .lte("fecha", monthEndISO);
  if (error) throw error;

  let hoyTotal = 0, hoyCant = 0;
  let semanaTotal = 0, semanaCant = 0;
  let mesTotal = 0, mesCant = 0;
  let minutosOcupadosMes = 0;
  let ausentesMes = 0, marcadosMes = 0;
  const porServicio = new Map();

  for (const row of data) {
    minutosOcupadosMes += timeToMin(row.hora_fin) - timeToMin(row.hora_inicio);
    if (row.estado !== "ocupado") continue;

    const precio = row.servicios ? Number(row.servicios.precio) || 0 : 0;
    mesTotal += precio;
    mesCant++;
    if (row.fecha >= weekStartISO && row.fecha <= weekEndISO) {
      semanaTotal += precio;
      semanaCant++;
    }
    if (row.fecha === hoyISO) {
      hoyTotal += precio;
      hoyCant++;
    }
    if (row.asistio !== null) {
      marcadosMes++;
      if (row.asistio === false) ausentesMes++;
    }
    const nombreServicio = row.servicios ? row.servicios.nombre : "Sin servicio";
    porServicio.set(nombreServicio, (porServicio.get(nombreServicio) || 0) + 1);
  }

  let minutosDisponiblesMes = 0;
  for (let d = new Date(monthStart); d <= monthEnd; d.setDate(d.getDate() + 1)) {
    const dia = d.getDay();
    for (const h of state.horarios.filter((h) => h.dia_semana === dia)) {
      minutosDisponiblesMes += timeToMin(h.hora_cierre) - timeToMin(h.hora_apertura);
    }
  }

  const topServicios = [...porServicio.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([nombre, cant]) => ({ nombre, cant, pct: mesCant ? Math.round((cant / mesCant) * 100) : 0 }));

  // Turnos por día de la última semana (lun a dom), para el gráfico de barras.
  const { data: semanaData, error: semanaErr } = await db
    .from("turnos")
    .select("fecha")
    .in("estado", ["ocupado", "bloqueado"])
    .gte("fecha", weekStartISO)
    .lte("fecha", weekEndISO);
  if (semanaErr) throw semanaErr;
  const porDia = {};
  for (const row of semanaData) porDia[row.fecha] = (porDia[row.fecha] || 0) + 1;
  const barras = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    const f = isoDate(d);
    barras.push({ letra: DIAS_LETRA[d.getDay()], cant: porDia[f] || 0 });
  }

  state.metricas = {
    hoyTotal, hoyCant, semanaTotal, semanaCant, mesTotal, mesCant,
    ocupacionPct: minutosDisponiblesMes > 0 ? Math.round((minutosOcupadosMes / minutosDisponiblesMes) * 100) : null,
    ausenciasPct: marcadosMes > 0 ? Math.round((ausentesMes / marcadosMes) * 100) : null,
    marcadosMes,
    topServicios,
    barras,
  };
}

function renderMetricasView() {
  if (!state.metricas) {
    return `<div class="content-header"><h2>Métricas</h2></div><p class="hint">Cargando...</p>`;
  }
  const m = state.metricas;

  const fila = (label, total, cant) => `
    <div class="row-item">
      <span class="grow">${label} <span class="hint">(${cant} turno${cant === 1 ? "" : "s"})</span></span>
      <strong>$${total.toLocaleString("es-AR")}</strong>
    </div>`;

  return `
    <div class="content-header">
      <h2>Métricas</h2>
      <p class="sub">Todo el comercio, todos los profesionales.</p>
    </div>
    <div class="stats-grid">
      <div class="stat-tile"><div class="stat-n">${m.ocupacionPct === null ? "—" : m.ocupacionPct + "%"}</div><div class="stat-l">Ocupación este mes</div></div>
      <div class="stat-tile"><div class="stat-n">${m.ausenciasPct === null ? "—" : m.ausenciasPct + "%"}</div><div class="stat-l">Ausencias ${m.marcadosMes ? `(${m.marcadosMes} marcados)` : "(nada marcado)"}</div></div>
      <div class="stat-tile"><div class="stat-n">${m.mesCant}</div><div class="stat-l">Turnos este mes</div></div>
      <div class="stat-tile accent-fill"><div class="stat-n">$${m.mesTotal.toLocaleString("es-AR")}</div><div class="stat-l">Ingresos este mes</div></div>
    </div>

    <div class="metrics-card">
      <h4>Ingresos</h4>
      <p class="sub">Precio del servicio de cada turno ocupado. Los bloqueados no cuentan.</p>
      <div class="row-list">
        ${fila("Hoy", m.hoyTotal, m.hoyCant)}
        ${fila("Esta semana", m.semanaTotal, m.semanaCant)}
        ${fila("Este mes", m.mesTotal, m.mesCant)}
      </div>
    </div>

    <div class="metrics-card">
      <h4>Turnos por día</h4>
      <p class="sub">Esta semana (ocupados + bloqueados)</p>
      <div style="height:180px;"><canvas id="chart-turnos-dia"></canvas></div>
    </div>

    <div class="metrics-card">
      <h4>Servicios más pedidos</h4>
      <p class="sub">Este mes, sobre turnos ocupados.</p>
      ${
        m.topServicios.length
          ? `<div style="height:${Math.max(m.topServicios.length * 42, 90)}px;"><canvas id="chart-servicios"></canvas></div>`
          : `<p class="hint">Todavía no hay turnos ocupados este mes.</p>`
      }
    </div>
  `;
}

// Instancias globales de Chart.js: hay que destruirlas antes de volver a
// dibujar (se re-renderiza el HTML entero cada vez que cambian los datos),
// si no Chart.js tira "Canvas is already in use".
let chartTurnosDia = null;
let chartServicios = null;

function wireMetricasView() {
  const m = state.metricas;
  if (!m || typeof Chart === "undefined") return;

  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const accent = cssVar("--accent") || "#6eabc7";
  const text = cssVar("--text") || "#243e4b";
  const border = cssVar("--border") || "#e1e8ea";

  if (chartTurnosDia) chartTurnosDia.destroy();
  const ctxDias = document.getElementById("chart-turnos-dia");
  if (ctxDias) {
    chartTurnosDia = new Chart(ctxDias, {
      type: "bar",
      data: {
        labels: m.barras.map((b) => b.letra),
        datasets: [{ data: m.barras.map((b) => b.cant), backgroundColor: accent, borderRadius: 6, maxBarThickness: 34 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { title: () => "", label: (ctx) => `${ctx.parsed.y} turno${ctx.parsed.y === 1 ? "" : "s"}` } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: text } },
          y: { beginAtZero: true, ticks: { precision: 0, color: text }, grid: { color: border } },
        },
      },
    });
  }

  if (chartServicios) chartServicios.destroy();
  const ctxServicios = document.getElementById("chart-servicios");
  if (ctxServicios && m.topServicios.length) {
    chartServicios = new Chart(ctxServicios, {
      type: "bar",
      data: {
        labels: m.topServicios.map((s) => s.nombre),
        datasets: [{ data: m.topServicios.map((s) => s.pct), backgroundColor: accent, borderRadius: 6, maxBarThickness: 22 }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.x}%` } } },
        scales: {
          x: { beginAtZero: true, max: 100, ticks: { color: text, callback: (v) => v + "%" }, grid: { color: border } },
          y: { grid: { display: false }, ticks: { color: text } },
        },
      },
    });
  }
}

// ------------------------------------------------------------
// Vista: Horarios (días de atención, servicios, profesionales)
// ------------------------------------------------------------
async function loadHorariosWeekCounts() {
  const weekStart = mondayOf(new Date());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const { data, error } = await db
    .from("turnos")
    .select("fecha")
    .in("estado", ["ocupado", "bloqueado"])
    .gte("fecha", isoDate(weekStart))
    .lte("fecha", isoDate(weekEnd));
  if (error) throw error;
  const counts = {};
  for (const row of data) {
    const dia = getDiaSemana(row.fecha);
    counts[dia] = (counts[dia] || 0) + 1;
  }
  state.horariosWeekCounts = counts;
}

function renderHorariosView() {
  const diasRows = DIAS_ORDEN.map((dia) => {
    const franjas = state.horarios.filter((h) => h.dia_semana === dia);
    const cant = state.horariosWeekCounts[dia] || 0;
    const chips = franjas
      .map(
        (f) => `
      <span class="chip" data-del-horario="${f.id}">${hhmm(f.hora_apertura)}–${hhmm(f.hora_cierre)} ✕</span>`
      )
      .join("");
    return `
      <div class="dia-row">
        <label class="switch">
          <input type="checkbox" data-toggle-dia="${dia}" ${franjas.length ? "checked" : ""} />
          <span class="slider"></span>
        </label>
        <span class="dia-nombre">${DIAS[dia]}</span>
        <span class="dia-horario">
          ${franjas.length ? chips + ` <button type="button" class="secondary" data-add-franja="${dia}" style="padding:2px 10px;font-size:12px;">+ franja</button>` : "Cerrado"}
        </span>
        ${cant ? `<span class="dia-cant">${cant} turno${cant === 1 ? "" : "s"} esta semana</span>` : ""}
      </div>`;
  }).join("");

  const serviciosRows = state.servicios
    .map(
      (s) => `
    <div class="row-item">
      <span class="grow">${escapeHtml(s.nombre)} — ${s.duracion_minutos}' ${s.precio ? `— $${s.precio}` : ""}</span>
      <button class="danger" data-del-servicio="${s.id}">Borrar</button>
    </div>`
    )
    .join("");

  const profesionalesRows = state.profesionales
    .map(
      (p) => `
    <div class="row-item">
      <span class="grow">${escapeHtml(p.nombre)}</span>
      <button class="danger" data-del-profesional="${p.id}">Borrar</button>
    </div>`
    )
    .join("");

  const recordatorioActual = state.peluquero.recordatorio_offset_horas;
  const chipRecordatorio = (valor, label) => {
    const activo = valor === recordatorioActual || (valor === null && recordatorioActual == null);
    return `<button type="button" class="chip ${activo ? "active" : ""}" data-recordatorio="${valor === null ? "" : valor}">${label}</button>`;
  };

  const avisoActual = state.peluquero.aviso_minimo_horas;
  const chipAviso = (valor, label) => {
    const activo = valor === avisoActual;
    return `<button type="button" class="chip ${activo ? "active" : ""}" data-aviso="${valor}">${label}</button>`;
  };

  const linkReservas = new URL(`reservar.html?c=${state.peluquero.id}`, location.href).href;

  return `
    <div class="content-header">
      <h2>Horarios y reglas</h2>
      <p class="sub">Define cuándo atendés y quién forma parte del equipo.</p>
    </div>

    <div class="horarios-grid">
      <div class="metrics-card">
        <h4>Días de atención</h4>
        <p class="sub">La agenda solo ofrece huecos dentro de estos horarios.</p>
        ${diasRows}
      </div>

      <div>
        <div class="metrics-card">
          <h4>Reglas de reserva</h4>

          <p class="sub" style="margin-bottom:6px;">Aviso mínimo</p>
          <p class="sub" style="margin-top:0;">Nadie puede reservar desde el link público con menos anticipación que esta (a vos, desde la Agenda, no te aplica).</p>
          <div class="chip-row">
            ${chipAviso(2, "2 h")}
            ${chipAviso(12, "12 h")}
            ${chipAviso(24, "24 h")}
          </div>

          <p class="sub" style="margin-bottom:6px;">Recordatorio por WhatsApp</p>
          <p class="sub" style="margin-top:0;">Necesita <code>server/index.js</code> corriendo (ver <code>server/README.md</code>) para salir de verdad.</p>
          <div class="chip-row" style="margin-bottom:0;">
            ${chipRecordatorio(3, "3 h antes")}
            ${chipRecordatorio(24, "1 día antes")}
            ${chipRecordatorio(null, "No enviar")}
          </div>
        </div>

        <div class="metrics-card">
          <h4>Feriados y licencias</h4>
          <p class="sub">Bloqueá fechas y Clavis deja de ofrecerlas al instante.</p>
          <button type="button" id="btn-bloquear-fechas">Bloquear fechas</button>
        </div>

        <div class="metrics-card">
          <h4>Link de reservas</h4>
          <p class="sub">Compartilo con tus clientes — eligen horario y reservan solos, sin loguearse.</p>
          <div class="row-item">
            <span class="grow" id="link-reservas-texto" style="word-break:break-all;">${escapeHtml(linkReservas)}</span>
            <button type="button" class="secondary" id="btn-copiar-link">Copiar</button>
          </div>
        </div>

        <div class="metrics-card">
          <h4>Marca del link público</h4>
          <p class="sub">Así se ve <code>reservar.html</code> para tus clientes: tu nombre, tu color y tu logo en vez de los de Clavis.</p>
          <div style="margin-bottom:12px;">
            <label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px;">Nombre del comercio</label>
            <input type="text" id="marca-nombre" value="${escapeHtml(state.peluquero.nombre)}" required />
          </div>
          <div style="display:flex; gap:16px; align-items:flex-end; margin-bottom:12px; flex-wrap:wrap;">
            <div>
              <label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px;">Color de acento</label>
              <input type="color" id="marca-color" value="${state.peluquero.color_acento || "#6eabc7"}" style="width:56px;height:38px;padding:2px;" />
            </div>
            <div class="grow" style="min-width:180px;">
              <label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px;">Logo (opcional)</label>
              <input type="file" id="marca-logo-input" accept="image/png,image/jpeg,image/webp,image/svg+xml" />
            </div>
          </div>
          ${
            state.peluquero.logo_url
              ? `<div class="row-item" style="margin-bottom:12px;">
                  <img src="${escapeHtml(state.peluquero.logo_url)}" alt="" style="height:32px;width:auto;border-radius:6px;" />
                  <span class="grow hint">Logo actual</span>
                  <button type="button" class="danger" id="btn-quitar-logo">Quitar</button>
                </div>`
              : ""
          }
          <button type="button" id="btn-guardar-marca">Guardar</button>
          <div class="error-msg" id="marca-error"></div>
        </div>
      </div>
    </div>

    <div class="horarios-grid">
      <div class="metrics-card">
        <h4>Profesionales</h4>
        <div class="row-list">${profesionalesRows || `<span class="hint">Todavía no cargaste profesionales.</span>`}</div>
        <form id="profesional-form" class="inline-form">
          <input type="text" id="nuevo-profesional-nombre" placeholder="Nombre" required />
          <button type="submit">Agregar</button>
        </form>
      </div>

      <div class="metrics-card">
        <h4>Servicios</h4>
        <div class="row-list">${serviciosRows || `<span class="hint">Todavía no cargaste servicios.</span>`}</div>
        <form id="servicio-form" class="inline-form">
          <input type="text" id="nuevo-servicio-nombre" placeholder="Nombre" required />
          <input type="number" id="nuevo-servicio-duracion" placeholder="Minutos" min="1" required />
          <input type="number" id="nuevo-servicio-precio" placeholder="Precio (opcional)" min="0" step="0.01" />
          <button type="submit">Agregar</button>
        </form>
      </div>
    </div>

    <div class="error-msg" id="horarios-error"></div>
  `;
}

function wireHorariosView() {
  const errorEl = document.getElementById("horarios-error");

  const reload = async () => {
    await withLoading(loadConfiguracion);
    await withLoading(loadHorariosWeekCounts);
    await withLoading(loadTablero);
    renderApp();
  };

  document.querySelectorAll("[data-aviso]").forEach((chip) => {
    chip.addEventListener("click", async () => {
      const valor = parseInt(chip.dataset.aviso, 10);
      errorEl.textContent = "";
      try {
        const { error } = await db.from("peluqueros").update({ aviso_minimo_horas: valor }).eq("id", state.peluquero.id);
        if (error) throw error;
        await withLoading(loadPeluquero);
        renderApp();
      } catch (err) {
        console.error(err);
        errorEl.textContent = err.message || "No se pudo guardar";
      }
    });
  });

  const btnBloquear = document.getElementById("btn-bloquear-fechas");
  if (btnBloquear) btnBloquear.addEventListener("click", openBloquearFechasModal);

  document.querySelectorAll("[data-recordatorio]").forEach((chip) => {
    chip.addEventListener("click", async () => {
      const raw = chip.dataset.recordatorio;
      const valor = raw === "" ? null : parseInt(raw, 10);
      errorEl.textContent = "";
      try {
        const { error } = await db.from("peluqueros").update({ recordatorio_offset_horas: valor }).eq("id", state.peluquero.id);
        if (error) throw error;
        await withLoading(loadPeluquero);
        renderApp();
      } catch (err) {
        console.error(err);
        errorEl.textContent = err.message || "No se pudo guardar";
      }
    });
  });

  const marcaError = document.getElementById("marca-error");

  const btnQuitarLogo = document.getElementById("btn-quitar-logo");
  if (btnQuitarLogo) {
    btnQuitarLogo.addEventListener("click", async () => {
      marcaError.textContent = "";
      try {
        const { error } = await db.from("peluqueros").update({ logo_url: null }).eq("id", state.peluquero.id);
        if (error) throw error;
        await withLoading(loadPeluquero);
        renderApp();
      } catch (err) {
        console.error(err);
        marcaError.textContent = err.message || "No se pudo quitar el logo";
      }
    });
  }

  const btnGuardarMarca = document.getElementById("btn-guardar-marca");
  btnGuardarMarca.addEventListener("click", async () => {
    marcaError.textContent = "";
    const nombre = document.getElementById("marca-nombre").value.trim();
    const color = document.getElementById("marca-color").value;
    const archivo = document.getElementById("marca-logo-input").files[0];
    if (!nombre) {
      marcaError.textContent = "El nombre del comercio no puede quedar vacío.";
      return;
    }
    if (archivo && archivo.size > 2 * 1024 * 1024) {
      marcaError.textContent = "El logo no puede pesar más de 2 MB.";
      return;
    }
    btnGuardarMarca.disabled = true;
    try {
      const cambios = { nombre, color_acento: color };
      if (archivo) {
        const ext = archivo.name.split(".").pop().toLowerCase();
        const ruta = `${state.peluquero.id}/logo.${ext}`;
        const { error: uploadError } = await db.storage
          .from("logos")
          .upload(ruta, archivo, { upsert: true, contentType: archivo.type });
        if (uploadError) throw uploadError;
        const { data: pub } = db.storage.from("logos").getPublicUrl(ruta);
        cambios.logo_url = `${pub.publicUrl}?v=${Date.now()}`;
      }
      const { error } = await db.from("peluqueros").update(cambios).eq("id", state.peluquero.id);
      if (error) throw error;
      await withLoading(loadPeluquero);
      renderApp();
    } catch (err) {
      console.error(err);
      marcaError.textContent = err.message || "No se pudo guardar";
      btnGuardarMarca.disabled = false;
    }
  });

  const btnCopiar = document.getElementById("btn-copiar-link");
  if (btnCopiar) {
    btnCopiar.addEventListener("click", async () => {
      const texto = document.getElementById("link-reservas-texto").textContent;
      try {
        await navigator.clipboard.writeText(texto);
        btnCopiar.textContent = "¡Copiado!";
        setTimeout(() => (btnCopiar.textContent = "Copiar"), 1500);
      } catch (err) {
        console.error(err);
      }
    });
  }

  document.querySelectorAll("[data-toggle-dia]").forEach((input) => {
    input.addEventListener("change", async () => {
      const dia = parseInt(input.dataset.toggleDia, 10);
      errorEl.textContent = "";
      try {
        if (input.checked) {
          const { error } = await db
            .from("horarios_atencion")
            .insert({ peluquero_id: state.peluquero.id, dia_semana: dia, hora_apertura: "09:00", hora_cierre: "18:00" });
          if (error) throw error;
        } else {
          const idsDelDia = state.horarios.filter((h) => h.dia_semana === dia).map((h) => h.id);
          const { error } = await db.from("horarios_atencion").delete().in("id", idsDelDia);
          if (error) throw error;
        }
        await reload();
      } catch (err) {
        console.error(err);
        errorEl.textContent = err.message || "No se pudo guardar";
      }
    });
  });

  document.querySelectorAll("[data-del-horario]").forEach((chip) => {
    chip.addEventListener("click", async () => {
      errorEl.textContent = "";
      try {
        const { error } = await db.from("horarios_atencion").delete().eq("id", chip.dataset.delHorario);
        if (error) throw error;
        await reload();
      } catch (err) {
        console.error(err);
        errorEl.textContent = err.message || "No se pudo guardar";
      }
    });
  });

  document.querySelectorAll("[data-add-franja]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dia = parseInt(btn.dataset.addFranja, 10);
      openModal(`
        <h3>Agregar franja — ${DIAS[dia]}</h3>
        <form id="franja-form">
          <input type="time" id="franja-apertura" required />
          <input type="time" id="franja-cierre" required />
          <div class="actions">
            <button type="button" class="secondary" id="franja-cancel">Cancelar</button>
            <button type="submit">Guardar</button>
          </div>
          <div class="error-msg" id="franja-error"></div>
        </form>
      `);
      document.getElementById("franja-cancel").addEventListener("click", closeModal);
      document.getElementById("franja-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const fErr = document.getElementById("franja-error");
        const apertura = document.getElementById("franja-apertura").value;
        const cierre = document.getElementById("franja-cierre").value;
        if (cierre <= apertura) {
          fErr.textContent = "El cierre tiene que ser posterior a la apertura.";
          return;
        }
        try {
          const { error } = await db
            .from("horarios_atencion")
            .insert({ peluquero_id: state.peluquero.id, dia_semana: dia, hora_apertura: apertura, hora_cierre: cierre });
          if (error) throw error;
          closeModal();
          await reload();
        } catch (err) {
          console.error(err);
          fErr.textContent = err.message || "No se pudo guardar";
        }
      });
    });
  });

  document.querySelectorAll("[data-del-servicio]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      errorEl.textContent = "";
      try {
        const { error } = await db.from("servicios").delete().eq("id", btn.dataset.delServicio);
        if (error) throw error;
        await reload();
      } catch (err) {
        errorEl.textContent = err.message || "No se pudo guardar";
      }
    });
  });

  document.querySelectorAll("[data-del-profesional]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      errorEl.textContent = "";
      try {
        const { error } = await db.from("profesionales").delete().eq("id", btn.dataset.delProfesional);
        if (error) throw error;
        await reload();
      } catch (err) {
        errorEl.textContent = err.message || "No se pudo guardar";
      }
    });
  });

  document.getElementById("profesional-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.textContent = "";
    const nombre = document.getElementById("nuevo-profesional-nombre").value.trim();
    try {
      const { error } = await db.from("profesionales").insert({ peluquero_id: state.peluquero.id, nombre });
      if (error) throw error;
      await reload();
    } catch (err) {
      errorEl.textContent = err.message || "No se pudo guardar";
    }
  });

  document.getElementById("servicio-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.textContent = "";
    const nombre = document.getElementById("nuevo-servicio-nombre").value.trim();
    const duracion = parseInt(document.getElementById("nuevo-servicio-duracion").value, 10);
    const precioRaw = document.getElementById("nuevo-servicio-precio").value;
    try {
      const { error } = await db.from("servicios").insert({
        peluquero_id: state.peluquero.id,
        nombre,
        duracion_minutos: duracion,
        precio: precioRaw ? parseFloat(precioRaw) : null,
      });
      if (error) throw error;
      await reload();
    } catch (err) {
      errorEl.textContent = err.message || "No se pudo guardar";
    }
  });
}

// "Feriados y licencias": bloquea el horario de atención COMPLETO de
// cada día del rango, para uno o todos los profesionales — reusa
// turnos 'bloqueado' en vez de una tabla nueva, así la agenda, el
// link de reservas y las métricas ya lo entienden sin cambios.
function openBloquearFechasModal() {
  const profesionalesOptions = ['<option value="todos">Todos los profesionales</option>']
    .concat(state.profesionales.map((p) => `<option value="${p.id}">${escapeHtml(p.nombre)}</option>`))
    .join("");

  openModal(`
    <h3>Bloquear fechas</h3>
    <p class="hint">Bloquea el horario de atención completo de cada día del rango (feriados, vacaciones, licencias).</p>
    <form id="bloquear-form">
      <div>
        <label>Profesional</label>
        <select id="bloquear-profesional">${profesionalesOptions}</select>
      </div>
      <div>
        <label>Desde</label>
        <input type="date" id="bloquear-desde" min="${todayISO()}" required />
      </div>
      <div>
        <label>Hasta</label>
        <input type="date" id="bloquear-hasta" min="${todayISO()}" required />
      </div>
      <input type="text" id="bloquear-motivo" placeholder="Motivo (ej: Feriado, Vacaciones)" />
      <div class="actions">
        <button type="button" class="secondary" id="bloquear-cancel">Cancelar</button>
        <button type="submit">Bloquear</button>
      </div>
      <div class="error-msg" id="bloquear-error"></div>
    </form>
  `);

  document.getElementById("bloquear-cancel").addEventListener("click", closeModal);
  document.getElementById("bloquear-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("bloquear-error");
    const submitBtn = e.target.querySelector("button[type=submit]");
    const profesionalSel = document.getElementById("bloquear-profesional").value;
    const desde = document.getElementById("bloquear-desde").value;
    const hasta = document.getElementById("bloquear-hasta").value;
    const motivo = document.getElementById("bloquear-motivo").value.trim() || "Feriado / licencia";

    if (hasta < desde) {
      errorEl.textContent = 'La fecha "hasta" tiene que ser posterior o igual a "desde".';
      return;
    }

    const profesionalesTarget =
      profesionalSel === "todos" ? state.profesionales : state.profesionales.filter((p) => p.id === profesionalSel);

    submitBtn.disabled = true;
    errorEl.textContent = "";
    try {
      const filas = [];
      for (let d = new Date(desde + "T00:00:00"); isoDate(d) <= hasta; d.setDate(d.getDate() + 1)) {
        const franjas = state.horarios.filter((h) => h.dia_semana === d.getDay());
        if (!franjas.length) continue;
        const apertura = franjas.reduce((min, f) => (f.hora_apertura < min ? f.hora_apertura : min), franjas[0].hora_apertura);
        const cierre = franjas.reduce((max, f) => (f.hora_cierre > max ? f.hora_cierre : max), franjas[0].hora_cierre);
        for (const prof of profesionalesTarget) {
          filas.push({
            peluquero_id: state.peluquero.id,
            profesional_id: prof.id,
            fecha: isoDate(d),
            hora_inicio: apertura,
            hora_fin: cierre,
            estado: "bloqueado",
            origen: "manual",
            notas: motivo,
          });
        }
      }
      if (!filas.length) {
        errorEl.textContent = "No hay ningún día con horario de atención en ese rango.";
        submitBtn.disabled = false;
        return;
      }
      const { error } = await db.from("turnos").insert(filas);
      if (error) throw error;
      closeModal();
      await withLoading(loadHorariosWeekCounts);
      await withLoading(loadTablero);
      renderApp();
    } catch (err) {
      console.error(err);
      errorEl.textContent =
        err.code === "23P01" ? "Alguno de esos días ya tiene turnos que se solapan." : err.message || "No se pudo bloquear";
      submitBtn.disabled = false;
    }
  });
}

init();
