-- ============================================================
-- Generación de huecos disponibles
-- ============================================================
-- Orden de instalación: schema.sql -> migracion_v2.sql -> huecos.sql
-- (esta versión usa turnos.profesional_id, que migracion_v2.sql agrega).
--
-- Decisión de diseño: los turnos 'libre' NO se guardan como filas.
-- Guardar de antemano todas las combinaciones posibles de huecos
-- libres se rompe apenas cambia la duración del servicio elegido
-- (un mismo horario abierto da huecos distintos según si el
-- cliente pide "Corte" de 30' o "Color" de 90').
--
-- En cambio, la tabla `turnos` solo guarda lo que realmente ocupa
-- la agenda: 'ocupado' y 'bloqueado'. Lo 'libre' se calcula al
-- vuelo con esta función, cruzando:
--   1) el horario de atención del día (horarios_atencion)
--   2) la duración del servicio elegido (servicios.duracion_minutos)
--   3) los huecos ya ocupados/bloqueados ese día (turnos)
--
-- Esto es lo que alimenta la línea de tiempo del día.
--
-- v2: recibe también p_profesional_id — desde que un comercio puede
-- tener varios profesionales (ver migracion_v2.sql), los huecos se
-- calculan contra la agenda de ESE profesional puntual, no la del
-- comercio entero (dos profesionales pueden tener turnos a la misma
-- hora sin pisarse).
-- ============================================================

drop function if exists generar_huecos_disponibles(uuid, date, uuid, int);

create or replace function generar_huecos_disponibles(
  p_peluquero_id uuid,
  p_fecha date,
  p_servicio_id uuid,
  p_profesional_id uuid,
  p_granularidad_minutos int default 15   -- cada cuántos minutos "probamos" un inicio de turno
)
returns table (hora_inicio time, hora_fin time)
language plpgsql
stable
as $$
declare
  v_duracion int;
  v_dia_semana int;
begin
  -- Duración del servicio pedido
  select duracion_minutos into v_duracion
  from servicios
  where id = p_servicio_id and peluquero_id = p_peluquero_id;

  if v_duracion is null then
    raise exception 'Servicio % no encontrado para el peluquero %', p_servicio_id, p_peluquero_id;
  end if;

  v_dia_semana := extract(dow from p_fecha);

  return query
  with ventanas as (
    select ha.hora_apertura, ha.hora_cierre
    from horarios_atencion ha
    where ha.peluquero_id = p_peluquero_id
      and ha.dia_semana = v_dia_semana
  ),
  candidatos as (
    -- generamos posibles horas de inicio cada `granularidad` minutos,
    -- dentro de cada ventana de atención, dejando lugar para la duración completa
    select
      (v.hora_apertura + (n * p_granularidad_minutos) * interval '1 minute')::time as inicio,
      (v.hora_apertura + (n * p_granularidad_minutos) * interval '1 minute' + v_duracion * interval '1 minute')::time as fin
    from ventanas v,
      generate_series(
        0,
        floor(
          (extract(epoch from (v.hora_cierre - v.hora_apertura)) / 60 - v_duracion)
          / p_granularidad_minutos
        )::int
      ) as n
  ),
  ocupados as (
    select t.hora_inicio, t.hora_fin
    from turnos t
    where t.peluquero_id = p_peluquero_id
      and t.profesional_id = p_profesional_id
      and t.fecha = p_fecha
      and t.estado in ('ocupado', 'bloqueado')
  )
  select c.inicio, c.fin
  from candidatos c
  where not exists (
    select 1 from ocupados o
    where (p_fecha + c.inicio, p_fecha + c.fin) overlaps (p_fecha + o.hora_inicio, p_fecha + o.hora_fin)
  )
  order by c.inicio;
end;
$$;

comment on function generar_huecos_disponibles is
  'Calcula los huecos libres de un profesional puntual en una fecha dada, para la duración de un servicio. No modifica datos: es de solo lectura (línea de tiempo del día).';
