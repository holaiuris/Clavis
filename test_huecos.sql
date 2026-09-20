-- ============================================================
-- Tests de generar_huecos_disponibles — la función más crítica del
-- sistema (si se rompe, se puede doble-reservar o desaparecer huecos
-- que sí están libres).
--
-- No es pgTAP (evita depender de instalar esa extensión) — es un
-- script plpgsql con RAISE EXCEPTION como assert. Corre TODO adentro
-- de una transacción con rollback al final: crea un comercio/
-- profesionales/servicios/turnos de prueba descartables y los
-- deshace, nunca queda nada en la base real. Es seguro correrlo las
-- veces que haga falta.
--
-- Cómo correrlo: pegar el archivo COMPLETO en el SQL Editor de
-- Supabase y Run — tiene que ir como una sola consulta (es una sola
-- transacción de punta a punta), no dividido en pedazos.
--
-- Si algo falla, el mensaje de RAISE EXCEPTION dice exactamente qué
-- caso y por qué. Si todo pasa, vas a ver una notificación "OK" por
-- cada caso en el panel de resultados/logs del SQL Editor.
-- ============================================================

begin;

create temporary table _test_ctx (
  peluquero_id uuid,
  profesional_id uuid,
  profesional_b_id uuid,
  servicio_corto_id uuid,
  servicio_largo_id uuid,
  servicio_muy_largo_id uuid,
  fecha date
);

-- Setup: un comercio de prueba descartable. "Presta" el user_id de
-- cualquier usuario real que ya exista en el proyecto (no se toca ni
-- se lee nada suyo, solo hace falta un id válido para la FK de
-- peluqueros.user_id) — se deshace todo con el rollback del final.
do $$
declare
  v_user_id uuid;
  v_peluquero_id uuid;
  v_profesional_id uuid;
  v_profesional_b_id uuid;
  v_servicio_corto_id uuid;
  v_servicio_largo_id uuid;
  v_servicio_muy_largo_id uuid;
  v_fecha date := current_date + 7;
  v_dia_semana int;
begin
  select id into v_user_id from auth.users limit 1;
  if v_user_id is null then
    raise exception 'No hay ningún usuario en auth.users — hace falta al menos una cuenta real ya creada para poder correr este test.';
  end if;

  insert into peluqueros (user_id, nombre) values (v_user_id, '__test_huecos__') returning id into v_peluquero_id;
  insert into profesionales (peluquero_id, nombre) values (v_peluquero_id, 'Test A') returning id into v_profesional_id;
  insert into profesionales (peluquero_id, nombre) values (v_peluquero_id, 'Test B') returning id into v_profesional_b_id;
  insert into servicios (peluquero_id, nombre, duracion_minutos) values (v_peluquero_id, 'Corto', 30) returning id into v_servicio_corto_id;
  insert into servicios (peluquero_id, nombre, duracion_minutos) values (v_peluquero_id, 'Largo', 240) returning id into v_servicio_largo_id;
  insert into servicios (peluquero_id, nombre, duracion_minutos) values (v_peluquero_id, 'Muy largo', 300) returning id into v_servicio_muy_largo_id;

  -- Horario de atención: 09:00 a 13:00 (4hs), un solo día de la semana.
  v_dia_semana := extract(dow from v_fecha);
  insert into horarios_atencion (peluquero_id, dia_semana, hora_apertura, hora_cierre)
  values (v_peluquero_id, v_dia_semana, '09:00', '13:00');

  insert into _test_ctx
  values (v_peluquero_id, v_profesional_id, v_profesional_b_id, v_servicio_corto_id, v_servicio_largo_id, v_servicio_muy_largo_id, v_fecha);
end $$;

-- Caso 1: ventana libre de 4hs — un servicio de 30min tiene que
-- ofrecer huecos, el primero arrancando justo a la apertura, ninguno
-- pasado el cierre.
do $$
declare
  c record;
  v_count int;
  v_primero time;
  v_ultimo time;
begin
  select * into c from _test_ctx;
  select count(*), min(hora_inicio), max(hora_fin) into v_count, v_primero, v_ultimo
  from generar_huecos_disponibles(c.peluquero_id, c.fecha, c.servicio_corto_id, c.profesional_id);

  if v_count = 0 then
    raise exception 'Caso 1 FALLÓ: debería haber huecos para un servicio de 30min en una ventana libre de 4hs';
  end if;
  if v_primero <> '09:00' then
    raise exception 'Caso 1 FALLÓ: el primer hueco debería arrancar a las 09:00, arrancó a las %', v_primero;
  end if;
  if v_ultimo > '13:00' then
    raise exception 'Caso 1 FALLÓ: ningún hueco debería pasar el cierre (13:00), llegó a las %', v_ultimo;
  end if;
  raise notice 'Caso 1 OK: % huecos, de % a %', v_count, v_primero, v_ultimo;
end $$;

-- Caso 2: servicio más largo que TODA la ventana de atención (300min
-- en una ventana de 240min) no debería ofrecer ningún hueco.
do $$
declare
  c record;
  v_count int;
begin
  select * into c from _test_ctx;
  select count(*) into v_count
  from generar_huecos_disponibles(c.peluquero_id, c.fecha, c.servicio_muy_largo_id, c.profesional_id);

  if v_count <> 0 then
    raise exception 'Caso 2 FALLÓ: un servicio de 300min no debería entrar en una ventana de 240min, dio % huecos', v_count;
  end if;
  raise notice 'Caso 2 OK: servicio más largo que la ventana entera no ofrece huecos';
end $$;

-- Caso 3: turno ocupado pegado al cierre (09:00–12:30) tiene que
-- dejar exactamente el huequito que sobra (12:30–13:00, 30min) — ni
-- más ni menos.
do $$
declare
  c record;
  v_count_corto int;
  v_count_largo int;
begin
  select * into c from _test_ctx;
  insert into turnos (peluquero_id, profesional_id, fecha, hora_inicio, hora_fin, estado, origen)
  values (c.peluquero_id, c.profesional_id, c.fecha, '09:00', '12:30', 'ocupado', 'manual');

  select count(*) into v_count_corto
  from generar_huecos_disponibles(c.peluquero_id, c.fecha, c.servicio_corto_id, c.profesional_id);
  if v_count_corto <> 1 then
    raise exception 'Caso 3 FALLÓ: deberían quedar exactamente 30min libres (1 hueco de servicio corto) pegados al cierre, dio %', v_count_corto;
  end if;

  select count(*) into v_count_largo
  from generar_huecos_disponibles(c.peluquero_id, c.fecha, c.servicio_largo_id, c.profesional_id);
  if v_count_largo <> 0 then
    raise exception 'Caso 3 FALLÓ: un servicio largo no debería entrar en los 30min que quedaron libres, dio %', v_count_largo;
  end if;
  raise notice 'Caso 3 OK: turno pegado al cierre deja exactamente el huequito esperado (30min, ni más ni menos)';
end $$;

-- Caso 4: 'bloqueado' tiene que bloquear huecos exactamente igual que
-- 'ocupado' (mismo exclude constraint, misma lógica en la función).
do $$
declare
  c record;
  v_count_antes int;
  v_count_despues int;
begin
  select * into c from _test_ctx;
  select count(*) into v_count_antes
  from generar_huecos_disponibles(c.peluquero_id, c.fecha, c.servicio_corto_id, c.profesional_b_id);
  if v_count_antes = 0 then
    raise exception 'Caso 4 FALLÓ: el setup está mal — debería haber huecos ANTES de bloquear nada';
  end if;

  insert into turnos (peluquero_id, profesional_id, fecha, hora_inicio, hora_fin, estado, origen, notas)
  values (c.peluquero_id, c.profesional_b_id, c.fecha, '09:00', '13:00', 'bloqueado', 'manual', 'test');

  select count(*) into v_count_despues
  from generar_huecos_disponibles(c.peluquero_id, c.fecha, c.servicio_corto_id, c.profesional_b_id);
  if v_count_despues <> 0 then
    raise exception 'Caso 4 FALLÓ: bloquear el día entero debería dejar 0 huecos, dio %', v_count_despues;
  end if;
  raise notice 'Caso 4 OK: bloqueado bloquea huecos igual que ocupado (% huecos -> %)', v_count_antes, v_count_despues;
end $$;

-- Caso 5: los huecos están scoped por profesional — que A y B estén
-- ocupados/bloqueados no debería afectar a un profesional C sin nada
-- cargado, del mismo comercio.
do $$
declare
  c record;
  v_profesional_c_id uuid;
  v_count int;
begin
  select * into c from _test_ctx;
  insert into profesionales (peluquero_id, nombre) values (c.peluquero_id, 'Test C') returning id into v_profesional_c_id;

  select count(*) into v_count
  from generar_huecos_disponibles(c.peluquero_id, c.fecha, c.servicio_corto_id, v_profesional_c_id);
  if v_count = 0 then
    raise exception 'Caso 5 FALLÓ: un profesional sin turnos cargados debería tener huecos libres, aunque A y B (mismo comercio) estén ocupados/bloqueados';
  end if;
  raise notice 'Caso 5 OK: los huecos están scoped por profesional (% huecos libres para uno sin turnos)', v_count;
end $$;

-- Caso 6: un día de la semana sin ninguna franja en horarios_atencion
-- tiene que dar 0 huecos, sin tirar error.
do $$
declare
  c record;
  v_count int;
begin
  select * into c from _test_ctx;
  select count(*) into v_count
  from generar_huecos_disponibles(c.peluquero_id, c.fecha + 1, c.servicio_corto_id, c.profesional_id);
  if v_count <> 0 then
    raise exception 'Caso 6 FALLÓ: un día sin horario_atencion configurado debería dar 0 huecos, dio %', v_count;
  end if;
  raise notice 'Caso 6 OK: día sin horario configurado da 0 huecos, sin error';
end $$;

rollback;
