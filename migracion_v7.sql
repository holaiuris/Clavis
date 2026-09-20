-- ============================================================
-- Migración v7: cierre de 3 huecos de seguridad en el acceso público
-- (reservar.html / anon key) encontrados en revisión de código.
--
-- Correr DESPUÉS de migracion_v6.sql. No borra nada existente.
-- ============================================================

-- ------------------------------------------------------------
-- 1. peluqueros_public_select exponía la tabla ENTERA (RLS es
-- row-level, no column-level — que reservar.js solo pida ciertas
-- columnas no protege nada contra alguien pegándole directo a
-- /rest/v1/peluqueros?select=* con la anon key, que hoy se lleva
-- telefono/plan/trial_inicio/recordatorio_offset_horas de TODOS los
-- comercios, no solo el que está mirando).
--
-- La policy original de schema.sql (peluqueros_select, scoped por
-- user_id = auth.uid()) sigue cubriendo al dueño autenticado — esta
-- policy pública era una OR adicional que de hecho la volvía inútil
-- (using(true) es superset de cualquier otra condición). Se puede
-- borrar sin romper nada del lado logueado.
--
-- En su lugar: una vista con solo las columnas que reservar.html
-- necesita mostrar. Una vista (sin security_invoker) corre con los
-- permisos de quien la creó, no con RLS de quien consulta — por eso
-- alcanza con no incluir ahí telefono/plan/trial_inicio/etc.
drop policy peluqueros_public_select on peluqueros;

create view peluqueros_publico as
  select id, nombre, slug, aviso_minimo_horas, color_acento, logo_url
  from peluqueros;

grant select on peluqueros_publico to anon, authenticated;

comment on view peluqueros_publico is
  'Lo único que reservar.html puede ver de un comercio sin login. NUNCA agregar acá telefono/plan/trial_inicio/recordatorio_offset_horas ni ninguna columna nueva sin pensarlo — ver migracion_v7.sql.';

-- ------------------------------------------------------------
-- 2. turnos_public_insert no validaba que hora_fin - hora_inicio
-- coincida con la duración real del servicio elegido — alguien
-- pegándole directo a la API (sin pasar por generar_huecos_disponibles)
-- podía insertar un turno de 5 minutos usando el id de un servicio de
-- 90', sin pisar el exclude constraint.
drop policy turnos_public_insert on turnos;

create policy turnos_public_insert on turnos
  for insert
  with check (
    estado = 'ocupado'
    and origen = 'web'
    and fecha >= current_date
    and cliente_nombre is not null
    and cliente_telefono is not null
    and exists (
      select 1 from servicios s
      where s.id = servicio_id
        and s.peluquero_id = peluquero_id
        and s.activo
        and hora_fin = hora_inicio + (s.duracion_minutos || ' minutes')::interval
    )
    and exists (select 1 from profesionales p where p.id = profesional_id and p.peluquero_id = peluquero_id and p.activo)
  );

-- ------------------------------------------------------------
-- 3. Anti-spam: honeypot ya resuelto del lado de reservar.js/html (no
-- necesita SQL, ver ese commit). hCaptcha/Turnstile de verdad queda
-- pendiente — requiere que el dueño cree una cuenta en ese servicio,
-- no es algo que se resuelva desde acá.
