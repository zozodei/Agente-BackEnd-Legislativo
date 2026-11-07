# CLAUDE.md · Backend del Poroteo Legislativo

Guía para cualquier agente o persona que trabaje en este repo. Leela completa antes de tocar código. **Mantenela actualizada**: si cambiás un endpoint, una tabla o una convención, actualizá este archivo en el mismo PR.

---

## 1. Contexto

- **Quiénes:** equipo de estudiantes del programa _Hola Mundo Profesional_ (HMP), haciendo una práctica en la ONG **Democracia en Red**.
- **Objetivo final:** subir un proyecto de ley y que una IA haga el **poroteo**: estimar qué votaría cada legislador del Congreso de la Nación Argentina y cuál sería el resultado.
- **Etapa actual:** prototipo de **poroteo manual** (sin IA), **solo Cámara de Diputados** (257 bancas). Sirve para validar estética, funcionalidad y experiencia con la ONG.
- **Este repo no es descartable:** se usa hasta el final (IA + Senado). Código prolijo, escalable y profesional.
- **Frontend:** repo separado `Agente-FrontEnd-Legislativo` (React + Vite + TS). Solo habla con esta API.

## 2. Stack y arquitectura

Node ≥ 20, Express 5, JavaScript con ES Modules (`"type": "module"`, imports con extensión `.js`).

```
React (Vite)  →  este backend (Express)  →  Supabase (Postgres + Storage)
```

Flujo: **Ruta → Controller → Service → Repository → Supabase**. Los services también pueden coordinar otros services; los repositories no dependen de Express ni preparan DTOs.

```
src/
  config/
    env.js          valida process.env con zod; si falta algo, process.exit(1) diciendo qué
    supabase.js     `supabase` (clave pública, lectura) y `supabaseAdmin` (clave secreta)
    logger.js       pino (pretty en dev, JSON en prod, silent en test)
    constants.js    257 bancas, quórum 129, tipos de voto, fuente de datos
  routes/index.js   compone los routers por recurso y /health
  routes/*.routes.js endpoints + validate(...) + middlewares + controller
  controllers/      finos: leen req.valid.*, llaman al service, responden. Sin lógica.
  services/         reglas de negocio, caché y DTOs camelCase; sin SDK de Supabase.
    diputados.service.js   caché de los 257, perfil, historial de votos
    catalogos.service.js   bloques y distritos (derivados de los diputados cacheados)
    votaciones.service.js  listado y detalle de votaciones
    stats.service.js       resumen del panel de inicio
    poroteos.service.js    coordina CRUD, valida diputados y calcula origen/resultados
    resultado.js           cálculo PURO del resultado de un poroteo (quórum, mayorías)
    pdf.service.js         extrae texto de PDFs (unpdf)
  entities/         clases simples de tablas, campos snake_case y JSDoc; sin lógica
  repositories/     consultas a Supabase; devuelven filas y traducen errores con unwrap
    diputados.repository.js   vista actual, mandatos, historial y RPC de alineación
    votaciones.repository.js  votaciones, votos, fotos, leyes y conteos
    poroteos.repository.js    tablas propias, exclusivamente con supabaseAdmin
    metadata.repository.js    lectura de cv_meta con cliente público
  middlewares/
    validate.js       valida params/query/body con zod → deja el resultado en req.valid
    errorHandler.js   notFound + manejador central de errores
    rateLimit.js      apiLimiter (general) y writeLimiter (POST/PUT/PATCH/DELETE)
    upload.js         multer en memoria, solo PDF, 10 MB
  validators/       esquemas zod por recurso (+ common.js)
  utils/
    AppError.js        errores controlados (badRequest, notFound, upstream, unavailable)
    supabaseHelpers.js unwrap() (convierte {error} en AppError), fetchAll() (pagina de a 1000), sanitizeSearch()
    pagination.js      toRange(), paginated(), paginateArray()
    cache.js           caché en memoria con TTL
    text.js            normalize() (sin tildes, minúsculas)
  app.js            createApp(): helmet, cors, pino-http, json, rate limit, router, errores
  server.js         listen + apagado prolijo
supabase/migrations/  SQL versionado de las tablas propias (aplicar en orden)
tests/                Vitest + Supertest: contratos HTTP, capas con cliente doble y cálculo puro; nunca red
```

### Entities de tablas

`src/entities/` contiene las 16 clases de tablas, con campos públicos sin
inicializadores y `export default`. Son la excepción al estilo de módulos con
funciones: no contienen lógica, validación, consultas ni carga de relaciones.
Los repositories pueden referenciarlas por JSDoc, usando `Partial`/`Pick` para
proyecciones, sin instanciar filas ni cambiar valores. Los services mantienen los
DTO camelCase; las entities conservan las columnas snake_case. No representan
vistas ni RPC. No convertir fechas, numeric o bigint ni aplicar defaults en ellas.

El [inventario de entities](src/entities/README.md) documenta correspondencias,
claves, relaciones y límites de verificación: las tablas propias se contrastaron
con la migración local, y los metadatos del resto quedan pendientes porque el
conector rechazó la consulta de lectura por permisos. No asumir tipos ni nulabilidad
por los valores del frontend. No mezclar IDs de catálogos actuales e históricos.

## 3. Base de datos (Supabase)

Proyecto `jhwsuyydwfqnegpufrqs` (us-east-1, Postgres 17). Los datos vienen de **¿Cómo Votó?** (Rodrigo Quiroga, commit `d6c7d5b`, datos al 31/10/2026). **Hay que citar la fuente en la plataforma.**

### Tablas de origen (solo lectura, RLS con lectura pública)

| Tabla                          | Filas    | Qué es                                                                                                                                                                                                          |
| ------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `diputados`                    | 257      | Diputados actuales (CSV oficial HCDN): `apellido`, `nombre`, `distrito_id`, `bloque_id`, `inicia_mandato`, `finaliza_mandato`, `cv_persona_id`                                                                  |
| `distritos` / `bloques`        | 24 / 21  | Catálogos de los diputados actuales                                                                                                                                                                             |
| `cv_personas`                  | 2.062    | Todos los que pasaron por Diputados desde 1993: foto, `presentismo`, `alin_pj/pro/lla/ucr` (% alineamiento), JSON `alineamiento_anual`, `stats_anuales`, `alineamiento_era`. `en_sitio=false` = bancas vacantes |
| `cv_votaciones`                | 2.992    | Cada votación nominal 1993–2026: `titulo`, `titulo_sitio`, `nombre_ley`, `etiqueta` ("En General", "Art. 5"…), `es_general`, `fecha`, `resultado`, conteos, `postura_pj/pro/lla/ucr`, `keywords`, `url` (acta)  |
| `cv_votos`                     | 768.789  | Un voto por persona por votación: `AFIRMATIVO`, `NEGATIVO`, `ABSTENCION`, `AUSENTE`, `PRESIDENTE`. Con `bloque_id` y `provincia_id` **de ese momento**                                                          |
| `cv_leyes`                     | 1.937    | Votaciones agrupadas por ley (general + particular), `keywords`, `destacada`                                                                                                                                    |
| `cv_mandatos`                  | 2.690    | Períodos de cada persona: años, bloque, alianza                                                                                                                                                                 |
| `cv_elecciones`                | 5.643    | Listas electas 1983–2023 (con suplentes)                                                                                                                                                                        |
| `cv_bloques` / `cv_provincias` | 309 / 24 | Catálogos históricos. Cada bloque tiene una `coalicion`                                                                                                                                                         |
| `cv_meta`                      | 4        | `fuente`, `cargado`, `stats_sitio` (fecha de actualización), `fotos_base_url`                                                                                                                                   |

Relaciones:

```
diputados.cv_persona_id → cv_personas.id
cv_votos.persona_id     → cv_personas.id
cv_votos.votacion_id    → cv_votaciones.id
cv_votaciones.ley_id    → cv_leyes.id
```

### Vistas y funciones (usarlas en vez de joins a mano)

| Nombre                                                   | Uso                                                                                                               |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `v_diputados_actuales`                                   | **La principal.** Los 257 con `distrito`, `bloque`, `foto_url`, `presentismo`, `alin_*`, JSON                     |
| `v_votos`                                                | Un voto por fila con todo resuelto: legislador, ley, fecha, bloque de ese momento, posturas, `diputado_actual_id` |
| `v_personas`                                             | Personas con `foto_url` resuelta                                                                                  |
| `rpc cv_buscar_leyes(p_q, p_anio_desde, p_limite)`       | Busca leyes sin importar tildes (nombre + keywords). **Base para la IA.**                                         |
| `rpc cv_historial_diputados(p_ley_ids, p_solo_general)`  | Por cada diputado actual: cuántas veces votó a favor/en contra/etc. en esas leyes. **Base para la IA.**           |
| `rpc fn_alineacion_bloque(p_persona_id, p_solo_general)` | (migración propia) % de votaciones en que votó igual que la mayoría de su bloque                                  |

Todas las vistas son `security_invoker`. Fotos: bucket público `fotos` en Storage (1.604). El front las carga directo con `foto_url`.

### Tablas propias (migración `supabase/migrations/20261104120000_poroteos.sql`)

RLS **habilitado sin políticas** → nadie con la clave pública puede leer ni escribir. Solo el backend con `supabaseAdmin`.

`poroteos`

| Columna                     | Tipo          | Notas                                                                   |
| --------------------------- | ------------- | ----------------------------------------------------------------------- |
| `user_id`                   | uuid nullable | FK a auth.users(id), ON DELETE SET NULL; creador histórico, no autoriza |
| `id`                        | uuid PK       | `gen_random_uuid()`                                                     |
| `titulo`                    | text          | 3–300 caracteres                                                        |
| `descripcion`               | text          | ≤ 5000                                                                  |
| `texto_proyecto`            | text          | texto pegado o extraído del PDF (insumo para la IA)                     |
| `archivo_nombre`            | text          | nombre del PDF (el archivo no se guarda)                                |
| `camara`                    | text          | `diputados` \| `senadores` (hoy siempre diputados)                      |
| `tipo_mayoria`              | text          | `simple` \| `absoluta` \| `dos_tercios`                                 |
| `estado`                    | text          | `borrador` \| `final`                                                   |
| `origen`                    | text          | `manual` \| `ia` \| `mixto` (se recalcula al guardar votos)             |
| `autor`                     | text          | libre (hasta que haya auth)                                             |
| `metadata`                  | jsonb         | libre (ej. leyes similares que use la IA)                               |
| `created_at` / `updated_at` | timestamptz   | trigger `set_updated_at`                                                |

`poroteo_votos` (PK `poroteo_id + diputado_id`)

| Columna         | Tipo         | Notas                                                                   |
| --------------- | ------------ | ----------------------------------------------------------------------- |
| `poroteo_id`    | uuid FK      | `on delete cascade`                                                     |
| `diputado_id`   | bigint FK    | → `diputados.id`                                                        |
| `voto`          | text         | `AFIRMATIVO` \| `NEGATIVO` \| `ABSTENCION` \| `AUSENTE` \| `INDEFINIDO` |
| `origen`        | text         | `manual` \| `ia`                                                        |
| `confianza`     | numeric(4,3) | 0..1, solo IA                                                           |
| `justificacion` | text         | explicación de la IA                                                    |
| `fuentes`       | jsonb        | array de citas/fuentes de la IA                                         |
| `updated_at`    | timestamptz  |                                                                         |

Un diputado sin fila en `poroteo_votos` = **sin asignar** (cuenta como en disputa, igual que `INDEFINIDO`).

### Cuidados con los datos

- Las votaciones **"En General"** (`es_general = true`) son las que mejor representan la postura sobre una ley. Las "en particular" son por artículo.
- Alineamiento, coaliciones, `nombre_ley` y `keywords` son criterios del autor de ¿Cómo Votó? (parte generados con IA): **señal, no verdad**.
- `resultado` a veces trae números (`"218"`, `"47"`…). El backend expone `resultado` limpio (`AFIRMATIVO`/`NEGATIVO`/`EMPATE` o `null`) y `resultadoOriginal`.
- 127 votaciones tienen 1–3 ausentes de diferencia con el sitio; 997 votos sin provincia; Martín Matzkin tiene la foto de HCDN.
- Los nombres de bloque en `diputados/bloques` vienen en MAYÚSCULAS; en `v_votos` vienen en formato título. Normalizá antes de comparar.
- **PostgREST devuelve máximo 1000 filas.** Usá `fetchAll()` o `.range()`.
- **supabase-js no lanza excepciones.** Siempre pasá el resultado por `unwrap()`.

## 4. API

Base `/api`. JSON. Paginadas → `{ data: [...], meta: { page, pageSize, total, totalPages } }`. Simples → `{ data }`. Errores → `{ error: { code, message, details? } }` con códigos `BAD_REQUEST`, `NOT_FOUND`, `RATE_LIMITED`, `CORS_FORBIDDEN`, `UPSTREAM_ERROR` (502), `SERVICE_UNAVAILABLE` (503, falta migración), `INTERNAL_ERROR`.

| Método | Ruta                   | Query / Body                                                                                                                          | Notas                                                                                                                                           |
| ------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/health`              |                                                                                                                                       |                                                                                                                                                 |
| POST   | `/auth/registro`       | `{ nombre, email, password }`                                                                                                         | 201; `{ data: { usuario, sesion, requiereConfirmacion } }`                                                                                      |
| POST   | `/auth/login`          | `{ email, password }`                                                                                                                 | 200; `{ data: { usuario, sesion } }`                                                                                                            |
| POST   | `/auth/refresh`        | `{ refreshToken }`                                                                                                                    | 200; `{ data: { usuario, sesion } }`                                                                                                            |
| GET    | `/auth/me`             | `Authorization: Bearer <accessToken>`                                                                                                 | 200; `{ data: usuario }`                                                                                                                        |
| POST   | `/auth/logout`         | `Authorization: Bearer <accessToken>`                                                                                                 | 204; revoca la sesión actual                                                                                                                    |
| GET    | `/admin/resumen`       | Bearer superadmin                                                                                                                     | 200; conteos verificados de poroteos y datos de Cámara                                                                                          |
| GET    | `/admin/cuentas`       | `page`, `pageSize` (≤100), Bearer superadmin                                                                                          | Paginado; solo id, email, createdAt, lastSignInAt, rol                                                                                          |
| GET    | `/admin/poroteos`      | `q`, `page`, `pageSize`, Bearer superadmin                                                                                            | Paginado de consulta, mismos DTO de poroteos                                                                                                    |
| GET    | `/admin/poroteos/:id`  | UUID, Bearer superadmin                                                                                                               | Detalle de consulta con votos y resumen                                                                                                         |
| GET    | `/diputados`           | `q`, `bloque`, `distrito`, `orden` (`apellido`\|`bloque`\|`distrito`\|`presentismo`), `page`, `pageSize` (≤300, default 300)          | Filtra en memoria sobre la caché                                                                                                                |
| GET    | `/diputados/:id`       |                                                                                                                                       | `mandatos[]`, `estadisticas` (`total`, `conteo`, `porcentaje`, `alineacionBloque`, `porAnio`), `alineamientoAnual`, `alineamientoEra`           |
| GET    | `/diputados/:id/votos` | `q`, `voto`, `anio`, `soloGeneral`, `page`, `pageSize` (≤100)                                                                         | Desde `v_votos`, por `persona_id`                                                                                                               |
| GET    | `/bloques`             |                                                                                                                                       | `[{ nombre, bancas }]`                                                                                                                          |
| GET    | `/distritos`           |                                                                                                                                       | `[{ nombre, bancas }]`                                                                                                                          |
| GET    | `/votaciones`          | `q`, `desde`, `hasta` (AAAA-MM-DD), `anio`, `resultado`, `soloGeneral`, `page`, `pageSize`                                            | Solo `camara = diputados`                                                                                                                       |
| GET    | `/votaciones/:id`      |                                                                                                                                       | `conteo`, `porcentajes`, `posturas`, `ley`, `votacionesDeLaLey[]`, `porBloque[]`, `votos[]` (con `fotoUrl`, `diputadoId` si sigue en funciones) |
| GET    | `/stats/resumen`       |                                                                                                                                       | `camara`, `composicion[]`, `votaciones` (totales + `ultimas[]`), `fuente`                                                                       |
| POST   | `/poroteos`            | `titulo`, `descripcion?`, `textoProyecto?`, `tipoMayoria?`, `autor?` + `archivo` (PDF, multipart)                                     | 201 + `Location`                                                                                                                                |
| GET    | `/poroteos`            | `q`, `page`, `pageSize`                                                                                                               | Cada item trae `resumen` (resultado calculado)                                                                                                  |
| GET    | `/poroteos/:id`        |                                                                                                                                       | `votos[]` + `resumen`                                                                                                                           |
| PATCH  | `/poroteos/:id`        | `version` obligatorio y cualquier subset de `titulo`, `descripcion`, `textoProyecto`, `tipoMayoria`, `estado`, `autor`, `visibilidad` |                                                                                                                                                 |
| PUT    | `/poroteos/:id/votos`  | `{ version, modo: 'merge'\|'replace', votos: [{ diputadoId, voto, origen?, confianza?, justificacion?, fuentes? }] }`                 | Valida que los diputados existan                                                                                                                |
| DELETE | `/poroteos/:id`        | `{ version }`                                                                                                                         | 204                                                                                                                                             |

Las rutas privadas /api/poroteos requieren sesión y membresía en poroteo_usuarios.
user_id conserva únicamente al creador original; no autoriza ni transfiere permisos.
Dueños y colaboradores editan contenido y votos. Solo dueños administran participantes,
publican y eliminan. Todo miembro puede salir si queda otro dueño. Un ajeno recibe 404.
El backoffice superadmin conserva únicamente consulta global.

Todas las mutaciones posteriores a crear requieren version y usan poroteo_mutar
atómicamente, con actor obtenido exclusivamente de la sesión. Un 409 no se reintenta.
La creación es privada; el trigger agrega al primer dueño y el backend recarga la versión.
Lecturas públicas independientes sin sesión: /api/poroteos-publicos y /:id.
No exponen cuentas, miembros, metadata ni campos internos. Todas llevan no-store.
Contrato completo y migraciones exactas: [poroteos colaborativos](docs/poroteos-colaborativos.md).

### Cálculo del resultado (`services/resultado.js`)

- Presentes = afirmativos + negativos + abstenciones. **Quórum = 129.**
- `simple`: afirmativos > negativos. `absoluta`: afirmativos ≥ 129. `dos_tercios`: afirmativos ≥ ⌈2/3 de presentes⌉.
- `INDEFINIDO` + sin asignar = **en disputa**. Se calcula `mejorCaso` (todos afirmativos) y `peorCaso` (todos negativos). `definido = true` si coinciden.
- `resultado`: `APROBADO` \| `RECHAZADO` \| `SIN_QUORUM`.
- **El frontend tiene una copia** (`src/features/poroteo/resultado.ts`) para el contador en vivo. Si cambiás una, cambiá la otra (y sus tests).

### Roles de aplicación y backoffice

`usuario` y `superadmin` son roles de aplicación; no modifican `role` de
PostgreSQL/Supabase ni se persisten en metadata. `roles.service.js` resuelve el
rol con email completo normalizado y `email_confirmed_at` del usuario devuelto
por Supabase. Debe estar en `SUPERADMIN_EMAILS` y ser uno de los tres emails
habilitados en el código. La variable es exclusiva del backend, vacía por defecto,
y se carga al iniciar: cambiarla requiere reiniciar el proceso. Lista vacía no
concede privilegios. No se modifica el `.env` real.

`/auth/me`, login y refresh exponen `usuario.rol`. Registro sin sesión siempre
informa `usuario`. `autenticar` consulta `auth.getUser(token)` en cada solicitud
administrativa y `soloSuperadmin` exige ese rol actual. Sin sesión válida: 401;
sesión válida sin permiso: 403; proveedor caído: 502 sin reutilizar permisos.
Todo `/api/admin`, incluso rutas futuras, está protegido y usa `no-store`.

`admin.repository.js` usa la clave secreta únicamente para **listar** cuentas Auth
con `listUsers({ page, perPage })`. El service devuelve solo cinco campos. No se
agregan operaciones administrativas de escritura. participantes.repository.js también usa Auth admin
para buscar cuentas existentes por email, solo después de autorizar al dueño; nunca crea cuentas. participantes.repository.js también usa Auth admin
para buscar cuentas existentes por email, solo después de autorizar al dueño; nunca crea cuentas. Los demás endpoints de
poroteos normales requieren membresía; el backoffice conserva consulta global.

La interfaz `/backoffice` está en el repo frontend: resumen, cuentas, listado y
detalle de poroteos, exclusivamente de consulta. Pasos manuales, contratos,
archivos y pruebas en [docs/backoffice.md](docs/backoffice.md). No se ejecutó SQL
ni se crearon cuentas o enviaron correos para implementar esto.

### Registro e inicio de sesión

Implementados con Supabase Auth, sin tabla propia `usuarios`. Contrato y pasos
manuales en [docs/autenticacion.md](docs/autenticacion.md). El frontend existente
ya usa estas rutas y DTO; no requiere cambios para registro/login/refresh/me/logout.
Las cuentas se administran en Auth (`auth.users`) y `nombre` es metadata de
presentación, nunca un permiso. No crear ni modificar manualmente esa tabla.

Se usa un cliente público nuevo por operación en `config/supabaseAuth.js`, sin
persistencia ni auto-refresh, para no compartir sesiones con otras solicitudes ni
con el cliente histórico. `auth.repository.js` concentra las llamadas al SDK y
`authErrors.js` traduce los errores sin registrar credenciales. Tokens Bearer se
extraen con Zod a `req.valid.auth`; `me` los verifica con `auth.getUser(token)`.
Login, registro y refresh comparten un límite de 20 intentos por IP por minuto,
además del límite general. Respuestas `/auth/*`: `Cache-Control: no-store`.

Errores nuevos: `UNAUTHORIZED` y `SESSION_EXPIRED` (401), `INVALID_CREDENTIALS`
(401), `EMAIL_NOT_CONFIRMED` y `FORBIDDEN` (403), `CONFLICT` (409). Se mantienen
`BAD_REQUEST` (400), `RATE_LIMITED` (429) y `UPSTREAM_ERROR` (502). Las sesiones
usan `accessToken`, `refreshToken`, `expiresIn`, `expiresAt` (segundos Unix),
`tokenType`. Un registro sin sesión devuelve `requiereConfirmacion: true`.
Logout revoca el refresh de la sesión actual; un access token ya emitido puede
seguir siendo válido hasta vencer.

Las rutas privadas /api/poroteos requieren sesión y membresía en poroteo_usuarios.
user_id conserva únicamente al creador original; no autoriza ni transfiere permisos.
Dueños y colaboradores editan contenido y votos. Solo dueños administran participantes,
publican y eliminan. Todo miembro puede salir si queda otro dueño. Un ajeno recibe 404.
El backoffice superadmin conserva únicamente consulta global.

Todas las mutaciones posteriores a crear requieren version y usan poroteo_mutar
atómicamente, con actor obtenido exclusivamente de la sesión. Un 409 no se reintenta.
La creación es privada; el trigger agrega al primer dueño y el backend recarga la versión.
Lecturas públicas independientes sin sesión: /api/poroteos-publicos y /:id.
No exponen cuentas, miembros, metadata ni campos internos. Todas llevan no-store.
Contrato completo y migraciones exactas: [poroteos colaborativos](docs/poroteos-colaborativos.md).

## 5. Seguridad: reglas que no se rompen

- **Nunca** commitear `.env` ni claves. Solo `.env.example` sin valores reales.
- La clave secreta (`SUPABASE_SECRET_KEY`) vive **solo** acá. Nunca en el front, logs, respuestas ni issues.
- `supabaseAdmin` solo en repositories de tablas propias, `admin.repository.js` para lectura de cuentas del backoffice y `participantes.repository.js` para lookup interno por dueños. Para datos de ¿Cómo Votó? usar `supabase` (pública).
- Toda entrada (params, query, body) pasa por `validate()` con zod. No leer `req.query` / `req.body` crudos en controllers: usar `req.valid.*`.
- Texto de búsqueda que va a `.or()` / `.ilike()` pasa por `sanitizeSearch()`.
- Tablas nuevas: **siempre** `enable row level security`. Sin políticas si solo escribe el backend.
- Errores inesperados → 500 genérico. En producción nunca se devuelve el stack.
- CORS restringido a `CORS_ORIGINS`. Helmet y rate limit siempre activos.

## 6. Convenciones

- **Código:** ES Modules, `async/await`, sin callbacks. Archivos `recurso.capa.js` (`diputados.service.js`). Funciones en camelCase y en español del dominio (`getDiputado`, `listVotaciones`).
- **DTOs:** la base usa snake_case; la API responde **camelCase**. La conversión se hace en el service (`toDiputadoDTO`, etc.).
- **Errores:** lanzar `AppError` desde los services. Express 5 captura las promesas rechazadas (no hace falta `try/catch` en controllers).
- **Formato:** Prettier (`singleQuote`, `printWidth 100`, `trailingComma all`). ESLint sin warnings.
- **Comentarios y mensajes** en español.

### Git

- Ramas: `main` (estable, lo que se muestra) · `develop` (integración) · `feature/...`, `fix/...`, `chore/...`, `docs/...` salen de `develop`.
- **Nunca commitear directo a `main` ni a `develop`.** Todo entra por Pull Request a `develop` con descripción clara. `develop → main` cuando hay algo estable para mostrar.
- **Conventional Commits:** `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `style:`, `test:`. Commits chicos y descriptivos, en español. Ej: `feat(poroteos): guardar votos en modo replace`.
- CI (`.github/workflows/ci.yml`) corre lint, format check y tests en cada PR.

## 7. Comandos

```bash
npm install
cp .env.example .env     # completar
npm run dev              # http://localhost:4000/api
npm test                 # tests (no usan red)
npm run lint
npm run format
```

Red corporativa con inspección HTTPS (`SELF_SIGNED_CERT_IN_CHAIN`): agregar `NODE_OPTIONS=--use-system-ca` al `.env`.

### Agregar un endpoint (checklist)

1. Esquema zod en `validators/<recurso>.validator.js`.
2. Consultas en `repositories/<recurso>.repository.js` (usar `unwrap`/`fetchAll`, devolver filas); reglas y DTO camelCase en `services/<recurso>.service.js`. No crear repositories sin consultas propias.
3. Controller fino en `controllers/`.
4. Ruta en `routes/<recurso>.routes.js` con `validate(...)`; registrar el router en `routes/index.js` si es nuevo. Conservar el orden de los middlewares.
5. Contrato HTTP en `tests/api.test.js` y regresiones de consultas/reglas en `tests/capas.test.js` con dobles de cliente, sin red.
6. Actualizar la tabla de endpoints de este archivo y del README.

### Mutaciones atómicas

El modo replace, sus votos y el origen se guardan en una transacción mediante poroteo_mutar. Si falla, se revierte toda la operación. La RPC comprueba permisos y versión bajo bloqueo.

## 8. Roadmap

1. ✅ Poroteo manual de Diputados (este prototipo).
2. **Integración de IA:** portar `services/votePrediction.js` y `services/legislatorQuotes.js` del prototipo anterior (`leyes-ia-backend`, usa Gemini). Flujo: `texto_proyecto` → `cv_buscar_leyes` → `cv_historial_diputados` → predicción → escribir en `poroteo_votos` con `origen='ia'`, `confianza`, `justificacion`, `fuentes`. Endpoint sugerido: `POST /api/poroteos/:id/prediccion`.
3. **Correcciones de organizaciones:** tabla con trazabilidad (quién cambió qué voto y por qué).
4. Autenticación implementada con Supabase Auth (`/api/auth/*`). Poroteos colaborativos con publicación y membresías implementados. `autor` sigue descriptivo. Migraciones exactas ya aplicadas en remoto, copiadas localmente sin ejecutarlas.
5. **Senado:** cargar senadores, `camara='senadores'` en poroteos (quórum 37 de 72). Generalizar `diputado_id` → `legislador_id`.
6. **Recarga de datos:** ¿Cómo Votó? se actualiza a diario; definir proceso (cron / GitHub Action) y luego limpiar la caché.
7. Limpieza: borrar la Edge Function `importar-fotos` (ya no se usa).

## Colaboración y publicación

Las rutas privadas /api/poroteos requieren sesión y membresía en poroteo_usuarios.
user_id conserva únicamente al creador original; no autoriza ni transfiere permisos.
Dueños y colaboradores editan contenido y votos. Solo dueños administran participantes,
publican y eliminan. Todo miembro puede salir si queda otro dueño. Un ajeno recibe 404.
El backoffice superadmin conserva únicamente consulta global.

Todas las mutaciones posteriores a crear requieren version y usan poroteo_mutar
atómicamente, con actor obtenido exclusivamente de la sesión. Un 409 no se reintenta.
La creación es privada; el trigger agrega al primer dueño y el backend recarga la versión.
Lecturas públicas independientes sin sesión: /api/poroteos-publicos y /:id.
No exponen cuentas, miembros, metadata ni campos internos. Todas llevan no-store.
Contrato completo y migraciones exactas: [poroteos colaborativos](docs/poroteos-colaborativos.md).

| Método | Ruta nueva                     | Contrato                        |
| ------ | ------------------------------ | ------------------------------- |
| GET    | /poroteos-publicos             | Listado anónimo paginado        |
| GET    | /poroteos-publicos/:id         | Detalle público de solo lectura |
| GET    | /poroteos/:id/miembros         | Solo dueño; miembros y versión  |
| POST   | /poroteos/:id/miembros         | version, email y rol            |
| PATCH  | /poroteos/:id/miembros/:userId | version y rol                   |
| DELETE | /poroteos/:id/miembros/:userId | version                         |
| POST   | /poroteos/:id/salir            | version                         |
