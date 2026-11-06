-- =====================================================================
-- Login con Google: dueño del poroteo (opcional, poroteos siguen públicos)
-- =====================================================================
-- * Los usuarios viven en auth.users (los crea Supabase Auth al iniciar
--   sesión con Google). No hay tabla propia de usuarios.
-- * poroteos.user_id → dueño del poroteo cuando se crea con sesión.
--   Si se borra el usuario, se borran sus poroteos (y en cascada sus votos).
-- * Los poroteos anónimos (user_id null) siguen visibles y editables:
--   el login es opcional y no filtra listados por dueño.
-- * RLS sigue habilitado SIN políticas: solo el backend (clave secreta)
--   accede, por lo que no cambia ninguna política.
-- =====================================================================

alter table public.poroteos
  add column if not exists user_id uuid references auth.users (id) on delete cascade;

create index if not exists poroteos_user_updated_idx
  on public.poroteos (user_id, updated_at desc);

comment on column public.poroteos.user_id is 'Dueño del poroteo (auth.users.id) cuando se crea con login de Google. Null en poroteos anónimos.';

-- Asegura el borrado en cascada de los votos al borrar un poroteo
-- (por si la FK se creó sin "on delete cascade").
alter table public.poroteo_votos drop constraint if exists poroteo_votos_poroteo_id_fkey;
alter table public.poroteo_votos
  add constraint poroteo_votos_poroteo_id_fkey
  foreign key (poroteo_id) references public.poroteos (id) on delete cascade;
