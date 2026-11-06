-- =====================================================================
-- Cuentas de usuario: cada poroteo pertenece a un usuario de Supabase Auth
-- =====================================================================
-- * Los usuarios viven en auth.users (los maneja Supabase Auth).
--   El nombre se guarda en raw_user_meta_data->>'nombre' al registrarse.
-- * poroteos.user_id → dueño del poroteo. Si se borra el usuario, se
--   borran sus poroteos (y en cascada sus votos).
-- * RLS sigue habilitado SIN políticas: solo el backend (clave secreta)
--   accede, y filtra siempre por user_id del token.
-- =====================================================================

alter table public.poroteos
  add column if not exists user_id uuid references auth.users (id) on delete cascade;

-- Listado "mis poroteos" ordenado por última modificación.
create index if not exists poroteos_user_updated_idx
  on public.poroteos (user_id, updated_at desc);

comment on column public.poroteos.user_id is 'Dueño del poroteo (auth.users.id). Solo él puede verlo y editarlo.';

-- Asegura el borrado en cascada de los votos al borrar un poroteo
-- (por si la FK se creó sin "on delete cascade").
alter table public.poroteo_votos drop constraint if exists poroteo_votos_poroteo_id_fkey;
alter table public.poroteo_votos
  add constraint poroteo_votos_poroteo_id_fkey
  foreign key (poroteo_id) references public.poroteos (id) on delete cascade;

-- ---------------------------------------------------------------------
-- Poroteos creados antes del login (user_id null): nadie los ve.
-- Para asignarlos a una cuenta, después de registrarla:
--
--   update public.poroteos
--   set user_id = (select id from auth.users where email = 'tu@email.com')
--   where user_id is null;
--
-- Cuando no quede ninguno sin dueño, se puede hacer obligatorio:
--
--   alter table public.poroteos alter column user_id set not null;
-- ---------------------------------------------------------------------
