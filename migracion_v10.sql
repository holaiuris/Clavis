-- ============================================================
-- Migración v10: el cliente puede ver y cancelar su propio turno
-- desde un link, sin escribirle al comercio.
--
-- El link es reservar.html?turno=<turno_id> — el UUID del turno hace
-- de "contraseña": es aleatorio (122 bits), nadie lo puede adivinar,
-- y solo lo tiene quien reservó (el mensaje de confirmación de
-- WhatsApp lo incluye, ver server/index.js). Por eso NO hace falta
-- (ni conviene) una policy pública de SELECT sobre `turnos` — sería
-- volver a exponer todo lo que migracion_v7.sql cerró. En cambio, dos
-- funciones security definer bien acotadas: una para leer un turno
-- puntual por id, otra para cancelarlo. ninguna de las dos permite
-- listar ni buscar turnos, solo operar sobre un id ya conocido.
--
-- Correr DESPUÉS de migracion_v9.sql. No borra nada existente.
-- ============================================================

create or replace function obtener_turno_cliente(p_turno_id uuid)
returns table (
  turno_id uuid,
  comercio_nombre text,
  servicio_nombre text,
  profesional_nombre text,
  cliente_nombre text,
  fecha date,
  hora_inicio time,
  hora_fin time
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
  select
    t.id,
    p.nombre,
    s.nombre,
    pr.nombre,
    t.cliente_nombre,
    t.fecha,
    t.hora_inicio,
    t.hora_fin
  from turnos t
  join peluqueros p on p.id = t.peluquero_id
  left join servicios s on s.id = t.servicio_id
  left join profesionales pr on pr.id = t.profesional_id
  where t.id = p_turno_id
    and t.estado = 'ocupado'
    and t.origen = 'web';
end;
$$;

grant execute on function obtener_turno_cliente(uuid) to anon;

create or replace function cancelar_turno_cliente(p_turno_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_turno turnos%rowtype;
begin
  select * into v_turno
  from turnos
  where id = p_turno_id
    and estado = 'ocupado'
    and origen = 'web'
    and fecha >= current_date;

  if not found then
    raise exception 'Turno no encontrado o ya no se puede cancelar desde acá.';
  end if;

  -- Avisa al COMERCIO (no al cliente, que es quien está cancelando)
  -- reusando notificaciones_pendientes con un tipo nuevo — server/
  -- index.js lo manda a peluqueros.telefono en vez de a
  -- cliente_telefono para este tipo puntual.
  insert into notificaciones_pendientes (peluquero_id, tipo, cliente_nombre, cliente_telefono, fecha, hora_inicio)
  values (v_turno.peluquero_id, 'cliente_cancelo', v_turno.cliente_nombre, v_turno.cliente_telefono, v_turno.fecha, v_turno.hora_inicio);

  delete from turnos where id = p_turno_id;
end;
$$;

grant execute on function cancelar_turno_cliente(uuid) to anon;
