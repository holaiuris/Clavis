-- ============================================================
-- Migración v14: integración con Google Calendar (solo exportar —
-- cada turno ocupado en Clavis se refleja como evento en el Google
-- Calendar del comercio). Clavis sigue siendo la única fuente de
-- verdad de disponibilidad; esto es un espejo de lectura para ver
-- la agenda desde el celular sin abrir la app.
--
-- Requiere login con Google ya configurado (ver SETUP.md) — la
-- conexión a Calendar es un flujo OAuth aparte, manejado por
-- server/calendar.js (nuevo), NO por Supabase Auth: necesitamos
-- guardar y refrescar un refresh_token de Google del lado del
-- servidor, algo que Supabase Auth no expone de forma utilizable acá.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Token de Google guardado — nunca legible desde el navegador
-- ------------------------------------------------------------
-- El refresh_token es una credencial: quien lo tenga puede crear/
-- borrar eventos en el Calendar del comercio indefinidamente. Por
-- eso esta tabla NO tiene policy de select ni de insert/update para
-- usuarios normales — solo el server (service_role, bypassa RLS) lo
-- escribe y lee. El dueño puede desconectar (delete) su propia fila,
-- pero nunca leerla de vuelta.
create table integraciones_google_calendar (
  id uuid primary key default gen_random_uuid(),
  peluquero_id uuid not null references peluqueros(id) on delete cascade unique,
  refresh_token text not null,
  creado_en timestamptz not null default now()
);

alter table integraciones_google_calendar enable row level security;

create policy integraciones_google_calendar_delete on integraciones_google_calendar
  for delete using (
    peluquero_id in (select id from peluqueros where user_id = auth.uid())
  );

-- server/calendar.js usa la service_role key para insertar (al
-- conectar) y seleccionar (al crear/borrar eventos) — no necesita
-- policies propias, bypassa RLS igual que server/index.js con `turnos`.

-- ------------------------------------------------------------
-- 2. Estado de conexión, visible desde la app sin tocar el token
-- ------------------------------------------------------------
-- La UI (Horarios) necesita saber "¿está conectado sí o no?" para
-- mostrar el botón correcto, sin poder leer jamás el token en sí.
alter table peluqueros add column google_calendar_conectado boolean not null default false;

-- ------------------------------------------------------------
-- 3. Qué evento de Calendar le corresponde a cada turno
-- ------------------------------------------------------------
-- No es secreto (un id de evento solo no sirve sin el token), así
-- que sigue las mismas policies que ya tiene `turnos`.
alter table turnos add column google_event_id text;
