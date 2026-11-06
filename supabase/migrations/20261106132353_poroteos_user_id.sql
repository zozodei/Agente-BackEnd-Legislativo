-- Registra el esquema preparado. No reasigna registros anteriores ni modifica Auth.
begin;

alter table public.poroteos add column if not exists user_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.poroteos'::regclass
      and conname = 'poroteos_user_id_fkey'
  ) then
    alter table public.poroteos
      add constraint poroteos_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end;
$$;

create index if not exists poroteos_user_updated_idx
  on public.poroteos (user_id, updated_at desc);

alter table public.poroteos enable row level security;
alter table public.poroteo_votos enable row level security;
-- Solo el backend accede; no se agregan políticas ni permisos públicos.
revoke all on table public.poroteos, public.poroteo_votos from anon, authenticated;

comment on column public.poroteos.user_id is
  'Propietario de Supabase Auth. NULL identifica registros anteriores pendientes de asignación explícita.';

commit;
