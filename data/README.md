# Dataset del Poroteo Legislativo (Cámara de Diputados, 1993–2026)

Votaciones nominales de la Cámara de Diputados de la Nación con el voto de cada legislador,
limpias y enriquecidas para predecir votos. Datos al 31/10/2026.

**Fuente:** [¿Cómo Votó?](https://comovoto.dev.ar) de Rodrigo Quiroga
([repo](https://github.com/rquiroga7/Como_voto), commit `d6c7d5b`), construido sobre las actas
oficiales de [votaciones.hcdn.gob.ar](https://votaciones.hcdn.gob.ar). Si usás estos datos,
citá la fuente.

## Carpetas

| Carpeta | Qué tiene | Cómo se genera |
|---|---|---|
| `raw/` | Export **sin modificar** de las tablas de Supabase (JSON comprimido). También es el backup. | `npm run datos:exportar` |
| `dataset/` | Dataset limpio y enriquecido (CSV para Excel/planillas + JSON para scripts) | `npm run datos:construir` |
| `modelo/` | Artefactos del modelo: historial compacto, LSA, pesos, evaluación | `npm run modelo:actualizar` |

Los CSV están en UTF-8 con BOM (Excel muestra bien las tildes). `votos.csv.gz` está comprimido
porque tiene 768.789 filas; se abre con cualquier descompresor (7-Zip, `gunzip`).

## Diccionario de `dataset/`

### `votaciones.csv` — 2.992 votaciones

| Columna | Descripción |
|---|---|
| `id`, `id_hcdn`, `url_acta` | Identificador interno, de la HCDN y link al acta |
| `fecha`, `anio` | Fecha y hora de la votación |
| `titulo`, `nombre_ley`, `ley_id`, `keywords` | Título del acta; nombre corto y keywords de ¿Cómo Votó? (parte generados con IA) |
| `etiqueta`, `es_general` | "En General" / "Art. 5"…; `true` si es la votación en general |
| `tipo` | `proyecto` o `mocion` (apartamiento de reglamento, emplazamiento…) |
| `dictamen` | `mayoria` / `minoria` si el título lo indica |
| `origen_senado` | Viene en revisión o con modificaciones del Senado |
| `tema` | Uno de 15 temas (clasificador por reglas, `src/prediccion/proyecto.js`) |
| `resultado`, `resultado_original` | Resultado limpio (`AFIRMATIVO`/`NEGATIVO`/`EMPATE`) y el original |
| `afirmativos` … `presidente` | **Conteos recalculados** desde los votos (los de la fuente están corridos) |
| `gobierno` | Presidencia vigente (ver `gobiernos.csv`) |
| `oficialistas_en_recinto`, `postura_oficialismo` | Diputados del bloque del presidente y su voto mayoritario |
| `solicitante_persona_id`, `solicitante_bloque_grupo_id` | Quién pidió la moción y su bloque |

### `votos.csv.gz` — 768.789 votos

`votacion_id`, `persona_id`, `voto` (AFIRMATIVO, NEGATIVO, ABSTENCION, AUSENTE, PRESIDENTE),
`bloque_id` (bloque de ese momento), `bloque_grupo_id` (bloque unificado), `provincia`
(997 completadas, ver `limpieza.json`).

### `diputados_actuales.csv` — los 257 en funciones

Nombre, provincia, bloque actual (HCDN), último bloque con el que votó, partido (última lista
electoral), mandato, cantidad de votaciones, presentismo, cambios de bloque e historial de
bloques con fechas.

### Otros

- `personas.csv`: las 2.062 personas que pasaron por la Cámara desde 1993.
- `bloques.csv`: los 309 bloques de la fuente y su grupo unificado (304).
- `historial_bloques.csv`: tramos persona–bloque–desde–hasta.
- `gobiernos.csv`: presidencias desde 1989 y el criterio para identificar al oficialismo.
- `limpieza.json`: cada problema encontrado, cuántos casos y qué se hizo.
- `embeddings_minilm.json.gz`: embeddings neuronales de cada votación (solo para evaluación).

## Neutralidad

Todo lo agregado es descriptivo: "oficialismo" es el bloque del partido del presidente en
funciones; los temas salen de palabras del título. No hay calificaciones de legisladores,
partidos ni proyectos.
