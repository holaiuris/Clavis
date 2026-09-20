-- ============================================================
-- Migración v5: personalización de marca para el link público de
-- reservas (reservar.html) — cada comercio puede poner su color de
-- acento y su logo.
--
-- Correr DESPUÉS de migracion_v4.sql. No borra nada existente.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Columnas de marca en peluqueros
-- ------------------------------------------------------------
alter table peluqueros add column color_acento text;
alter table peluqueros add column logo_url text;

comment on column peluqueros.color_acento is
  'Hex (#rrggbb) opcional. Si está null, reservar.html usa el celeste de Clavis por defecto.';
comment on column peluqueros.logo_url is
  'URL pública del logo subido al bucket de storage "logos". Si está null, reservar.html muestra el nombre del comercio en texto.';

-- Ya expuesto por la policy peluqueros_public_select (migracion_v3.sql,
-- "for select using (true)") — no hace falta tocar RLS de la tabla.

-- ------------------------------------------------------------
-- 2. Bucket de storage para los logos
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

-- Cualquiera puede leer (el link público necesita mostrar el logo sin
-- login). Subir/reemplazar/borrar solo el dueño del comercio, y solo
-- dentro de su propia carpeta "<peluquero_id>/..." — así un comercio
-- no puede pisar el logo de otro.
create policy logos_public_read on storage.objects
  for select using (bucket_id = 'logos');

create policy logos_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] = (select id::text from peluqueros where user_id = auth.uid())
  );

create policy logos_owner_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] = (select id::text from peluqueros where user_id = auth.uid())
  );

create policy logos_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] = (select id::text from peluqueros where user_id = auth.uid())
  );
