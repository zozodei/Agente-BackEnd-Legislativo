# Diagnóstico del dataset y de Supabase

_Fecha: 20/11/2026 · Rama `feature/poroteo-ia-completo` · Datos al 31/10/2026_

## 1. Qué hay

El dataset **no estaba perdido**: está cargado en Supabase (proyecto `jhwsuyydwfqnegpufrqs`,
Postgres 17) desde **¿Cómo Votó?** (Rodrigo Quiroga, commit `d6c7d5b`, cargado el 04/11/2026),
que a su vez toma las actas oficiales de votaciones.hcdn.gob.ar. El zip `Poroteo_Diputados_Fase4`
que usa la rama `ML-TESTING` es externo y no está en ningún repo; no hizo falta.

Se exportó completo a `data/raw/*.json.gz` (`scripts/dataset/exportar-supabase.mjs`, solo
lectura). Ese export es además el **backup** de los datos de origen antes de cualquier cambio.

| Tabla | Filas | Contenido |
|---|---:|---|
| `cv_votaciones` | 2.992 | Votaciones nominales de Diputados 1993–2026 (1.938 "en general") |
| `cv_votos` | 768.789 | Un voto por persona y votación, con bloque y provincia de ese momento |
| `cv_personas` | 2.062 | Todos los que pasaron por la Cámara desde 1993 |
| `cv_leyes` | 1.937 | Votaciones agrupadas por ley, con keywords |
| `cv_mandatos` / `cv_elecciones` | 2.690 / 5.643 | Períodos y listas electas |
| `cv_bloques` / `cv_provincias` | 309 / 24 | Catálogos históricos |
| `diputados`, `bloques`, `distritos` | 257 / 21 / 24 | Composición actual (CSV oficial HCDN) |
| `poroteos`, `poroteo_votos`, `poroteo_usuarios` | — | Tablas propias del poroteo manual |

Distribución de votos: afirmativo 56,4 %, ausente 23,1 %, negativo 17,9 %, abstención 2,2 %,
presidente 0,4 %. Votaciones por gobierno: Menem 211, De la Rúa 84, Duhalde 49, Kirchner 625,
Fernández de Kirchner 774, Macri 520, Fernández 311, Milei 418.

Composición actual (257): La Libertad Avanza 95, Unión por la Patria 92, Provincias Unidas 18,
PRO 12, Argentina Federal 9, UCR 6 y 15 bloques chicos. 135 diputados asumieron en diciembre de
2025; todos tienen al menos algún voto registrado.

## 2. Problemas encontrados y qué se hizo

Todo se corrigió en **tablas nuevas o en el código**; las tablas de origen no se modificaron.
Detalle reproducible en `data/dataset/limpieza.json` (`scripts/dataset/construir.mjs`).

| # | Problema | Magnitud | Tratamiento |
|---|---|---|---|
| 1 | **Conteos corridos** en `cv_votaciones`: `afirmativos` guarda los negativos, `negativos` las abstenciones, `abstenciones` los ausentes y `ausentes` = 0. Ej.: IVE (votación 1516) figura 125/1/1/0 y fue 129–125. **La lista de votaciones de la app mostraba estos números.** | 2.974 de 2.992 votaciones | Conteos recalculados desde `cv_votos` (coinciden con `conteo_coaliciones.tot`). El backend ahora usa `conteo_coaliciones.tot`. Tabla `votaciones_enriquecidas` + vista `votaciones`. |
| 2 | `resultado` con números (`"218"`, `"47"`…) | 4 | Recalculado comparando afirmativos y negativos; original en `resultado_original`. |
| 3 | Votos sin provincia | 997 | Completados con la provincia del mismo legislador en la votación más cercana (la provincia no cambia dentro de un mandato). Tabla `votos_correcciones` + vista `votos`. |
| 4 | Mismo bloque escrito distinto ("Movimiento Popular  Neuquino", "Pts-frente De Izquierda…") | 309 → 304 bloques | Unificados por nombre normalizado: `bloques_unificados` y `bloques_variantes`. |
| 5 | Etiqueta `coalicion` inconsistente (p. ej. "Unión Cívica Radical" → PRO; una persona de LLA → JxC) | sistemática | **No se usa como verdad.** La relación con el oficialismo se mide con los votos: coincidencia con la mayoría del bloque del presidente en funciones (`gobiernos`). |
| 6 | Cambios de bloque | 892 personas | Historial de tramos por persona en `historial_bloques`. El modelo arma la "posición del bloque" con quienes **hoy** integran el bloque, así funciona aunque el bloque sea nuevo o haya cambiado de nombre. |
| 7 | Persona inválida (`id 1`, nombre ","): 5 votos, todos ausente | 1 | Se conserva (no afecta a diputados actuales). |
| 8 | Duplicados | 0 votos duplicados; ninguna votación sin votos (253–257 por votación) | — |
| 9 | Mociones con solicitante que no se pudo identificar (nombres incompletos o varios) | 12 de 211 | Quedan sin solicitante. |

## 3. Enriquecimiento agregado

- **Gobiernos y oficialismo** (`gobiernos`): presidencias desde 1989 y criterio para identificar
  el bloque oficialista en cada votación. Con eso se calcula `postura_oficialismo` de cada votación.
- **Tema** (14 categorías + "otros") por reglas sobre título, nombre de ley y keywords.
- **Tipo** (proyecto / moción), **dictamen** (mayoría / minoría) y **origen en el Senado**
  leídos del título del acta.
- **Quién pidió cada moción** (199 de 211), emparejado con la persona y su bloque.
- **Partido** = última lista electoral de cada diputado (`cv_elecciones`).
- **Embeddings** de cada votación (LSA 96 dim + TF-IDF) para buscar proyectos parecidos, y
  embeddings neuronales (MiniLM multilingüe) usados solo para comparar.

Se buscaron más fuentes: `datos.hcdn.gob.ar` (expedientes, autores, textos) está **bloqueado por
el filtro de la red** desde esta computadora; las actas de votaciones.hcdn.gob.ar no traen
expediente ni texto. El repo de ¿Cómo Votó? en GitHub es la misma fuente que ya está en
Supabase (sí incluye senadores, útil cuando se sume el Senado).

## 4. Limitaciones del dataset para predecir

- **No hay textos de los proyectos**, solo títulos, nombre de la ley y keywords (estas últimas
  generadas con IA por ¿Cómo Votó?). La similitud entre proyectos se apoya en eso.
- **No hay autoría estructurada** (Poder Ejecutivo, bloque autor) salvo en mociones.
- **Muchas votaciones son consensuadas**: de 1.609 votaciones "en general" de proyectos, 543
  (34 %) tuvieron al menos 20 % de negativos. En las divididas es donde está la dificultad.
- **Ausencias**: 23 % de los votos y difíciles de anticipar por proyecto.

## 5. Estado de Supabase

- RLS activo en todas las tablas. Las de origen tienen lectura pública; las propias, ninguna
  política (solo el backend con la clave secreta).
- No había tablas para proyectos, embeddings, predicciones ni ajustes con historial.
  Se agregaron en `supabase/migrations/20261120120000_poroteo_ia.sql`.
- **Acceso disponible:** solo las claves de API (publicable y secreta). Sin contraseña de la
  base ni token de la Management API no se pueden ejecutar migraciones desde acá. Por eso la
  migración se probó en un **entorno separado** (Postgres 17 + pgvector y Supabase local en
  Docker) y queda lista para aplicar en producción (ver `PROGRESO.md`).
