# Etapa 2 · Baselines en validación (2023–2024)

Generado por `scripts/02_baselines.py` + `scripts/02_reporte.py`. **PRUEBA no se cargó ni se predijo.** Tests: `pytest tests` → 13 pasan (fuga temporal, splits y reglas de resultado).

> Experimental: `aptitud = PENDIENTE` en todo el dataset. Validación = 25 votaciones generales en 6 sesiones (presencia: 54 votaciones en 10 sesiones). Los IC son amplios por diseño.

## Resumen en 5 líneas

1. **Ningún baseline distingue un proyecto de otro.** Todas las features describen al diputado y a la fecha, no al proyecto. Por eso, dentro de una sesión, todas las votaciones reciben la misma predicción, y el error en afirmativos por votación queda en **≈ 66–80** (argmax) o **≈ 32–37** (conteo esperado Σp).
2. **Lo que más mejora es bloque/signo al inicio de la sesión:** la log loss de voto|presente baja de 0,641 (constante) a **0,505** (logística con bloque/signo). El historial personal solo, con prior global, casi no aporta (0,631): el rolling origin eligió α=3000, que es suavizar casi todo hacia la constante.
3. **F1 macro sigue cerca de la constante** (0,29 → 0,32). Con argmax casi nunca se predice NEGATIVO, y ABSTENCION nunca.
4. **Presencia:** el historial personal sí ayuda (log loss 0,396 → 0,368). Bloque/signo no suma.
5. **El acierto de resultado y de quórum es 1,00 para todos los modelos, incluida la constante.** Era esperable (25/25 aprobadas, quórum siempre holgado): estas dos métricas no discriminan en validación.

## Decisiones aplicadas (de tu OK)

- **Bloque, distrito y signo al inicio de la sesión:** se toman del intervalo de mandato/bloque vigente el **día anterior** (`historial_bloques_intervalos`, `BLOQUE_INICIO ≤ D-1 ≤ BLOQUE_FIN`). Signo = regla documental bloque × gobierno vigente en D-1, solo si ya consta en `contexto_bloque_fecha` en una fecha **anterior** a la sesión. Si no hay intervalo único o la fila tiene `bloque_historico_estado = BLOCKED`, el bloque queda **DESCONOCIDO**, sin rellenar (en las filas generales hubo 0 BLOCKED y 79 sin intervalo único). Nunca se usa la columna `bloque` ni `signo_politico` de la fila.
- **Historial móvil = principal; congelado = secundario** (§4). "Sin historial" = 0 votos previos elegibles en la variante correspondiente.
- **IC95:** bootstrap con 1.000 réplicas **agrupado por sesión** (principal) y por votación (secundario, §3).
- **Selección de modelos por rolling origin dentro de ENTRENAMIENTO:** train ≤ Y-1 → valida Y, con purga de grupos de proyecto compartidos. **Aviso:** el conjunto general no tiene votaciones en **2020 ni 2021**, así que para voto los folds efectivos son 2017, 2018, 2019 y 2022. Presencia usa los seis folds. La validación 2023–2024 **no** se usó para elegir nada.
- **Firmas fuera del modelo.** Tipo de mayoría = simple en todas.
- **Quórum y totales:** cada votación se compara contra los **totales oficiales** (`oficial_votos_afirmativos/negativos/abstenciones`; las 25 los tienen). **Bancas sin fila:** cada votación general tiene entre 7 y 14 bancas sin fila en presencia (media 12.2), sea por vacantes, `SIN_DATO` o filas excluidas por el proveedor. No se predicen ni se imputan: cuentan como "sin asignar" de la app, es decir, no presentes. Para medir cuánto error se debe solo a eso, la fila **oráculo** de §5 usa las etiquetas reales de las filas existentes. Resultado oficial recalculado con las reglas de la app: APROBADO: 25.

## 1. Tabla comparativa principal · historial móvil · IC95 por sesión

B = voto | presente (5.082 filas, 3 clases). A = presencia (13.291 filas, 54 votaciones). A×B = combinado de 4 clases sobre las 25 votaciones generales (6.121 filas). "Vot" = métricas por votación (25), contra totales oficiales, con conteos por argmax como en la app (voto = clase más probable). EA = error absoluto medio.

| modelo | B · F1 macro | B · log loss | B · Brier | A · F1 macro | A · log loss | A×B · F1 macro (4 cl.) | A×B · log loss | Vot · EA afirm. | Vot · EA neg. | Vot · acierto resultado | Vot · acierto quórum |
|---|---|---|---|---|---|---|---|---|---|---|---|
| (a) constante | 0.293 [0.275, 0.307] | 0.641 [0.494, 0.818] | 0.360 [0.256, 0.481] | 0.469 [0.443, 0.486] | 0.396 [0.316, 0.505] | 0.197 [0.186, 0.207] | 0.994 [0.892, 1.135] | 79.5 [67.0, 93.7] | 37.7 [20.4, 58.1] | 1.00 [1.00, 1.00] | 1.00 [1.00, 1.00] |
| (b) historial | 0.293 [0.275, 0.307] | 0.631 [0.490, 0.799] | 0.356 [0.255, 0.474] | 0.495 [0.466, 0.520] | 0.368 [0.288, 0.480] | 0.215 [0.207, 0.225] | 0.956 [0.866, 1.074] | 73.8 [61.7, 87.2] | 37.7 [20.4, 58.1] | 1.00 [1.00, 1.00] | 1.00 [1.00, 1.00] |
| (b) historial + prior bloque/signo | 0.293 [0.275, 0.307] | 0.524 [0.421, 0.637] | 0.307 [0.226, 0.398] | 0.492 [0.465, 0.513] | 0.373 [0.302, 0.481] | 0.214 [0.207, 0.222] | 0.860 [0.791, 0.928] | 74.1 [61.9, 87.6] | 37.7 [20.4, 58.1] | 1.00 [1.00, 1.00] | 1.00 [1.00, 1.00] |
| (c) logística sin bloque/signo | 0.293 [0.275, 0.307] | 0.542 [0.430, 0.666] | 0.317 [0.239, 0.405] | 0.496 [0.467, 0.522] | 0.383 [0.324, 0.474] | 0.226 [0.215, 0.236] | 0.875 [0.808, 0.956] | 72.4 [60.9, 85.5] | 37.7 [20.4, 58.1] | 1.00 [1.00, 1.00] | 1.00 [1.00, 1.00] |
| (c) logística con bloque/signo | 0.322 [0.290, 0.352] | 0.505 [0.408, 0.597] | 0.304 [0.233, 0.375] | 0.497 [0.467, 0.523] | 0.393 [0.339, 0.481] | 0.243 [0.228, 0.254] | 0.847 [0.790, 0.902] | 65.6 [47.0, 83.2] | 36.4 [19.3, 55.2] | 1.00 [1.00, 1.00] | 1.00 [1.00, 1.00] |

## 2. Con y sin historial · historial móvil · IC95 por sesión

Hay muy pocos diputados sin historial móvil en validación (34 filas de voto, 7 diputados), así que esos IC son poco informativos. La sección 4 (congelado) muestra mejor el arranque en frío.

| objetivo | subgrupo | n filas | votaciones | modelo | F1 macro | log loss | Brier | accuracy (ref.) |
|---|---|---|---|---|---|---|---|---|
| B | con_historial | 5048 | 25 | (a) constante | 0.294 [0.276, 0.307] | 0.636 [0.494, 0.806] | 0.357 [0.256, 0.476] | 0.787 [0.706, 0.855] |
| B | con_historial | 5048 | 25 | (b) historial | 0.294 [0.276, 0.307] | 0.626 [0.489, 0.792] | 0.353 [0.255, 0.469] | 0.787 [0.706, 0.855] |
| B | con_historial | 5048 | 25 | (b) historial + prior bloque/signo | 0.294 [0.276, 0.307] | 0.519 [0.421, 0.624] | 0.304 [0.226, 0.391] | 0.787 [0.706, 0.855] |
| B | con_historial | 5048 | 25 | (c) logística sin bloque/signo | 0.293 [0.276, 0.307] | 0.537 [0.430, 0.662] | 0.314 [0.237, 0.401] | 0.786 [0.706, 0.855] |
| B | con_historial | 5048 | 25 | (c) logística con bloque/signo | 0.323 [0.292, 0.352] | 0.502 [0.408, 0.591] | 0.302 [0.232, 0.373] | 0.773 [0.696, 0.845] |
| B | sin_historial | 34 | 14 | (a) constante | 0.222 [0.167, 1.000] | 1.315 [0.158, 1.713] | 0.794 [0.036, 1.048] | 0.500 [0.333, 1.000] |
| B | sin_historial | 34 | 14 | (b) historial | 0.222 [0.167, 1.000] | 1.315 [0.158, 1.713] | 0.794 [0.036, 1.048] | 0.500 [0.333, 1.000] |
| B | sin_historial | 34 | 14 | (b) historial + prior bloque/signo | 0.222 [0.167, 1.000] | 1.305 [0.150, 1.715] | 0.782 [0.032, 1.035] | 0.500 [0.333, 1.000] |
| B | sin_historial | 34 | 14 | (c) logística sin bloque/signo | 0.222 [0.167, 1.000] | 1.166 [0.218, 1.495] | 0.727 [0.064, 0.949] | 0.500 [0.333, 1.000] |
| B | sin_historial | 34 | 14 | (c) logística con bloque/signo | 0.222 [0.167, 1.000] | 1.013 [0.334, 1.265] | 0.636 [0.138, 0.809] | 0.500 [0.333, 1.000] |
| A | con_historial | 13237 | 54 | (a) constante | 0.468 [0.443, 0.486] | 0.397 [0.316, 0.506] | 0.228 [0.158, 0.325] | 0.881 [0.796, 0.944] |
| A | con_historial | 13237 | 54 | (b) historial | 0.495 [0.466, 0.520] | 0.369 [0.288, 0.481] | 0.217 [0.151, 0.308] | 0.867 [0.791, 0.922] |
| A | con_historial | 13237 | 54 | (b) historial + prior bloque/signo | 0.491 [0.465, 0.513] | 0.374 [0.302, 0.482] | 0.219 [0.158, 0.307] | 0.874 [0.792, 0.934] |
| A | con_historial | 13237 | 54 | (c) logística sin bloque/signo | 0.496 [0.467, 0.522] | 0.384 [0.324, 0.475] | 0.225 [0.171, 0.305] | 0.870 [0.794, 0.923] |
| A | con_historial | 13237 | 54 | (c) logística con bloque/signo | 0.497 [0.467, 0.522] | 0.394 [0.339, 0.482] | 0.233 [0.184, 0.308] | 0.869 [0.794, 0.923] |
| A | sin_historial | 54 | 22 | (a) constante | 1.000 [1.000, 1.000] | 0.244 [0.244, 0.244] | 0.094 [0.094, 0.094] | 1.000 [1.000, 1.000] |
| A | sin_historial | 54 | 22 | (b) historial | 1.000 [1.000, 1.000] | 0.244 [0.244, 0.244] | 0.094 [0.094, 0.094] | 1.000 [1.000, 1.000] |
| A | sin_historial | 54 | 22 | (b) historial + prior bloque/signo | 1.000 [1.000, 1.000] | 0.187 [0.144, 0.211] | 0.068 [0.050, 0.083] | 1.000 [1.000, 1.000] |
| A | sin_historial | 54 | 22 | (c) logística sin bloque/signo | 1.000 [1.000, 1.000] | 0.290 [0.217, 0.322] | 0.134 [0.084, 0.154] | 1.000 [1.000, 1.000] |
| A | sin_historial | 54 | 22 | (c) logística con bloque/signo | 1.000 [1.000, 1.000] | 0.296 [0.217, 0.335] | 0.142 [0.088, 0.166] | 1.000 [1.000, 1.000] |
| A×B | con_historial | 6087 | 25 | (a) constante | 0.197 [0.186, 0.207] | 0.991 [0.893, 1.128] | 0.529 [0.477, 0.597] | 0.652 [0.594, 0.703] |
| A×B | con_historial | 6087 | 25 | (b) historial | 0.216 [0.207, 0.225] | 0.953 [0.867, 1.064] | 0.513 [0.467, 0.572] | 0.648 [0.596, 0.694] |
| A×B | con_historial | 6087 | 25 | (b) historial + prior bloque/signo | 0.214 [0.207, 0.222] | 0.856 [0.791, 0.919] | 0.466 [0.432, 0.503] | 0.648 [0.595, 0.697] |
| A×B | con_historial | 6087 | 25 | (c) logística sin bloque/signo | 0.226 [0.215, 0.236] | 0.872 [0.809, 0.957] | 0.467 [0.435, 0.510] | 0.652 [0.603, 0.695] |
| A×B | con_historial | 6087 | 25 | (c) logística con bloque/signo | 0.244 [0.228, 0.254] | 0.844 [0.784, 0.899] | 0.460 [0.428, 0.494] | 0.638 [0.598, 0.677] |
| A×B | sin_historial | 34 | 14 | (a) constante | 0.222 [0.167, 1.000] | 1.558 [0.402, 1.957] | 0.759 [0.165, 0.958] | 0.500 [0.333, 1.000] |
| A×B | sin_historial | 34 | 14 | (b) historial | 0.222 [0.167, 1.000] | 1.558 [0.402, 1.957] | 0.759 [0.165, 0.958] | 0.500 [0.333, 1.000] |
| A×B | sin_historial | 34 | 14 | (b) historial + prior bloque/signo | 0.222 [0.167, 1.000] | 1.492 [0.360, 1.904] | 0.718 [0.136, 0.921] | 0.500 [0.333, 1.000] |
| A×B | sin_historial | 34 | 14 | (c) logística sin bloque/signo | 0.222 [0.167, 1.000] | 1.459 [0.559, 1.789] | 0.708 [0.280, 0.866] | 0.500 [0.333, 1.000] |
| A×B | sin_historial | 34 | 14 | (c) logística con bloque/signo | 0.222 [0.167, 1.000] | 1.311 [0.688, 1.564] | 0.658 [0.365, 0.778] | 0.500 [0.333, 1.000] |

## 3. Misma tabla · IC95 por votación (secundario)

| modelo | B · F1 macro | B · log loss | B · Brier | A · F1 macro | A · log loss | A×B · F1 macro (4 cl.) | A×B · log loss | Vot · EA afirm. | Vot · EA neg. | Vot · acierto resultado | Vot · acierto quórum |
|---|---|---|---|---|---|---|---|---|---|---|---|
| (a) constante | 0.293 [0.277, 0.308] | 0.641 [0.476, 0.799] | 0.360 [0.251, 0.468] | 0.469 [0.461, 0.476] | 0.396 [0.361, 0.432] | 0.197 [0.187, 0.206] | 0.994 [0.869, 1.122] | 79.5 [66.3, 93.2] | 37.7 [21.1, 55.4] | 1.00 [1.00, 1.00] | 1.00 [1.00, 1.00] |
| (b) historial | 0.293 [0.277, 0.308] | 0.631 [0.473, 0.784] | 0.356 [0.249, 0.460] | 0.495 [0.484, 0.507] | 0.368 [0.329, 0.411] | 0.215 [0.205, 0.225] | 0.956 [0.839, 1.077] | 73.8 [60.9, 87.4] | 37.7 [21.1, 55.4] | 1.00 [1.00, 1.00] | 1.00 [1.00, 1.00] |
| (b) historial + prior bloque/signo | 0.293 [0.277, 0.308] | 0.524 [0.413, 0.636] | 0.307 [0.227, 0.385] | 0.492 [0.482, 0.502] | 0.373 [0.336, 0.415] | 0.214 [0.204, 0.224] | 0.860 [0.779, 0.949] | 74.1 [61.0, 87.5] | 37.7 [21.1, 55.4] | 1.00 [1.00, 1.00] | 1.00 [1.00, 1.00] |
| (c) logística sin bloque/signo | 0.293 [0.277, 0.308] | 0.542 [0.427, 0.657] | 0.317 [0.237, 0.394] | 0.496 [0.485, 0.509] | 0.383 [0.351, 0.419] | 0.226 [0.215, 0.236] | 0.875 [0.787, 0.971] | 72.4 [59.4, 85.7] | 37.7 [21.1, 55.4] | 1.00 [1.00, 1.00] | 1.00 [1.00, 1.00] |
| (c) logística con bloque/signo | 0.322 [0.299, 0.349] | 0.505 [0.421, 0.590] | 0.304 [0.245, 0.358] | 0.497 [0.486, 0.509] | 0.393 [0.361, 0.430] | 0.243 [0.230, 0.258] | 0.847 [0.782, 0.918] | 65.6 [52.0, 79.9] | 36.4 [21.6, 52.9] | 1.00 [1.00, 1.00] | 1.00 [1.00, 1.00] |

## 4. Historial congelado al 2023-01-01 (benchmark del protocolo, secundario) · IC por sesión

Los mismos modelos ajustados, evaluados con `hist_train_*` en lugar de `prev_*`. Con esta variante, 105 de 368 diputados de validación quedan sin historial: es el escenario de **arranque en frío**.

| modelo | B · F1 macro | B · log loss | B · Brier | A · F1 macro | A · log loss | A×B · F1 macro (4 cl.) | A×B · log loss | Vot · EA afirm. | Vot · EA neg. | Vot · acierto resultado | Vot · acierto quórum |
|---|---|---|---|---|---|---|---|---|---|---|---|
| (a) constante | 0.293 [0.275, 0.307] | 0.641 [0.494, 0.818] | 0.360 [0.256, 0.481] | 0.469 [0.443, 0.486] | 0.396 [0.316, 0.505] | 0.197 [0.186, 0.207] | 0.994 [0.892, 1.135] | 79.5 [67.0, 93.7] | 37.7 [20.4, 58.1] | 1.00 [1.00, 1.00] | 1.00 [1.00, 1.00] |
| (b) historial | 0.293 [0.275, 0.307] | 0.632 [0.489, 0.800] | 0.356 [0.255, 0.474] | 0.494 [0.466, 0.520] | 0.382 [0.301, 0.492] | 0.212 [0.205, 0.220] | 0.967 [0.879, 1.080] | 72.7 [59.7, 87.0] | 37.7 [20.4, 58.1] | 1.00 [1.00, 1.00] | 1.00 [1.00, 1.00] |
| (b) historial + prior bloque/signo | 0.293 [0.275, 0.307] | 0.520 [0.418, 0.636] | 0.306 [0.224, 0.395] | 0.492 [0.466, 0.514] | 0.384 [0.313, 0.486] | 0.216 [0.211, 0.222] | 0.863 [0.792, 0.930] | 73.3 [61.0, 87.1] | 37.7 [20.4, 58.1] | 1.00 [1.00, 1.00] | 1.00 [1.00, 1.00] |
| (c) logística sin bloque/signo | 0.293 [0.275, 0.307] | 0.537 [0.428, 0.652] | 0.314 [0.237, 0.397] | 0.495 [0.467, 0.522] | 0.415 [0.363, 0.491] | 0.222 [0.214, 0.231] | 0.888 [0.812, 0.972] | 72.7 [59.7, 87.0] | 37.7 [20.4, 58.1] | 1.00 [1.00, 1.00] | 1.00 [1.00, 1.00] |
| (c) logística con bloque/signo | 0.305 [0.285, 0.329] | 0.498 [0.406, 0.583] | 0.299 [0.232, 0.364] | 0.494 [0.466, 0.520] | 0.428 [0.381, 0.502] | 0.232 [0.221, 0.244] | 0.859 [0.791, 0.921] | 65.8 [45.8, 84.0] | 36.4 [19.4, 55.3] | 1.00 [1.00, 1.00] | 1.00 [1.00, 1.00] |

Con / sin historial (congelado):

| objetivo | subgrupo | n filas | votaciones | modelo | F1 macro | log loss | Brier | accuracy (ref.) |
|---|---|---|---|---|---|---|---|---|
| B | con_historial | 4402 | 25 | (a) constante | 0.291 [0.271, 0.307] | 0.662 [0.499, 0.841] | 0.372 [0.257, 0.505] | 0.777 [0.687, 0.854] |
| B | con_historial | 4402 | 25 | (b) historial | 0.291 [0.271, 0.307] | 0.652 [0.494, 0.822] | 0.368 [0.255, 0.498] | 0.777 [0.687, 0.854] |
| B | con_historial | 4402 | 25 | (b) historial + prior bloque/signo | 0.291 [0.271, 0.307] | 0.541 [0.427, 0.659] | 0.318 [0.229, 0.422] | 0.777 [0.687, 0.854] |
| B | con_historial | 4402 | 25 | (c) logística sin bloque/signo | 0.291 [0.271, 0.307] | 0.550 [0.431, 0.714] | 0.323 [0.236, 0.446] | 0.777 [0.687, 0.854] |
| B | con_historial | 4402 | 25 | (c) logística con bloque/signo | 0.304 [0.280, 0.332] | 0.511 [0.405, 0.633] | 0.309 [0.231, 0.408] | 0.762 [0.664, 0.846] |
| B | sin_historial | 680 | 25 | (a) constante | 0.303 [0.244, 0.433] | 0.502 [0.417, 1.141] | 0.281 [0.221, 0.678] | 0.835 [0.576, 0.875] |
| B | sin_historial | 680 | 25 | (b) historial | 0.303 [0.244, 0.433] | 0.502 [0.417, 1.141] | 0.281 [0.221, 0.678] | 0.835 [0.576, 0.875] |
| B | sin_historial | 680 | 25 | (b) historial + prior bloque/signo | 0.303 [0.244, 0.433] | 0.384 [0.321, 1.097] | 0.225 [0.181, 0.660] | 0.835 [0.576, 0.875] |
| B | sin_historial | 680 | 25 | (c) logística sin bloque/signo | 0.303 [0.244, 0.433] | 0.451 [0.383, 0.992] | 0.255 [0.204, 0.612] | 0.835 [0.576, 0.875] |
| B | sin_historial | 680 | 25 | (c) logística con bloque/signo | 0.303 [0.244, 0.433] | 0.413 [0.372, 0.842] | 0.232 [0.201, 0.527] | 0.835 [0.576, 0.875] |
| A | con_historial | 10184 | 54 | (a) constante | 0.463 [0.441, 0.482] | 0.423 [0.331, 0.517] | 0.252 [0.171, 0.335] | 0.860 [0.787, 0.932] |
| A | con_historial | 10184 | 54 | (b) historial | 0.489 [0.460, 0.517] | 0.405 [0.312, 0.509] | 0.250 [0.178, 0.330] | 0.838 [0.776, 0.894] |
| A | con_historial | 10184 | 54 | (b) historial + prior bloque/signo | 0.488 [0.460, 0.510] | 0.410 [0.329, 0.511] | 0.247 [0.179, 0.327] | 0.850 [0.782, 0.914] |
| A | con_historial | 10184 | 54 | (c) logística sin bloque/signo | 0.490 [0.461, 0.519] | 0.438 [0.382, 0.514] | 0.266 [0.216, 0.333] | 0.841 [0.779, 0.894] |
| A | con_historial | 10184 | 54 | (c) logística con bloque/signo | 0.489 [0.460, 0.517] | 0.450 [0.393, 0.525] | 0.274 [0.228, 0.338] | 0.838 [0.777, 0.889] |
| A | sin_historial | 3107 | 54 | (a) constante | 0.488 [0.474, 0.499] | 0.306 [0.249, 0.369] | 0.149 [0.098, 0.204] | 0.951 [0.902, 0.996] |
| A | sin_historial | 3107 | 54 | (b) historial | 0.488 [0.474, 0.499] | 0.306 [0.249, 0.369] | 0.149 [0.098, 0.204] | 0.951 [0.902, 0.996] |
| A | sin_historial | 3107 | 54 | (b) historial + prior bloque/signo | 0.488 [0.474, 0.499] | 0.298 [0.242, 0.355] | 0.156 [0.109, 0.205] | 0.951 [0.902, 0.996] |
| A | sin_historial | 3107 | 54 | (c) logística sin bloque/signo | 0.488 [0.474, 0.499] | 0.339 [0.295, 0.382] | 0.177 [0.137, 0.217] | 0.951 [0.902, 0.996] |
| A | sin_historial | 3107 | 54 | (c) logística con bloque/signo | 0.488 [0.474, 0.499] | 0.357 [0.318, 0.394] | 0.195 [0.160, 0.228] | 0.951 [0.902, 0.996] |
| A×B | con_historial | 5371 | 25 | (a) constante | 0.195 [0.185, 0.203] | 1.019 [0.913, 1.155] | 0.545 [0.493, 0.612] | 0.637 [0.587, 0.686] |
| A×B | con_historial | 5371 | 25 | (b) historial | 0.210 [0.202, 0.220] | 0.988 [0.895, 1.098] | 0.535 [0.478, 0.602] | 0.625 [0.579, 0.669] |
| A×B | con_historial | 5371 | 25 | (b) historial + prior bloque/signo | 0.214 [0.208, 0.222] | 0.887 [0.814, 0.950] | 0.485 [0.442, 0.524] | 0.632 [0.586, 0.676] |
| A×B | con_historial | 5371 | 25 | (c) logística sin bloque/signo | 0.221 [0.211, 0.231] | 0.903 [0.812, 1.026] | 0.486 [0.437, 0.554] | 0.635 [0.587, 0.678] |
| A×B | con_historial | 5371 | 25 | (c) logística con bloque/signo | 0.225 [0.212, 0.241] | 0.873 [0.790, 0.989] | 0.478 [0.429, 0.555] | 0.619 [0.564, 0.674] |
| A×B | sin_historial | 750 | 25 | (a) constante | 0.215 [0.176, 0.279] | 0.820 [0.756, 1.386] | 0.424 [0.392, 0.683] | 0.757 [0.543, 0.781] |
| A×B | sin_historial | 750 | 25 | (b) historial | 0.215 [0.176, 0.279] | 0.820 [0.756, 1.386] | 0.424 [0.392, 0.683] | 0.757 [0.543, 0.781] |
| A×B | sin_historial | 750 | 25 | (b) historial + prior bloque/signo | 0.215 [0.176, 0.279] | 0.692 [0.647, 1.251] | 0.369 [0.347, 0.620] | 0.757 [0.543, 0.781] |
| A×B | sin_historial | 750 | 25 | (c) logística sin bloque/signo | 0.215 [0.176, 0.279] | 0.782 [0.729, 1.244] | 0.405 [0.380, 0.600] | 0.757 [0.543, 0.781] |
| A×B | sin_historial | 750 | 25 | (c) logística con bloque/signo | 0.274 [0.176, 0.294] | 0.757 [0.723, 1.089] | 0.404 [0.386, 0.543] | 0.716 [0.543, 0.737] |

## 5. Conteos por argmax vs. conteo esperado, y piso por bancas sin fila (móvil, IC por sesión)

| modelo | EA afirm. (argmax) | EA neg. (argmax) | EA afirm. (esperado Σp) | EA neg. (esperado Σp) |
|---|---|---|---|---|
| (a) constante | 79.5 [67.0, 93.7] | 37.7 [20.4, 58.1] | 32.0 [25.9, 39.5] | 39.7 [29.8, 51.7] |
| (b) historial | 73.8 [61.7, 87.2] | 37.7 [20.4, 58.1] | 33.1 [27.4, 38.6] | 40.4 [31.9, 51.1] |
| (b) historial + prior bloque/signo | 74.1 [61.9, 87.6] | 37.7 [20.4, 58.1] | 34.0 [27.1, 39.6] | 40.0 [32.1, 49.6] |
| (c) logística sin bloque/signo | 72.4 [60.9, 85.5] | 37.7 [20.4, 58.1] | 32.3 [24.8, 40.5] | 41.3 [34.7, 49.6] |
| (c) logística con bloque/signo | 65.6 [47.0, 83.2] | 36.4 [19.3, 55.2] | 36.5 [26.0, 49.7] | 40.8 [34.8, 47.8] |
| **oráculo: etiquetas reales de las filas existentes** | 5.8 [4.2, 7.9] | 2.0 [0.8, 3.4] | — | — |

El conteo por argmax (lo que muestra la app hoy) infla los afirmativos porque casi todo diputado tiene P(AFIRMATIVO) > 0,5. Sumar probabilidades (Σp) reduce a la mitad el error en **afirmativos**, pero no el de **negativos** (≈ 40 en ambos casos): ningún modelo sabe *qué* proyectos dividen a la Cámara. Propuesta para la etapa 4: además del voto por diputado, exponer el conteo esperado y su intervalo.

## 6. Matrices de confusión (móvil, validación)

**B_voto_presente · (a) constante**

| real | pred AFIRM | pred NEG | pred ABST |
|---|---|---|---|
| AFIRM | 3988 | 0 | 0 |
| NEG | 894 | 0 | 0 |
| ABST | 200 | 0 | 0 |

**B_voto_presente · (b) historial + prior bloque/signo**

| real | pred AFIRM | pred NEG | pred ABST |
|---|---|---|---|
| AFIRM | 3988 | 0 | 0 |
| NEG | 894 | 0 | 0 |
| ABST | 200 | 0 | 0 |

**B_voto_presente · (c) logística con bloque/signo**

| real | pred AFIRM | pred NEG | pred ABST |
|---|---|---|---|
| AFIRM | 3865 | 123 | 0 |
| NEG | 842 | 52 | 0 |
| ABST | 198 | 2 | 0 |

**AxB_combinado_4_clases · (a) constante**

| real | pred AFIRM | pred NEG | pred ABST | pred AUS |
|---|---|---|---|---|
| AFIRM | 3988 | 0 | 0 | 0 |
| NEG | 894 | 0 | 0 | 0 |
| ABST | 200 | 0 | 0 | 0 |
| AUS | 1039 | 0 | 0 | 0 |

**AxB_combinado_4_clases · (b) historial + prior bloque/signo**

| real | pred AFIRM | pred NEG | pred ABST | pred AUS |
|---|---|---|---|---|
| AFIRM | 3922 | 0 | 0 | 66 |
| NEG | 868 | 0 | 0 | 26 |
| ABST | 196 | 0 | 0 | 4 |
| AUS | 999 | 0 | 0 | 40 |

**AxB_combinado_4_clases · (c) logística con bloque/signo**

| real | pred AFIRM | pred NEG | pred ABST | pred AUS |
|---|---|---|---|---|
| AFIRM | 3784 | 105 | 0 | 99 |
| NEG | 813 | 40 | 0 | 41 |
| ABST | 195 | 1 | 0 | 4 |
| AUS | 920 | 44 | 0 | 75 |

## 7. Rolling origin dentro de train (selección de hiperparámetros)

| objetivo | modelo | hiperparámetro elegido | folds | log loss medio | F1 macro medio |
|---|---|---|---|---|---|
| voto | (a) constante | — | 2017, 2018, 2019, 2022 | 0.444 (±0.120) | 0.312 (±0.009) |
| voto | (b) historial | α=3000 | 2017, 2018, 2019, 2022 | 0.444 (±0.115) | 0.312 (±0.009) |
| voto | (b) historial + prior bloque/signo | α=300 | 2017, 2018, 2019, 2022 | 0.468 (±0.093) | 0.331 (±0.024) |
| voto | (c) logística sin bloque/signo | C=0.0003 | 2017, 2018, 2019, 2022 | 0.426 (±0.097) | 0.325 (±0.021) |
| voto | (c) logística con bloque/signo | C=0.003 | 2017, 2018, 2019, 2022 | 0.408 (±0.086) | 0.322 (±0.016) |
| presencia | (a) constante | — | 2017, 2018, 2019, 2020, 2021, 2022 | 0.460 (±0.128) | 0.454 (±0.032) |
| presencia | (b) historial | α=30 | 2017, 2018, 2019, 2020, 2021, 2022 | 0.421 (±0.148) | 0.492 (±0.012) |
| presencia | (b) historial + prior bloque/signo | α=100 | 2017, 2018, 2019, 2020, 2021, 2022 | 0.416 (±0.158) | 0.479 (±0.018) |
| presencia | (c) logística sin bloque/signo | C=0.0003 | 2017, 2018, 2019, 2020, 2021, 2022 | 0.431 (±0.130) | 0.489 (±0.007) |
| presencia | (c) logística con bloque/signo | C=0.001 | 2017, 2018, 2019, 2020, 2021, 2022 | 0.416 (±0.129) | 0.490 (±0.004) |

La logística sin bloque/signo y el historial con prior global eligen el máximo de regularización o suavizado de la grilla. No es un defecto de la grilla: esas features solas casi no informan y el óptimo tiende a la constante.

## 8. Preparación etapa 3 · ¿cuántas votaciones de train tienen autor cruzable?

Cruce de `proyectos_de_ley.AUTOR` (autor principal) contra mandatos vigentes en la fecha de publicación, por nombre normalizado y sin matching difuso. Los dudosos van a `derivados/02_autor_cruces_revision.csv`.

| estado | votaciones de train |
|---|---|
| NO_APLICA | 227 |
| SEGURO | 172 |
| DUDOSO | 1 |

NO_APLICA = expedientes del Senado (S), del Poder Ejecutivo (PE) o de Jefatura de Gabinete (JGM): el autor no es diputado. Ese origen es en sí mismo una feature de proyecto disponible antes de la sesión.

## 9. Conclusión y propuesta para la etapa 3

El techo de estos baselines viene de **no tener información del proyecto**. Para que la predicción cambie de una votación a otra hace falta al menos una variable de proyecto disponible antes de la sesión. En orden de costo:

1. **Origen del expediente** (D / S / PE / JGM) y, si es D, **signo del autor al momento de publicar** (oficialista / no oficialista), cruzando con el bloque del autor en esa fecha. Interactuado con el signo del diputado, permite aprender que "proyecto del Ejecutivo × oficialista ⇒ AFIRMATIVO".
2. **Es autor del proyecto** (172 de 400 votaciones de train con cruce seguro).
3. Similitud de texto (etapa 5).

**Elección provisoria, hecha con rolling origin y no con validación:**
- **Voto | presente → (c) logística con bloque/signo.** Gana en los 4 folds de train (log loss media 0,408 frente a 0,444 de la constante) y también en validación.
- **Presencia → (b) historial + prior bloque/signo.** Empata con (c) en rolling origin (0,416) y es más simple. En validación los dos quedan dentro del IC de (b) historial.
- **Ablación bloque/signo:** como *prior* fijo por bloque, en rolling origin **empeora** la predicción de voto frente a la constante en 3 de 4 folds (los bloques cambian de nombre y de composición entre períodos). Como *feature* de la logística, combinada con el historial, mejora en todos los folds. En presencia aporta poco.
