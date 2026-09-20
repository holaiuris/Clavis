-- ============================================================
-- Migración v11: lista de espera. Si no hay huecos para una fecha, el
-- cliente se anota (nombre + teléfono) y, si se libera algo ese día
-- (el comercio cancela desde la Agenda, o el cliente cancela desde su
-- link), se le avisa por WhatsApp.
--
-- Ojo, versión simple a propósito: avisa que "se liberó algo ese día",
-- no valida que el hueco puntual que se liberó alcance para la
-- duración del servicio que esa persona quería — de haber un
-- falso positivo, el cliente entra al link, no ve nada que le sirva,
-- y no pasa nada más. Verificar el encaje exacto es un paso extra
-- (correr generar_huecos_disponibles por cada anotado) que no vale la
-- pena todavía.
--
-- Correr DESPUÉS de migracion_v10.sql. No borra nada existente.
-- ============================================================

create table lista_espera (
  id uuid primary key default gen_random_uuid(),
  peluquero_id uuid not null references peluqueros(id) on delete cascade,
  profesional_id uuid references profesionales(id) on delete cascade,
  servicio_id uuid references servicios(id) on delete cascade,
  fecha date not null,
  cliente_nombre text not null,
  cliente_telefono text not null,
  notificado boolean not null default false,
  creado_en timestamptz not null default now()
);

create index lista_espera_peluquero_fecha_idx on lista_espera(peluquero_id, fecha) where not notificado;

comment on table lista_espera is
  'Clientes que pidieron que se les avise si se libera un hueco un día puntual, cuando reservar.html no tenía nada disponible. avisar_lista_espera() los procesa cuando se cancela un turno ese día.';

alter table lista_espera enable row level security;

-- El comercio ve/gestiona su propia lista de espera.
create policy lista_espera_owner_all on lista_espera
  for all using (
    peluquero_id in (select id from peluqueros where user_id = auth.uid())
  )
  with check (
    peluquero_id in (select id from peluqueros where user_id = auth.uid())
  );

-- Un cliente se anota sin login desde reservar.html — mismas guardas
-- que turnos_public_insert (migracion_v6.sql): fecha futura, nombre y
-- teléfono cargados, servicio/profesional reales de ESE comercio.
create policy lista_espera_public_insert on lista_espera
  for insert
  with check (
    fecha >= current_date
    and cliente_nombre is not null
    and cliente_telefono is not null
    and exists (select 1 from servicios s where s.id = servicio_id and s.peluquero_id = peluquero_id and s.activo)
    and exists (select 1 from profesionales p where p.id = profesional_id and p.peluquero_id = peluquero_id and p.activo)
  );

-- Encola un aviso (vía notificaciones_pendientes, mismo mecanismo que
-- ya usan las cancelaciones) para cada anotado sin avisar todavía de
-- esa fecha. hora_inicio no aplica acá (el aviso es "se liberó algo
-- ese día", no una hora puntual) — se manda 00:00 de relleno,
-- server/index.js no la usa para este tipo.
create or replace function avisar_lista_espera(p_peluquero_id uuid, p_fecha date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notificaciones_pendientes (peluquero_id, tipo, cliente_nombre, cliente_telefono, fecha, hora_inicio)
  select peluquero_id, 'hueco_liberado', cliente_nombre, cliente_telefono, fecha, '00:00'::time
  from lista_espera
  where peluquero_id = p_peluquero_id
    and fecha = p_fecha
    and not notificado;

  update lista_espera
  set notificado = true
  where peluquero_id = p_peluquero_id
    and fecha = p_fecha
    and not notificado;
end;
$$;

-- authenticated: app.js la llama directo cuando el COMERCIO cancela
-- desde la Agenda. anon no la necesita de forma directa — cuando
-- cancela un CLIENTE, la llama cancelar_turno_cliente() (redefinida
-- abajo) desde adentro, con los privilegios de esa función (también
-- security definer), no con los de quien la invocó.
grant execute on function avisar_lista_espera(uuid, date) to authenticated;

-- Redefine cancelar_turno_cliente (migracion_v10.sql) para que,
-- además de cancelar, dispare el aviso a la lista de espera de ese
-- comercio/fecha.
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

  delete from turnos where id = p_turno_id;

  perform avisar_lista_espera(v_turno.peluquero_id, v_turno.fecha);
end;
$$;
