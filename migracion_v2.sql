-- ============================================================
-- Migración v2: multi-profesional, historial de clientes y
-- seguimiento de ausencias (para las métricas de ocupación).
--
-- Correr DESPUÉS de schema.sql + huecos.sql, sobre un proyecto
-- que YA tiene datos reales (peluqueros/servicios/horarios/turnos).
-- No borra nada existente; agrega tablas/columnas y migra lo que
-- ya estaba cargado.
-- ============================================================

-- ------------------------------------------------------------
-- 1. PROFESIONALES
-- Personal que atiende dentro de un mismo comercio (peluquero).
-- No tienen login propio: los gestiona el dueño de la cuenta
-- desde "Configuración". Comparten el horario de atención del
-- comercio, pero cada uno tiene su propia agenda (no se pisan
-- entre sí, ver el constraint más abajo).
-- ------------------------------------------------------------
create table profesionales (
  id uuid primary key default gen_random_uuid(),
  peluquero_id uuid not null references peluqueros(id) on delete cascade,
  nombre text not null,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

create index profesionales_peluquero_id_idx on profesionales(peluquero_id);

alter table profesionales enable row level security;
create policy profesionales_all on profesionales
  for all using (
    peluquero_id in (select id from peluqueros where user_id = auth.uid())
  )
  with check (
    peluquero_id in (select id from peluqueros where user_id = auth.uid())
  );

-- Cada peluquero existente arranca con un profesional "Vos", para
-- que los turnos que ya tenías cargados no queden sin asignar.
insert into profesionales (peluquero_id, nombre)
select id, 'Vos' from peluqueros;

-- ------------------------------------------------------------
-- 2. CLIENTES
-- Antes nombre/teléfono vivían sueltos en cada turno. Ahora hay
-- una fila por cliente (por comercio) para poder mostrar
-- "cliente desde X" en el detalle del turno.
-- ------------------------------------------------------------
create table clientes (
  id uuid primary key default gen_random_uuid(),
  peluquero_id uuid not null references peluqueros(id) on delete cascade,
  nombre text not null,
  telefono text,
  creado_en timestamptz not null default now()
);

create index clientes_peluquero_id_idx on clientes(peluquero_id);
-- Dedupe por teléfono dentro del mismo comercio (cuando hay teléfono cargado).
create unique index clientes_peluquero_telefono_idx
  on clientes(peluquero_id, telefono) where telefono is not null;

alter table clientes enable row level security;
create policy clientes_all on clientes
  for all using (
    peluquero_id in (select id from peluqueros where user_id = auth.uid())
  )
  with check (
    peluquero_id in (select id from peluqueros where user_id = auth.uid())
  );

-- Migra los clientes que ya estaban sueltos en turnos: uno por
-- teléfono (si lo tenían) o por nombre (si no).
insert into clientes (peluquero_id, nombre, telefono, creado_en)
select peluquero_id,
       (array_agg(cliente_nombre order by creado_en))[1],
       cliente_telefono,
       min(creado_en)
from turnos
where cliente_nombre is not null and cliente_telefono is not null
group by peluquero_id, cliente_telefono
union all
select peluquero_id,
       cliente_nombre,
       null,
       min(creado_en)
from turnos
where cliente_nombre is not null and cliente_telefono is null
group by peluquero_id, cliente_nombre;

-- ------------------------------------------------------------
-- 3. Nuevas columnas en turnos
-- ------------------------------------------------------------
alter table turnos add column cliente_id uuid references clientes(id) on delete set null;
alter table turnos add column profesional_id uuid references profesionales(id) on delete set null;
-- null = todavía no pasó / no se marcó. true = vino. false = ausente.
alter table turnos add column asistio boolean;

comment on column turnos.asistio is
  'Se marca a mano después del turno. Null = sin marcar (no cuenta para % de ausencias).';

-- Backfill: linkear turnos existentes con el cliente que migramos arriba.
update turnos t
set cliente_id = c.id
from clientes c
where t.peluquero_id = c.peluquero_id
  and (
    (t.cliente_telefono is not null and t.cliente_telefono = c.telefono)
    or (t.cliente_telefono is null and t.cliente_nombre = c.nombre and c.telefono is null)
  );

-- Backfill: asignar el profesional "Vos" a los turnos que ya existían.
update turnos t
set profesional_id = p.id
from profesionales p
where t.peluquero_id = p.peluquero_id
  and p.nombre = 'Vos'
  and t.profesional_id is null;

-- ------------------------------------------------------------
-- 4. Constraint de solapamiento: ahora es por profesional, no por
-- comercio entero — así dos profesionales pueden atender a la vez.
-- ------------------------------------------------------------
alter table turnos drop constraint turnos_no_overlap;

alter table turnos add constraint turnos_no_overlap
  exclude using gist (
    peluquero_id with =,
    profesional_id with =,
    fecha with =,
    tsrange(
      (fecha + hora_inicio)::timestamp,
      (fecha + hora_fin)::timestamp
    ) with &&
  )
  where (estado in ('ocupado', 'bloqueado'));
