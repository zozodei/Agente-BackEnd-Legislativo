# Poroteo Legislativo · Backend

API del prototipo de **Poroteo Legislativo** de [Democracia en Red](https://democraciaenred.org), desarrollado en el programa _Hola Mundo Profesional_ (HMP).

El objetivo final es un sistema con IA que, al subir un proyecto de ley, estime qué votaría cada legislador del Congreso argentino. **Esta etapa es un prototipo de poroteo manual, solo para la Cámara de Diputados.**

> Frontend: [Agente-FrontEnd-Legislativo](https://github.com/zozodei/Agente-FrontEnd-Legislativo)

## Stack

- Node.js ≥ 20 + Express 5 (JavaScript, ES Modules)
- Supabase (Postgres) con `@supabase/supabase-js`
- zod (validación), helmet, cors, express-rate-limit, pino (logs), multer + unpdf (PDF)
- Vitest + Supertest, ESLint 9 + Prettier

## Instalación

```bash
git clone https://github.com/zozodei/Agente-BackEnd-Legislativo.git
cd Agente-BackEnd-Legislativo
npm install
cp .env.example .env   # completar los valores
npm run dev            # http://localhost:4000/api/health
```

### Base de datos

Los datos de diputados y votaciones ya están cargados en Supabase. Las tablas propias del poroteo se crean con las migraciones de [`supabase/migrations/`](supabase/migrations/):

1. Abrir Supabase → **SQL Editor**.
2. Pegar y ejecutar cada archivo `.sql` en orden (por nombre).

Si no se aplicaron, los endpoints de `/api/poroteos` responden `503 SERVICE_UNAVAILABLE` con un mensaje explicativo, y la alineación con el bloque del perfil viene en `null`.

## Variables de entorno

| Variable                   | Obligatoria | Descripción                                                     |
| -------------------------- | :---------: | --------------------------------------------------------------- |
| `NODE_ENV`                 |             | `development` \| `production` \| `test` (default `development`) |
| `PORT`                     |             | Puerto HTTP (default `4000`)                                    |
| `LOG_LEVEL`                |             | Nivel de pino (default `info`)                                  |
| `CORS_ORIGINS`             |     ✅      | Orígenes permitidos, separados por coma                         |
| `SUPABASE_URL`             |     ✅      | URL del proyecto Supabase                                       |
| `SUPABASE_PUBLISHABLE_KEY` |     ✅      | Clave pública (lectura)                                         |
| `SUPABASE_SECRET_KEY`      |     ✅      | Clave secreta (escritura de poroteos). **Nunca** en el front    |
| `RATE_LIMIT_WINDOW_MS`     |             | Ventana del rate limit en ms (default `60000`)                  |
| `RATE_LIMIT_MAX`           |             | Requests por ventana por IP (default `300`)                     |
| `RATE_LIMIT_WRITE_MAX`     |             | Escrituras por ventana por IP (default `60`)                    |
| `CACHE_DIPUTADOS_MINUTOS`  |             | Caché en memoria de los 257 diputados (default `10`)            |

Si falta una obligatoria, el servidor no levanta e indica cuál.

## Scripts

| Script                 | Qué hace                                 |
| ---------------------- | ---------------------------------------- |
| `npm run dev`          | Servidor con recarga automática (`.env`) |
| `npm start`            | Servidor en modo normal                  |
| `npm test`             | Tests (Vitest + Supertest, sin red)      |
| `npm run lint`         | ESLint                                   |
| `npm run format`       | Prettier (escribe)                       |
| `npm run format:check` | Prettier (solo verifica, usado en CI)    |

## Endpoints

Base: `/api`. Respuestas: `{ data }` o `{ data, meta }` si es paginada. Errores: `{ error: { code, message, details? } }`.

| Método   | Ruta                   | Descripción                                                                 |
| -------- | ---------------------- | --------------------------------------------------------------------------- |
| `GET`    | `/health`              | Estado del servicio                                                         |
| POST     | `/auth/registro`       | `{ nombre, email, password }`                                               | 201; `{ data: { usuario, sesion, requiereConfirmacion } }` |
| POST     | `/auth/login`          | `{ email, password }`                                                       | 200; `{ data: { usuario, sesion } }`                       |
| POST     | `/auth/refresh`        | `{ refreshToken }`                                                          | 200; `{ data: { usuario, sesion } }`                       |
| GET      | `/auth/me`             | `Authorization: Bearer <accessToken>`                                       | 200; `{ data: usuario }`                                   |
| POST     | `/auth/logout`         | `Authorization: Bearer <accessToken>`                                       | 204; revoca la sesión actual                               |
| GET      | `/admin/resumen`       | Bearer superadmin                                                           | 200; conteos verificados de poroteos y datos de Cámara     |
| GET      | `/admin/cuentas`       | `page`, `pageSize` (≤100), Bearer superadmin                                | Paginado; solo id, email, createdAt, lastSignInAt, rol     |
| GET      | `/admin/poroteos`      | `q`, `page`, `pageSize`, Bearer superadmin                                  | Paginado de consulta, mismos DTO de poroteos               |
| GET      | `/admin/poroteos/:id`  | UUID, Bearer superadmin                                                     | Detalle de consulta con votos y resumen                    |
| `GET`    | `/diputados`           | Listado. Query: `q`, `bloque`, `distrito`, `orden`, `page`, `pageSize`      |
| `GET`    | `/diputados/:id`       | Perfil completo: datos, mandatos, estadísticas, alineamientos               |
| `GET`    | `/diputados/:id/votos` | Historial. Query: `q`, `voto`, `anio`, `soloGeneral`, `page`, `pageSize`    |
| `GET`    | `/bloques`             | Bloques actuales con cantidad de bancas                                     |
| `GET`    | `/distritos`           | Distritos con cantidad de bancas                                            |
| `GET`    | `/votaciones`          | Listado. Query: `q`, `desde`, `hasta`, `anio`, `resultado`, `soloGeneral`…  |
| `GET`    | `/votaciones/:id`      | Detalle con conteo, porcentajes, voto de cada diputado y resumen por bloque |
| `GET`    | `/stats/resumen`       | Números generales para el panel de inicio                                   |
| `POST`   | `/poroteos`            | Crear (JSON o `multipart/form-data` con `archivo` PDF opcional)             |
| `GET`    | `/poroteos`            | Listado con resumen del resultado                                           |
| `GET`    | `/poroteos/:id`        | Detalle con votos y resultado calculado                                     |
| `PATCH`  | `/poroteos/:id`        | Editar título, descripción, tipo de mayoría, estado                         |
| `PUT`    | `/poroteos/:id/votos`  | Guardar votos estimados (`modo: merge \| replace`)                          |
| `DELETE` | `/poroteos/:id`        | Borrar                                                                      |

Todas las rutas `/poroteos` requieren Bearer; listan y operan solo sobre el dueño
verificado. Ver [modelo privado](docs/poroteos-privados.md).

Más detalle (formatos, reglas de cálculo, esquema) en [`CLAUDE.md`](CLAUDE.md).

## Estructura

```
src/
  config/        env (validación), cliente Supabase, logger, constantes
  routes/        index.js compone routers; *.routes.js define endpoints y middlewares
  controllers/   req.valid → service → respuesta HTTP (status, headers y JSON)
  services/      reglas, DTOs camelCase, caché y coordinación; sin SDK de Supabase
  entities/      clases de tablas con campos públicos snake_case y JSDoc; sin lógica
  repositories/  consultas a tablas, vistas y RPC; devuelven filas de la base
  middlewares/   validación, errores, rate limit, upload
  validators/    esquemas zod
  utils/         helpers (errores, paginación, caché, Supabase)
  app.js         arma la app Express
  server.js      levanta el servidor
supabase/migrations/   SQL de las tablas propias
tests/                 Vitest + Supertest
```

El flujo es **Ruta → Controller → Service → Repository → Supabase**. Los módulos
siguen siendo funciones JavaScript con ES Modules. Los repositories no dependen de
Express y usan los clientes de `config/supabase.js`: el público para datos históricos
y el admin únicamente en `poroteos.repository.js` para las tablas propias.
`unwrap()` centraliza los errores (502/503), `sanitizeSearch()` prepara filtros de
texto y `fetchAll()` conserva las lecturas completas paginando de a 1000 filas.
La RPC de alineación mantiene su excepción existente: si falta la función, el
perfil devuelve `alineacionBloque: null`; otros errores se propagan.

Los repositories son `diputados`, `votaciones`, `poroteos` y `metadata` (`cv_meta`).
Catálogos deriva los conteos de diputados cacheados, por lo que no necesita un
repository. Estadísticas coordina esos servicios y los repositories de votaciones
y metadatos; tampoco tiene un repository propio. La extracción PDF sigue en
`pdf.service.js` y el resultado es una función pura en `services/resultado.js`.
Los routers conservan las rutas públicas completas y el orden de middlewares;
para poroteos: límite de escritura → carga PDF (solo POST) → validación → controller.

### Entities de tablas

`src/entities/` contiene las 15 clases de tablas, con campos públicos sin
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

### Ejemplo: agregar una funcionalidad

Para agregar una consulta al historial de un diputado:

1. Definir la entrada Zod en `validators/diputados.validator.js`.
2. Agregar la consulta en `repositories/diputados.repository.js` usando el cliente
   público y `unwrap()` (o `fetchAll()` si requiere todas las filas).
3. Coordinarla y preparar el DTO camelCase en `services/diputados.service.js`.
4. Agregar un controller fino en `controllers/diputados.controller.js` que lea
   `req.valid` y construya la respuesta HTTP.
5. Conectar validación y controller en `routes/diputados.routes.js`. El router ya
   está registrado en `routes/index.js`.
6. Cubrir el contrato y los errores con mocks de servicios en `tests/api.test.js`,
   y las consultas y reglas con dobles del cliente en `tests/capas.test.js`.
   Actualizar las tablas de endpoints del README, AGENTS y CLAUDE si cambia la API.

### Validación y pendientes del refactor

Las pruebas nunca usan la base real. `tests/capas.test.js` recorre las capas con
clientes Supabase dobles y extracción PDF simulada; comprueba DTOs, errores,
paginación, filtros, caché, carga PDF y guardado de votos. Las pruebas existentes
de HTTP y del cálculo puro se conservan.

Limitación previa pendiente: `replace` borra y después hace upsert en operaciones
separadas, sin transacción. Si falla el upsert, los votos anteriores ya se borraron.
El recálculo de origen y la lectura final también son independientes. Se conserva
la secuencia y se cubre el fallo intermedio; resolver la atomicidad requiere una
tarea posterior. No se agregaron funciones SQL ni migraciones.

En la comprobación inicial pasaron 31 pruebas y lint; el chequeo de formato fallaba
por el `AGENTS.md` local sin seguimiento. Se conservó su contenido y se actualizó
la arquitectura y el formato junto con esta documentación.

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
agregan operaciones administrativas de escritura. Los demás endpoints de
poroteos normales requieren propietario; el backoffice conserva consulta global.

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

Todas las rutas normales `/api/poroteos` exigen Bearer validado y filtran por
`poroteos.user_id = req.usuario.id`, incluidos conteos, actualizaciones y borrados.
Los votos requieren autorizar el padre. Sin sesión: 401; ajeno, NULL o inexistente: 404. POST/PATCH rechazan propietario enviado por el cliente; `autor` es descriptivo.
Solo el backoffice superadmin mantiene consulta global, sin escrituras globales.
Modelo, migración local no aplicada y asignación administrativa explícita de
registros anteriores: [poroteos privados](docs/poroteos-privados.md).

## Problemas frecuentes

**`self-signed certificate in certificate chain` al consultar Supabase.** Pasa en redes que inspeccionan HTTPS (redes corporativas o de facultad). Con Node ≥ 22.15, agregá `NODE_OPTIONS=--use-system-ca` al `.env` para usar los certificados del sistema operativo.

## Fuente de los datos

Los datos de votaciones provienen de [¿Cómo Votó?](https://comovoto.dev.ar), de Rodrigo Quiroga ([repo](https://github.com/rquiroga7/Como_voto)). Hay que citar la fuente en la plataforma.
