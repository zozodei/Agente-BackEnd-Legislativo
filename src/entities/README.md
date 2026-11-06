# Entities de tablas

Clases JavaScript simples con campos públicos y `export default`, siguiendo el
[estilo de SmartLot](https://github.com/SmartLot-Org/SmartLot_API/tree/master/SmartLot_API/src/entities).
Solo describen filas con nombres de columnas originales. No contienen consultas,
validaciones, métodos CRUD ni dependencias de Express o Supabase.

## Contraste del inventario y fuentes

Antes de crear las clases se revisó el inventario contra la migración local
[`20261104120000_poroteos.sql`](../../supabase/migrations/20261104120000_poroteos.sql),
el código y la documentación del repositorio. Las columnas, PK y FK solicitadas de
`poroteos` y `poroteo_votos` coinciden con esa migración. No se detectaron
diferencias en los objetos contrastables con SQL local.

Las otras 13 tablas no tienen su DDL en las migraciones de este repositorio.
Se intentó consultar el proyecto documentado mediante el conector de Supabase,
pero respondió `You do not have permission to perform this action`. Por lo tanto,
no se verificó el esquema remoto ni se afirma que la migración esté aplicada.
Sus columnas, PK y relaciones se documentan según el inventario solicitado;
los tipos y la nulabilidad se dejan como `unknown`, sin deducirlos de los DTO.
`cv_nombres_originales` no figuraba en el resumen anterior de tablas del repo:
esto es una ampliación de la documentación, no evidencia de una discrepancia con
la base. Verificar esos metadatos queda pendiente de acceso de lectura al esquema.

## Correspondencia y claves primarias

| Archivo                                    | Tabla                          | Clave primaria              | Fuente del contraste      |
| ------------------------------------------ | ------------------------------ | --------------------------- | ------------------------- |
| [Distrito.js](Distrito.js)                 | `public.distritos`             | `id`                        | Inventario; DDL pendiente |
| [Bloque.js](Bloque.js)                     | `public.bloques`               | `id`                        | Inventario; DDL pendiente |
| [Diputado.js](Diputado.js)                 | `public.diputados`             | `id`                        | Inventario; DDL pendiente |
| [CvProvincia.js](CvProvincia.js)           | `public.cv_provincias`         | `id`                        | Inventario; DDL pendiente |
| [CvBloque.js](CvBloque.js)                 | `public.cv_bloques`            | `id`                        | Inventario; DDL pendiente |
| [CvPersona.js](CvPersona.js)               | `public.cv_personas`           | `id`                        | Inventario; DDL pendiente |
| [CvNombreOriginal.js](CvNombreOriginal.js) | `public.cv_nombres_originales` | `(camara, nombre_original)` | Inventario; DDL pendiente |
| [CvMandato.js](CvMandato.js)               | `public.cv_mandatos`           | `id`                        | Inventario; DDL pendiente |
| [CvLey.js](CvLey.js)                       | `public.cv_leyes`              | `id`                        | Inventario; DDL pendiente |
| [CvVotacion.js](CvVotacion.js)             | `public.cv_votaciones`         | `id`                        | Inventario; DDL pendiente |
| [CvVoto.js](CvVoto.js)                     | `public.cv_votos`              | `(votacion_id, persona_id)` | Inventario; DDL pendiente |
| [CvEleccion.js](CvEleccion.js)             | `public.cv_elecciones`         | `id`                        | Inventario; DDL pendiente |
| [CvMeta.js](CvMeta.js)                     | `public.cv_meta`               | `clave`                     | Inventario; DDL pendiente |
| [Poroteo.js](Poroteo.js)                   | `public.poroteos`              | `id`                        | Migración local           |
| [PoroteoVoto.js](PoroteoVoto.js)           | `public.poroteo_votos`         | `(poroteo_id, diputado_id)` | Migración local           |

## Relaciones

| Columna de origen                  | Referencia         |
| ---------------------------------- | ------------------ |
| `diputados.distrito_id`            | `distritos.id`     |
| `diputados.bloque_id`              | `bloques.id`       |
| `diputados.cv_persona_id`          | `cv_personas.id`   |
| `cv_nombres_originales.persona_id` | `cv_personas.id`   |
| `cv_mandatos.persona_id`           | `cv_personas.id`   |
| `cv_elecciones.persona_id`         | `cv_personas.id`   |
| `cv_votaciones.ley_id`             | `cv_leyes.id`      |
| `cv_votos.votacion_id`             | `cv_votaciones.id` |
| `cv_votos.persona_id`              | `cv_personas.id`   |
| `cv_votos.bloque_id`               | `cv_bloques.id`    |
| `cv_votos.provincia_id`            | `cv_provincias.id` |
| `poroteo_votos.poroteo_id`         | `poroteos.id`      |
| `poroteo_votos.diputado_id`        | `diputados.id`     |

`bloques` y `cv_bloques`, `distritos` y `cv_provincias`, y `diputados` y
`cv_personas` son tablas diferentes. Sus identificadores no son intercambiables.
Las claves compuestas se mantienen; no se agrega un `id` artificial.
`cv_leyes` agrupa leyes históricas y `poroteos` representa estimaciones: no existe
una entity `Proyecto`. El alcance sigue siendo Diputados, aunque el esquema
incluya campos `camara`. No se representan vistas ni RPC como tablas.

## Tipos, nulabilidad y valores

Los JSDoc de `Poroteo` y `PoroteoVoto` indican tipos SQL y nulabilidad verificados
en la migración. `created_at` y `updated_at` admiten NULL en ese SQL: tener un
default no equivale a `NOT NULL`. `undefined` describe el estado JavaScript de un
campo sin inicializar o ausente en una proyección; no significa que SQL admita NULL.
Los JSON se dejan como `unknown` con su nulabilidad SQL en el comentario, porque
la migración no restringe su estructura. Las uniones `number | string` para bigint
y numeric conservan posibles representaciones recibidas; no convierten valores ni
prometen una representación específica del cliente. Fechas y timestamps no se
convierten en `Date`, y no se generan UUID ni se aplican defaults.

## Uso desde repositories

Los repositories siguen devolviendo las filas planas de Supabase, sin instanciar
una clase por fila ni mapear o descartar campos. Las referencias JSDoc a las
entities son solo anotaciones; no añaden imports en ejecución. Las consultas con
selección parcial usan `Partial` o `Pick` para no prometer una fila completa.

```js
/** @returns {Promise<Array<Partial<import('../entities/CvMandato.js').default>>>} */
export async function fetchMandatos(personaId) {
  // Consulta en el repository; las reglas y los DTO siguen en el service.
}
```

Las lecturas de `v_diputados_actuales`, `v_votos`, `v_personas` y la RPC de
alineación conservan sus proyecciones propias; no se etiquetan como una fila de
`diputados`, `cv_votos` o `cv_personas`. Declarar campos no hidrata datos:
`new Diputado()` contiene campos con valor `undefined`. Los services siguen
construyendo explícitamente los DTO camelCase de la API y no serializan entities
completas al frontend.
