-- ============================================================
-- Migración v6: link público más lindo (clavis.ar/r/<slug> en vez de
-- reservar.html?c=<uuid>) y aviso al cliente cuando el comercio
-- cancela un turno.
--
-- Correr DESPUÉS de migracion_v5.sql. No borra nada existente.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Slug del comercio para el link público
-- ------------------------------------------------------------
alter table peluqueros add column slug text unique;

comment on column peluqueros.slug is
  'Identificador corto y legible para el link público (ej. "peluqueria-lucia"). Null = todavía no lo configuró, reservar.html sigue funcionando por ?c=<id>. Se resuelve en /r/<slug> vía rewrite del hosting (ver DEPLOY.md) o reservar.html?slug=<slug> directo.';

-- Ya expuesto por peluqueros_public_select (migracion_v3.sql).

-- ------------------------------------------------------------
-- 2. Cola de notificaciones para el server de WhatsApp
-- ------------------------------------------------------------
-- Cuando el comercio cancela/libera un turno desde la Agenda, no
-- alcanza con borrar la fila de `turnos` (así es como se liberan
-- huecos, ver CLAUDE.md) — hace falta guardar algo para que
-- server/index.js le avise al cliente. Tabla chica y desacoplada en
-- vez de una columna en `turnos`, justamente porque el turno se borra.
create table notificaciones_pendientes (
  id uuid primary key default gen_random_uuid(),
  peluquero_id uuid not null references peluqueros(id) on delete cascade,
  tipo text not null default 'cancelacion',
  cliente_nombre text not null,
  cliente_telefono text,
  fecha date not null,
  hora_inicio time not null,
  enviado boolean not null default false,
  creado_en timestamptz not null default now()
);

create index notificaciones_pendientes_peluquero_id_idx on notificaciones_pendientes(peluquero_id);
create index notificaciones_pendientes_enviado_idx on notificaciones_pendientes(enviado) where not enviado;

comment on table notificaciones_pendientes is
  'Cola simple: la app inserta acá al cancelar un turno (con el teléfono del cliente, si lo tenía), server/index.js la revisa junto con los recordatorios y manda el WhatsApp de aviso, marcando enviado = true.';

alter table notificaciones_pendientes enable row level security;

create policy notificaciones_pendientes_select on notificaciones_pendientes
  for select using (
    peluquero_id in (select id from peluqueros where user_id = auth.uid())
  );

create policy notificaciones_pendientes_insert on notificaciones_pendientes
  for insert with check (
    peluquero_id in (select id from peluqueros where user_id = auth.uid())
  );

-- server/index.js usa la service_role key (bypassa RLS) para leer
-- todas las pendientes de todos los comercios y marcarlas enviadas —
-- no necesita una policy propia, igual que ya hace con `turnos`.

-- ------------------------------------------------------------
-- 3. Teléfono obligatorio al reservar desde el link público
-- ------------------------------------------------------------
-- El form ya lo pide como "required" en reservar.html, pero eso es
-- solo UX — la garantía real tiene que estar acá, igual que ya pasa
-- con cliente_nombre.
drop policy turnos_public_insert on turnos;

create policy turnos_public_insert on turnos
  for insert
  with check (
    estado = 'ocupado'
    and origen = 'web'
    and fecha >= current_date
    and cliente_nombre is not null
    and cliente_telefono is not null
    and exists (select 1 from servicios s where s.id = servicio_id and s.peluquero_id = peluquero_id and s.activo)
    and exists (select 1 from profesionales p where p.id = profesional_id and p.peluquero_id = peluquero_id and p.activo)
  );
