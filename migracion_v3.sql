-- ============================================================
-- Migración v3: trial (sin cobro real), recordatorios de WhatsApp
-- (columnas de config/tracking) y acceso público acotado para que
-- un cliente reserve desde un link sin login.
--
-- Correr DESPUÉS de schema.sql + migracion_v2.sql + huecos.sql +
-- migracion_v3_enum.sql (ese va primero y separado, agrega el valor
-- 'web' al enum turno_origen que este archivo ya da por existente).
-- No borra nada existente.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Trial (informativo, sin cobro real todavía)
-- ------------------------------------------------------------
alter table peluqueros add column plan text not null default 'trial';
alter table peluqueros add column trial_inicio timestamptz not null default now();

comment on column peluqueros.plan is
  'Solo informativo por ahora — no hay cobro real ni gate de funcionalidad. "trial" es el único valor que existe hoy.';
comment on column peluqueros.trial_inicio is
  'Arranca en el alta. La UI calcula "te quedan X días" restando 14 días desde acá — no bloquea nada al vencer.';

-- ------------------------------------------------------------
-- 2. Recordatorios de WhatsApp (config + tracking)
-- ------------------------------------------------------------
-- null = "No enviar". 24 = "1 día antes". 3 = "3 h antes".
alter table peluqueros add column recordatorio_offset_horas int default 24;

alter table turnos add column recordatorio_enviado boolean not null default false;

comment on column peluqueros.recordatorio_offset_horas is
  'Cuántas horas antes del turno se manda el recordatorio de WhatsApp. Null = no enviar.';
comment on column turnos.recordatorio_enviado is
  'Lo marca el server de WhatsApp (server/) después de mandar el mensaje, para no reenviar.';

-- ------------------------------------------------------------
-- 3. Acceso público acotado para el link de reservas
-- (reservar.html) — un cliente reserva SIN loguearse.
-- ------------------------------------------------------------

-- Nombre del comercio (para el encabezado "Reservar en X"). No expone
-- nada de otros comercios más que lo que ya se ve en `peluqueros`
-- (nombre/teléfono del negocio, sin relación con datos de clientes).
create policy peluqueros_public_select on peluqueros
  for select using (true);

-- Servicios y profesionales activos: visibles públicamente para armar
-- el selector del link de reservas (no incluyen datos de clientes).
create policy servicios_public_select on servicios
  for select using (activo = true);

create policy profesionales_public_select on profesionales
  for select using (activo = true);

create policy horarios_public_select on horarios_atencion
  for select using (true);

-- Turnos: SIN policy de select pública (un desconocido no puede leer
-- nombres/teléfonos de otros clientes). Solo puede INSERTAR un turno
-- 'ocupado' con origen 'web', para un servicio/profesional real de ESE
-- comercio, en una fecha futura, con nombre de cliente cargado. El
-- exclude constraint existente sigue protegiendo contra doble reserva.
create policy turnos_public_insert on turnos
  for insert
  with check (
    estado = 'ocupado'
    and origen = 'web'
    and fecha >= current_date
    and cliente_nombre is not null
    and exists (select 1 from servicios s where s.id = servicio_id and s.peluquero_id = peluquero_id and s.activo)
    and exists (select 1 from profesionales p where p.id = profesional_id and p.peluquero_id = peluquero_id and p.activo)
  );

-- generar_huecos_disponibles pasa a "security definer": corre con los
-- permisos de quien la creó (bypassa RLS de las tablas que consulta
-- puertas adentro), así un desconocido puede pedir huecos disponibles
-- sin necesitar acceso de lectura directo a `turnos` (que sigue
-- bloqueado para el público — ver arriba). set search_path fijo por
-- buena práctica de seguridad en funciones security definer.
alter function generar_huecos_disponibles(uuid, date, uuid, uuid, int)
  security definer
  set search_path = public;

grant execute on function generar_huecos_disponibles(uuid, date, uuid, uuid, int) to anon;
