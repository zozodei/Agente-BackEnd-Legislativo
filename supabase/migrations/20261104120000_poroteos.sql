-- =====================================================================
-- Poroteo: tablas propias + función de alineación con el bloque
-- =====================================================================
-- Diseño pensado para que la IA escriba en la misma estructura:
--   * poroteos.origen          → 'manual' | 'ia' | 'mixto'
--   * poroteo_votos.origen     → 'manual' | 'ia'
--   * poroteo_votos.confianza  → 0..1 (null cuando es manual)
--   * poroteo_votos.justificacion / fuentes → explicación y citas de la IA
--
-- Seguridad: RLS habilitado SIN políticas → anon/authenticated no pueden
-- leer ni escribir. Solo el backend (clave secreta / service_role) accede.
-- =====================================================================

create table if not exists public.poroteos (
  id              uuid primary key default gen_random_uuid(),
  titulo          text not null check (char_length(titulo) between 3 and 300),
  descripcion     text check (char_length(descripcion) <= 5000),
  texto_proyecto  text,                       -- texto pegado o extraído del PDF
  archivo_nombre  text,                       -- nombre del PDF original (si hubo)
  camara          text not null default 'diputados'
                  check (camara in ('diputados', 'senadores')),
  tipo_mayoria    text not null default 'simple'
                  check (tipo_mayoria in ('simple', 'absoluta', 'dos_tercios')),
  estado          text not null default 'borrador'
                  check (estado in ('borrador', 'final')),
  origen          text not null default 'manual'
                  check (origen in ('manual', 'ia', 'mixto')),
  autor           text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.poroteo_votos (
  poroteo_id     uuid   not null references public.poroteos(id) on delete cascade,
  diputado_id    bigint not null references public.diputados(id) on delete cascade,
  voto           text   not null
                 check (voto in ('AFIRMATIVO', 'NEGATIVO', 'ABSTENCION', 'AUSENTE', 'INDEFINIDO')),
  origen         text   not null default 'manual' check (origen in ('manual', 'ia')),
  confianza      numeric(4, 3) check (confianza is null or (confianza >= 0 and confianza <= 1)),
  justificacion  text,
  fuentes        jsonb,
  updated_at     timestamptz not null default now(),
  primary key (poroteo_id, diputado_id)
);

create index if not exists poroteos_created_at_idx on public.poroteos (created_at desc);
create index if not exists poroteo_votos_diputado_idx on public.poroteo_votos (diputado_id);

alter table public.poroteos      enable row level security;
alter table public.poroteo_votos enable row level security;

-- set_updated_at() ya existe en la base (lo usa diputados)
drop trigger if exists poroteos_set_updated_at on public.poroteos;
create trigger poroteos_set_updated_at before update on public.poroteos
  for each row execute function public.set_updated_at();

drop trigger if exists poroteo_votos_set_updated_at on public.poroteo_votos;
create trigger poroteo_votos_set_updated_at before update on public.poroteo_votos
  for each row execute function public.set_updated_at();

comment on table public.poroteos is 'Poroteos (estimaciones de votación) de proyectos de ley. Escritura solo desde el backend.';
comment on table public.poroteo_votos is 'Voto estimado de cada diputado en un poroteo. origen/confianza preparados para IA.';

-- ---------------------------------------------------------------------
-- Alineación de una persona con la mayoría de SU bloque en cada votación
-- (bloque que tenía en ese momento). Cuenta solo votaciones donde votó
-- AFIRMATIVO / NEGATIVO / ABSTENCION.
-- ---------------------------------------------------------------------
create or replace function public.fn_alineacion_bloque(
  p_persona_id   integer,
  p_solo_general boolean default false
)
returns table (votaciones integer, coincidencias integer, porcentaje numeric)
language sql
stable
security invoker
set search_path = public
as $$
  with mine as (
    select v.votacion_id, v.bloque_id, v.voto
    from cv_votos v
    join cv_votaciones vt on vt.id = v.votacion_id
    where v.persona_id = p_persona_id
      and v.bloque_id is not null
      and v.voto in ('AFIRMATIVO', 'NEGATIVO', 'ABSTENCION')
      and (not p_solo_general or vt.es_general)
  ),
  bloque_votos as (
    select o.votacion_id, o.voto, count(*) as n
    from cv_votos o
    join mine m on m.votacion_id = o.votacion_id and m.bloque_id = o.bloque_id
    where o.persona_id <> p_persona_id
      and o.voto in ('AFIRMATIVO', 'NEGATIVO', 'ABSTENCION')
    group by o.votacion_id, o.voto
  ),
  mayoria as (
    select distinct on (votacion_id) votacion_id, voto
    from bloque_votos
    order by votacion_id, n desc
  )
  select
    count(*)::int,
    (count(*) filter (where m.voto = ma.voto))::int,
    round(100.0 * count(*) filter (where m.voto = ma.voto) / nullif(count(*), 0), 1)
  from mine m
  join mayoria ma using (votacion_id);
$$;

comment on function public.fn_alineacion_bloque is 'Porcentaje de votaciones en que la persona votó igual que la mayoría de su bloque.';
