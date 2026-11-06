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

| Variable                    | Obligatoria | Descripción                                                     |
| --------------------------- | :---------: | --------------------------------------------------------------- |
| `NODE_ENV`                  |             | `development` \| `production` \| `test` (default `development`) |
| `PORT`                      |             | Puerto HTTP (default `4000`)                                    |
| `LOG_LEVEL`                 |             | Nivel de pino (default `info`)                                  |
| `CORS_ORIGINS`              |     ✅      | Orígenes permitidos, separados por coma                         |
| `SUPABASE_URL`              |     ✅      | URL del proyecto Supabase                                       |
| `SUPABASE_PUBLISHABLE_KEY`  |     ✅      | Clave pública (lectura)                                         |
| `SUPABASE_SECRET_KEY`       |     ✅      | Clave secreta (escritura de poroteos). **Nunca** en el front    |
| `RATE_LIMIT_WINDOW_MS`      |             | Ventana del rate limit en ms (default `60000`)                  |
| `RATE_LIMIT_MAX`            |             | Requests por ventana por IP (default `300`)                     |
| `RATE_LIMIT_WRITE_MAX`      |             | Escrituras por ventana por IP (default `60`)                    |
| `RATE_LIMIT_AUTH_WINDOW_MS` |             | Ventana del límite de login/registro (default `900000`, 15 min) |
| `RATE_LIMIT_AUTH_MAX`       |             | Intentos de login/registro por ventana por IP (default `20`)    |
| `CACHE_DIPUTADOS_MINUTOS`   |             | Caché en memoria de los 257 diputados (default `10`)            |

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
| `GET`    | `/diputados`           | Listado. Query: `q`, `bloque`, `distrito`, `orden`, `page`, `pageSize`      |
| `GET`    | `/diputados/:id`       | Perfil completo: datos, mandatos, estadísticas, alineamientos               |
| `GET`    | `/diputados/:id/votos` | Historial. Query: `q`, `voto`, `anio`, `soloGeneral`, `page`, `pageSize`    |
| `GET`    | `/bloques`             | Bloques actuales con cantidad de bancas                                     |
| `GET`    | `/distritos`           | Distritos con cantidad de bancas                                            |
| `GET`    | `/votaciones`          | Listado. Query: `q`, `desde`, `hasta`, `anio`, `resultado`, `soloGeneral`…  |
| `GET`    | `/votaciones/:id`      | Detalle con conteo, porcentajes, voto de cada diputado y resumen por bloque |
| `GET`    | `/stats/resumen`       | Números generales para el panel de inicio                                   |
| `POST`   | `/auth/registro`       | Crear cuenta (`email`, `password`, `nombre`)                                |
| `POST`   | `/auth/login`          | Iniciar sesión → `accessToken` + `refreshToken`                             |
| `POST`   | `/auth/refresh`        | Renovar la sesión con el `refreshToken`                                     |
| `POST`   | `/auth/logout`         | Cerrar sesión 🔒                                                            |
| `GET`    | `/auth/me`             | Usuario logueado 🔒                                                         |
| `POST`   | `/poroteos`            | Crear (JSON o `multipart/form-data` con `archivo` PDF opcional)             |
| `GET`    | `/poroteos`            | Listado con resumen del resultado                                           |
| `GET`    | `/poroteos/:id`        | Detalle con votos y resultado calculado                                     |
| `PATCH`  | `/poroteos/:id`        | Editar título, descripción, tipo de mayoría, estado                         |
| `PUT`    | `/poroteos/:id/votos`  | Guardar votos estimados (`modo: merge \| replace`)                          |
| `DELETE` | `/poroteos/:id`        | Borrar                                                                      |

🔒 = requiere `Authorization: Bearer <accessToken>`. **Todos los `/poroteos` son 🔒** y cada usuario ve solo los suyos.

Más detalle (formatos, reglas de cálculo, esquema) en [`CLAUDE.md`](CLAUDE.md).

## Estructura

```
src/
  config/        env (validación), cliente Supabase, logger, constantes
  routes/        definición de endpoints
  controllers/   request → service → response
  services/      lógica de negocio y acceso a Supabase
  middlewares/   validación, auth (token), errores, rate limit, upload
  validators/    esquemas zod
  utils/         helpers (errores, paginación, caché, Supabase)
  app.js         arma la app Express
  server.js      levanta el servidor
supabase/migrations/   SQL de las tablas propias
tests/                 Vitest + Supertest
```

## Problemas frecuentes

**`self-signed certificate in certificate chain` al consultar Supabase.** Pasa en redes que inspeccionan HTTPS (redes corporativas o de facultad). Con Node ≥ 22.15, agregá `NODE_OPTIONS=--use-system-ca` al `.env` para usar los certificados del sistema operativo.

## Fuente de los datos

Los datos de votaciones provienen de [¿Cómo Votó?](https://comovoto.dev.ar), de Rodrigo Quiroga ([repo](https://github.com/rquiroga7/Como_voto)). Hay que citar la fuente en la plataforma.
