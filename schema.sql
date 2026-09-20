-- ============================================================
-- APP TURNOS - Schema Supabase (Postgres)
-- Soporta múltiples peluqueros, cada uno con su propia agenda
-- ============================================================

-- Extensión necesaria para gen_random_uuid()
create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- 1. PELUQUEROS
-- Cada peluquero se vincula a un usuario de Supabase Auth (auth.users)
-- ------------------------------------------------------------
create table peluqueros (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nombre text not null,
  telefono text,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

create unique index peluqueros_user_id_idx on peluqueros(user_id);

-- ------------------------------------------------------------
-- 2. SERVICIOS
-- Cada peluquero define sus propios servicios y duraciones
-- ------------------------------------------------------------
create table servicios (
  id uuid primary key default gen_random_uuid(),
  peluquero_id uuid not null references peluqueros(id) on delete cascade,
  nombre text not null,              -- 'Corte', 'Corte + Barba', 'Color', etc.
  duracion_minutos int not null check (duracion_minutos > 0),
  precio numeric(10,2),
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

create index servicios_peluquero_id_idx on servicios(peluquero_id);

-- ------------------------------------------------------------
-- 3. HORARIOS DE ATENCIÓN
-- Define en qué franjas trabaja cada peluquero, por día de semana
-- (0 = domingo ... 6 = sábado, como date_part('dow', ...))
-- ------------------------------------------------------------
create table horarios_atencion (
  id uuid primary key default gen_random_uuid(),
  peluquero_id uuid not null references peluqueros(id) on delete cascade,
  dia_semana int not null check (dia_semana between 0 and 6),
  hora_apertura time not null,
  hora_cierre time not null,
  check (hora_cierre > hora_apertura)
);

create index horarios_peluquero_id_idx on horarios_atencion(peluquero_id);

-- ------------------------------------------------------------
-- 4. TURNOS
-- El corazón de la app: cada fila es un hueco de agenda
-- ------------------------------------------------------------
create type turno_estado as enum ('libre', 'ocupado', 'bloqueado');
create type turno_origen as enum ('manual', 'whatsapp');

create table turnos (
  id uuid primary key default gen_random_uuid(),
  peluquero_id uuid not null references peluqueros(id) on delete cascade,
  servicio_id uuid references servicios(id) on delete set null,
  fecha date not null,
  hora_inicio time not null,
  hora_fin time not null,
  estado turno_estado not null default 'libre',
  cliente_nombre text,
  cliente_telefono text,
  origen turno_origen not null default 'manual',
  notas text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  check (hora_fin > hora_inicio)
);

create index turnos_peluquero_fecha_idx on turnos(peluquero_id, fecha);
create index turnos_estado_idx on turnos(peluquero_id, estado);

-- Evita solapamiento de turnos ocupados/bloqueados para el mismo peluquero
-- (permite múltiples 'libre' superpuestos si en algún momento se regeneran huecos)
create extension if not exists "btree_gist";

alter table turnos add constraint turnos_no_overlap
  exclude using gist (
    peluquero_id with =,
    fecha with =,
    tsrange(
      (fecha + hora_inicio)::timestamp,
      (fecha + hora_fin)::timestamp
    ) with &&
  )
  where (estado in ('ocupado', 'bloqueado'));

-- Trigger para mantener actualizado_en al día
create or replace function set_actualizado_en()
returns trigger as $$
begin
  new.actualizado_en = now();
  return new;
end;
$$ language plpgsql;

create trigger turnos_set_actualizado_en
  before update on turnos
  for each row execute function set_actualizado_en();

-- ------------------------------------------------------------
-- 5. RLS: cada peluquero ve y edita solo su propia agenda
-- ------------------------------------------------------------
alter table peluqueros enable row level security;
alter table servicios enable row level security;
alter table horarios_atencion enable row level security;
alter table turnos enable row level security;

-- Peluqueros: cada usuario ve/edita su propia fila
create policy peluqueros_select on peluqueros
  for select using (auth.uid() = user_id);
create policy peluqueros_update on peluqueros
  for update using (auth.uid() = user_id);
create policy peluqueros_insert on peluqueros
  for insert with check (auth.uid() = user_id);

-- Servicios: solo el dueño del peluquero_id correspondiente
create policy servicios_all on servicios
  for all using (
    peluquero_id in (select id from peluqueros where user_id = auth.uid())
  )
  with check (
    peluquero_id in (select id from peluqueros where user_id = auth.uid())
  );

-- Horarios de atención: idem
create policy horarios_all on horarios_atencion
  for all using (
    peluquero_id in (select id from peluqueros where user_id = auth.uid())
  )
  with check (
    peluquero_id in (select id from peluqueros where user_id = auth.uid())
  );

-- Turnos: idem
create policy turnos_all on turnos
  for all using (
    peluquero_id in (select id from peluqueros where user_id = auth.uid())
  )
  with check (
    peluquero_id in (select id from peluqueros where user_id = auth.uid())
  );

-- ------------------------------------------------------------
-- 6. Trigger: al crear un usuario nuevo, crear su fila en peluqueros
-- (opcional, comentado por defecto - útil si el alta es self-service)
-- ------------------------------------------------------------
-- create or replace function crear_peluquero_on_signup()
-- returns trigger as $$
-- begin
--   insert into peluqueros (user_id, nombre)
--   values (new.id, coalesce(new.raw_user_meta_data->>'nombre', 'Sin nombre'));
--   return new;
-- end;
-- $$ language plpgsql security definer;
--
-- create trigger on_auth_user_created
--   after insert on auth.users
--   for each row execute function crear_peluquero_on_signup();
