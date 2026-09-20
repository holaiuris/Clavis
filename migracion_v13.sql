-- ============================================================
-- Migración v13: redefine cancelar_turno_cliente() para que use el
-- nuevo valor 'cancelado' del enum turno_estado. Va SOLA, en su
-- propia transacción — Postgres no deja usar un valor de enum nuevo
-- en la misma transacción en que se lo crea, por eso no puede ir
-- junto con migracion_v12.sql (mismo motivo que
-- migracion_v3_enum.sql en su momento).
--
-- Correr DESPUÉS de migracion_v12.sql, como consulta separada.
-- ============================================================

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

  insert into notificaciones_pendientes (peluquero_id, tipo, cliente_nombre, cliente_telefono, fecha, hora_inicio)
  values (v_turno.peluquero_id, 'cliente_cancelo', v_turno.cliente_nombre, v_turno.cliente_telefono, v_turno.fecha, v_turno.hora_inicio);

  update turnos set estado = 'cancelado' where id = p_turno_id;

  perform avisar_lista_espera(v_turno.peluquero_id, v_turno.fecha);
end;
$$;
