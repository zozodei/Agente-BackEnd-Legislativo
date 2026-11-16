# Predicción con IA (`POST /api/poroteos/:id/prediccion`)

Estado: **integración lista con un predictor simulado**. El modelo real vive en `ml/` y todavía
no está congelado ni evaluado en prueba. Cuando exista, se levanta como servicio HTTP y se
configura `PREDICTOR_URL`; ni el endpoint ni el frontend cambian.

## Flujo

```
Editor (front) ── POST /api/poroteos/:id/prediccion ──▶ backend
                                                        │ 1. sesión + membresía + permiso de edición
                                                        │ 2. arma la entrada (proyecto + 257 diputados)
                                                        │ 3. servicio Python (PREDICTOR_URL) o simulador
                                                        │ 4. valida la respuesta con zod
Editor ◀── propuesta (no se guarda) ────────────────────┘
   │ la persona revisa, corrige y guarda
   └── PUT /api/poroteos/:id/votos  (origen 'ia' + confianza + justificacion + fuentes)
```

**El endpoint no guarda nada.** Devuelve una propuesta; el editor la carga y la persona la
guarda con el botón de siempre. Así no hace falta una migración nueva, no se pisan votos sin
querer y las correcciones a mano quedan como `origen: 'manual'`. El resumen del modelo
(probabilidad de aprobación, intervalo) se muestra en el editor pero no se persiste: para
guardarlo hace falta agregar `metadata` a la acción `actualizar` de `poroteo_mutar`
(pendiente, requiere migración).

## Configuración (`.env`)

| Variable               | Default                    | Qué hace                                                                       |
| ---------------------- | -------------------------- | ------------------------------------------------------------------------------ |
| `PREDICTOR_URL`        | vacío                      | URL del servicio Python, ej. `http://localhost:8000`. Si está, se usa siempre. |
| `PREDICTOR_TIMEOUT_MS` | `60000`                    | Tiempo máximo de espera al servicio.                                           |
| `PREDICTOR_SIMULADO`   | `true` fuera de producción | Sin `PREDICTOR_URL`, usa el simulador. Prohibido en producción.                |

Sin URL y sin simulador, el endpoint responde `503 SERVICE_UNAVAILABLE`.

## Endpoint

`POST /api/poroteos/:id/prediccion` · sesión obligatoria · body vacío · `no-store` ·
límite de 6 por minuto por usuario (además del límite de escrituras).

| Código | Cuándo                                                                           |
| ------ | -------------------------------------------------------------------------------- |
| 200    | `{ data: Prediccion }` (formato abajo, más `poroteoId`, `version`, `generadaEn`) |
| 400    | body con campos, UUID inválido                                                   |
| 403    | colaborador sin permiso de edición                                               |
| 404    | no existe o no sos miembro                                                       |
| 502    | el servicio no respondió, devolvió error o un formato inválido                   |
| 503    | predicción no configurada                                                        |

El backend descarta votos de diputados que no están entre los 257 actuales o repetidos, y lo
informa en `advertencias`. Los diputados sin predicción quedan sin asignar en el editor.

## Contrato del servicio Python

`POST {PREDICTOR_URL}/predecir` con `Content-Type: application/json`.

### Entrada

```json
{
  "proyecto": {
    "id": "uuid del poroteo",
    "titulo": "Régimen de incentivo para grandes inversiones",
    "descripcion": "texto o null",
    "texto": "texto completo del proyecto o null",
    "autor": "texto libre o null (hoy no está estructurado)",
    "tipoMayoria": "simple | absoluta | dos_tercios",
    "camara": "diputados"
  },
  "diputados": [
    {
      "id": 123,
      "apellido": "PÉREZ",
      "nombre": "Juan",
      "distrito": "BUENOS AIRES",
      "bloque": "UNION POR LA PATRIA",
      "personaId": 456,
      "presentismo": 91.2
    }
  ]
}
```

- `diputados[].id` es el ID de la app: es el que hay que devolver. El cruce con los IDs del
  dataset es responsabilidad del servicio (nombre normalizado + distrito + mandato vigente; los
  dudosos, a revisión manual; nunca matching difuso silencioso).
- `personaId` es el ID de ¿Cómo Votó?, por si ayuda al cruce.
- La fecha de referencia es la del pedido: el servicio usa el historial disponible hasta hoy.

### Salida

```json
{
  "modelo": {
    "nombre": "poroteo-ml",
    "version": "2026-11-16",
    "variante": "solo_tema",
    "simulado": false,
    "datosHasta": "2026-11-02"
  },
  "tema": { "valor": "ECONOMIA", "origen": "titulo" },
  "votos": [
    {
      "diputadoId": 123,
      "voto": "AFIRMATIVO",
      "probabilidades": {
        "AFIRMATIVO": 0.71,
        "NEGATIVO": 0.12,
        "ABSTENCION": 0.03,
        "AUSENTE": 0.14
      },
      "confianza": 0.71,
      "justificacion": "Votó a favor en el 82% de los proyectos de economía; su bloque acompañó al oficialismo en el 75% de las votaciones del último año.",
      "fuentes": [{ "tipo": "historial_tema", "tema": "ECONOMIA", "votaciones": 34 }]
    }
  ],
  "resumen": {
    "esperados": { "afirmativos": 141.3, "negativos": 72.8, "abstenciones": 4.1, "ausentes": 38.8 },
    "intervalo80": { "afirmativos": [98, 176], "negativos": [31, 118] },
    "probAprobacion": 0.82,
    "probQuorum": 0.97,
    "probDividida": 0.64,
    "posibleDividida": true
  },
  "advertencias": ["3 diputados sin historial: predicción basada en su bloque"]
}
```

Reglas que valida el backend (si no se cumplen, 502):

- `votos[].voto`: `AFIRMATIVO | NEGATIVO | ABSTENCION | AUSENTE` (la clase elegida con el
  umbral calibrado; nunca `INDEFINIDO`).
- `probabilidades`: las cuatro clases, cada una en [0, 1], suman 1 (±0,02).
- `confianza` en [0, 1]; `justificacion` ≤ 1000 caracteres; `fuentes` ≤ 20 objetos.
- `tema.origen`: `titulo | texto | usuario | desconocido`; `tema` puede ser `null`.
- `resumen.esperados` en [0, 257]; `intervalo80` es `[mínimo, máximo]` o `null`.
- `probAprobacion`, `probQuorum`, `probDividida`, `posibleDividida` pueden ser `null`.
- `modelo.simulado` debe ser `false`: el backend rechaza simulaciones del servicio real.
- No se aceptan campos extra (`strict`): si el servicio agrega algo, se actualiza el esquema
  en `src/validators/prediccion.validator.js` y este documento.

La `justificacion` sale de las variables del modelo (historial por tema, alineación con el
oficialismo, bloque), no de un LLM: tiene que ser verificable.

## Simulador

`src/services/prediccion/simulador.js` genera datos de mentira con el mismo formato:
tendencias inventadas por bloque, Monte Carlo con efecto común y por bloque para el intervalo
y la probabilidad de aprobación. Es determinista por poroteo. Responde con
`modelo.simulado: true` y una advertencia, y el frontend lo muestra como **SIMULACIÓN**.

## Archivos

- `src/routes/poroteos.routes.js` (ruta + `prediccionLimiter`), `src/controllers/poroteos.controller.js`
- `src/services/prediccion.service.js` (reglas), `src/services/prediccion/simulador.js`
- `src/clients/predictor.client.js` (HTTP al servicio), `src/validators/prediccion.validator.js`
- Pruebas: `tests/prediccion.test.js` y contrato HTTP en `tests/api.test.js`

## Pendiente

1. Servicio Python en `ml/` que cumpla este contrato (FastAPI, modelo congelado).
2. Persistir el resumen del modelo en `poroteos.metadata` (migración de `poroteo_mutar`).
3. Autor estructurado (diputado / Ejecutivo / Senado) si se adopta la variante `con_autor`.
