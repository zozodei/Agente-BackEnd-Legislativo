# Etapa 3 · Features de proyecto (validación 2023–2024)

Generado por `scripts/03a_proyectos_features.py` + `scripts/03_proyecto.py` + `scripts/03_reporte.py`. **PRUEBA no se cargó ni se predijo**: la tabla de expedientes y el historial por tema sólo usan votaciones anteriores a 2025, y un test lo verifica. Tests: `pytest tests` → 24 pasan (13 de la etapa 2 + 11 nuevos de fuga en features de proyecto).

> Experimental: validación = 25 votaciones generales en 6 sesiones. Los IC son amplios. **La selección se hizo con rolling origin dentro de train**; validación sólo se reporta.

## Resumen

1. **Ahora el modelo sí distingue proyectos dentro de una sesión.** El desvío de los negativos esperados entre votaciones de una misma sesión pasa de 0 (referencia) a ≈ 13–17. La correlación de Spearman entre negativos esperados (Σp) y reales sube de 0,01 a **0,45 [0,22; 0,85]** con todas las features de proyecto. El error en negativos Σp baja de 41,1 a **32,6** por votación.
2. **En log loss por diputado la mejora es chica y está dentro del IC:** 0,505 → 0,494 con todas las features. En rolling origin, en cambio, la mejora es consistente: 0,408 → 0,390–0,396, mejor en 3 o 4 de los 4 folds.
3. **El F1 macro sube de 0,32 a 0,42 sin class weights.** El modelo ahora predice NEGATIVO cuando corresponde (269 aciertos contra 52). ABSTENCION todavía nunca sale por argmax.
4. **Lo que más aporta es el tema**, tanto como categoría como en forma de historial del diputado en ese tema. Origen y signo del autor solos empeoran en rolling origin. "Es autor" no mueve nada: hay 148 filas SI en train y 6 en validación.
5. **Rolling origin elige "(c) ref + sólo tema" (C=0.003).** En validación ese modelo queda por detrás de "todas las features" en casi todas las métricas. No lo cambio mirando validación: lo dejo anotado (§10).

## 1. Qué campos de tipo/tema trae el dataset (7a)

| campo | ENTRENAMIENTO | VALIDACION |
|---|---|---|
| proyectos_de_ley.TIPO (tipo de norma) | 100% | 100% |
| proyectos_de_ley.TITULO | 100% | 100% |
| documentos_proyectos.tipo_proyecto_ficha | 44% | 0% |
| documentos_proyectos.sumario_ficha | 44% | 0% |
| documentos_proyectos.firmantes_ficha | 44% | 0% |
| votaciones.nombre_ley_derivado | 100% | 100% |
| votaciones.palabras_clave_derivadas | 84% | 88% |
| comisión de giro / cabecera | no existe en el dataset | no existe en el dataset |

- **Uso:** `TIPO` (tipo de norma) y `TITULO`, fijos desde la presentación y con cobertura completa.
- **Descartados:**
  - **Ficha** (`sumario`, `firmantes`, `tipo_proyecto_ficha`): tiene 0% de cobertura en validación. Además, los firmantes son firmas y quedan fuera por decisión previa.
  - **`nombre_ley_derivado` y `palabras_clave_derivadas`:** provienen de ¿Cómo Votó?, se generaron en parte con IA y a partir de la votación ya ocurrida. No son campos fijos desde la presentación y podrían filtrar información posterior.
  - **Comisión de giro o cabecera:** no existe en el dataset.

**Tema asignado:** lista cerrada de 14 categorías más OTROS (`src/poroteo/temas.py`), con reglas regex sobre el título.
- Escribí las reglas mirando sólo títulos de ENTRENAMIENTO.
- Se aplican igual al `titulo` de un poroteo nuevo de la app.
- No se usó LLM.
- OTROS queda en el 6% de train (24 de 400) y en 2 de 25 en validación.
- **Archivo:** `derivados/proyectos_features.csv`, con 1.741 expedientes, una fila por expediente y sólo campos fijos.

Distribución de temas:

| split | tema | votaciones generales |
|---|---|---|
| ENTRENAMIENTO | ECONOMIA_IMPUESTOS_FINANZAS | 52 |
| ENTRENAMIENTO | JUSTICIA_SEGURIDAD | 52 |
| ENTRENAMIENTO | RELACIONES_EXTERIORES_DEFENSA | 46 |
| ENTRENAMIENTO | CONMEMORATIVO_SIMBOLICO | 37 |
| ENTRENAMIENTO | TRABAJO_PREVISION | 33 |
| ENTRENAMIENTO | PRODUCCION_COMERCIO_CONSUMO | 29 |
| ENTRENAMIENTO | ENERGIA_AMBIENTE_TRANSPORTE | 25 |
| ENTRENAMIENTO | OTROS | 24 |
| ENTRENAMIENTO | SALUD_DESARROLLO_SOCIAL | 23 |
| ENTRENAMIENTO | EDUCACION_CIENCIA | 22 |
| ENTRENAMIENTO | DERECHOS_HUMANOS_GENERO | 15 |
| ENTRENAMIENTO | PRESUPUESTO_CUENTAS | 12 |
| ENTRENAMIENTO | DEPORTE_CULTURA | 11 |
| ENTRENAMIENTO | INSTITUCIONAL_ELECTORAL | 11 |
| ENTRENAMIENTO | EXPROPIACION_INMUEBLES_TERRITORIO | 8 |
| VALIDACION | ECONOMIA_IMPUESTOS_FINANZAS | 4 |
| VALIDACION | EDUCACION_CIENCIA | 4 |
| VALIDACION | RELACIONES_EXTERIORES_DEFENSA | 3 |
| VALIDACION | TRABAJO_PREVISION | 2 |
| VALIDACION | JUSTICIA_SEGURIDAD | 2 |
| VALIDACION | SALUD_DESARROLLO_SOCIAL | 2 |
| VALIDACION | OTROS | 2 |
| VALIDACION | CONMEMORATIVO_SIMBOLICO | 2 |
| VALIDACION | ENERGIA_AMBIENTE_TRANSPORTE | 1 |
| VALIDACION | INSTITUCIONAL_ELECTORAL | 1 |
| VALIDACION | PRODUCCION_COMERCIO_CONSUMO | 1 |
| VALIDACION | DEPORTE_CULTURA | 1 |

## 2. Features de proyecto construidas

| Grupo | Variables | Por qué está disponible antes de la sesión |
|---|---|---|
| origen | `origen_expediente` (D/S/PE/JGM), `origen_autor` (DIPUTADO/SENADOR/EJECUTIVO/COMISION) | Número y tipo del expediente, más el `TIPO` de norma, fijos desde la presentación. **Hallazgo:** 99 de los 183 expedientes "S" de train son *mensajes del Ejecutivo* que entraron por el Senado (`TIPO = MENSAJE Y PROYECTO DE LEY`). Los cuento como EJECUTIVO. |
| signo_autor | signo del bloque del autor (si es diputado) con el gobierno vigente en la fecha de publicación | Intervalo de bloque vigente en `PUBLICACION_FECHA` (siempre ≤ D-1) y regla documental con fecha < sesión |
| alineacion | EJECUTIVO_VIGENTE / **EJECUTIVO_ANTERIOR** / DIPUTADO_{OFICIALISMO, NO_OFICIALISTA, NO_VERIFICADO} / SENADOR / COMISION | Gobierno de la publicación contra gobierno vigente en D-1. Los mensajes de un gobierno anterior quedan separados: en validación hay 677 filas de EJECUTIVO_ANTERIOR, en su mayoría proyectos de AF votados con Milei. |
| inter_signo | alineación × signo del diputado al inicio | Combinación de las dos anteriores |
| inter_bloque | alineación × bloque del diputado; mismo bloque / misma familia que el autor | Ídem |
| es_autor | SI / NO / DESCONOCIDO | Cruce SEGURO del autor. Los DUDOSOS quedan DESCONOCIDO, no 0, y van a `derivados/03_autor_cruces_revision.csv` (12) |
| tema | tema, tema × signo del diputado | Reglas sobre el título |
| hist_tema | proporción A/N/Abs del diputado en votaciones previas del mismo tema, suavizada hacia su historial general (β=10), y log(n) | Votos elegibles con los mismos criterios que `prev_*` y `fecha_local` < límite predictivo de la sesión. El test lo recalcula por fuerza bruta. |

- **Proyectos presentados después de D-1:** son 3 votaciones de presencia en train, como un desafuero sobre tablas. Todas sus features de proyecto quedan DESCONOCIDO, sin rellenar. Ninguna votación general está en ese caso: la publicación es siempre al menos 2 días antes de la sesión.
- **Agrupaciones más estables que el nombre del bloque (punto 2):**
  - **`familia_politica_literal`** (documentada y estática por bloque) une variantes de nombre: PRO / UNION PRO / PROPUESTA REPUBLICANA, las de UCR y las de CC. Los bloques SIN_AGRUPAR quedan como su propia familia. FPV, FdT y UxP son familias distintas en el dataset y no inventé una agrupación "peronismo".
  - **Interbloque:** sale de `bloque_interbloque_historico` cuando D-1 cae en el período documentado, que va de 2018-03 a 2023-12.

Origen del autor en las votaciones generales:

| split | origen_autor | votaciones generales |
|---|---|---|
| ENTRENAMIENTO | DIPUTADO | 173 |
| ENTRENAMIENTO | EJECUTIVO | 154 |
| ENTRENAMIENTO | SENADOR | 68 |
| ENTRENAMIENTO | COMISION | 5 |
| VALIDACION | EJECUTIVO | 12 |
| VALIDACION | DIPUTADO | 8 |
| VALIDACION | SENADOR | 5 |

## 3. Tabla comparativa principal · historial móvil · IC95 por sesión

- **B** = voto | presente.
- **A** = presencia.
- **A×B** = combinado de 4 clases.
- **Vot** = por votación contra los totales oficiales.
- **Σp** = conteo esperado (suma de probabilidades); **argmax** = como lo muestra hoy la app.
- **Spearman** = correlación de rangos entre conteo esperado y oficial en las 25 votaciones.
- **Desvío intra-sesión Σneg** = desvío medio de los negativos esperados entre votaciones de la misma sesión.

La referencia usa la presencia de la etapa 2. Las demás filas usan la presencia elegida en rolling origin (§7).

| modelo | presencia | B · log loss | B · F1 macro | B · Brier | A · log loss | A×B · log loss | A×B · F1 (4 cl.) | Vot · EA afirm. Σp | Vot · EA neg. Σp | Vot · EA neg. argmax | Spearman afirm. Σp | Spearman neg. Σp | desvío intra-sesión Σneg | acierto resultado |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| (c) logística con bloque/signo [ref. etapa 2] | (b) historial+prior | 0.505 [0.408, 0.597] | 0.322 [0.290, 0.352] | 0.304 [0.233, 0.375] | 0.373 [0.302, 0.481] | 0.844 [0.786, 0.884] | 0.243 [0.223, 0.257] | 35.2 [26.1, 45.9] | 41.1 [35.7, 47.4] | 36.3 [19.2, 55.1] | -0.40 [-0.60, 0.19] | 0.01 [-0.37, 0.58] | 0.0 | 1.00 [1.00, 1.00] |
| (d) todas las features de proyecto | logística + proyecto | 0.494 [0.356, 0.630] | 0.419 [0.363, 0.487] | 0.282 [0.190, 0.376] | 0.372 [0.292, 0.474] | 0.837 [0.771, 0.908] | 0.314 [0.277, 0.348] | 32.8 [25.5, 41.8] | 32.6 [23.9, 44.0] | 25.8 [11.3, 41.0] | 0.18 [-0.27, 0.56] | 0.45 [0.22, 0.85] | 17.1 | 0.96 [0.89, 1.00] |
| (c) ref + sólo tema | logística + proyecto | 0.509 [0.367, 0.638] | 0.389 [0.348, 0.449] | 0.302 [0.212, 0.391] | 0.372 [0.292, 0.474] | 0.850 [0.768, 0.917] | 0.300 [0.274, 0.334] | 38.3 [28.2, 50.6] | 35.2 [26.6, 43.9] | 32.9 [17.4, 46.1] | -0.08 [-0.49, 0.42] | 0.31 [0.01, 0.77] | 13.0 | 0.96 [0.80, 1.00] |
| (c) con familia en lugar de bloque | logística + proyecto | 0.492 [0.408, 0.569] | 0.331 [0.291, 0.369] | 0.293 [0.231, 0.352] | 0.372 [0.292, 0.474] | 0.836 [0.787, 0.870] | 0.265 [0.248, 0.281] | 37.9 [27.7, 48.2] | 40.4 [34.4, 47.6] | 36.6 [19.5, 56.6] | -0.50 [-0.66, 0.03] | 0.38 [-0.07, 0.82] | 2.3 | 1.00 [1.00, 1.00] |
| (c) con bloque + interbloque | logística + proyecto | 0.516 [0.408, 0.616] | 0.323 [0.289, 0.354] | 0.313 [0.234, 0.393] | 0.372 [0.292, 0.474] | 0.856 [0.802, 0.904] | 0.253 [0.239, 0.265] | 39.2 [28.4, 50.2] | 39.0 [31.0, 47.9] | 35.8 [18.8, 54.9] | -0.48 [-0.65, 0.03] | 0.36 [-0.07, 0.82] | 2.1 | 1.00 [1.00, 1.00] |

- **Acierto de resultado de 0,96:** es 1 votación de 25 que pasa a predecirse RECHAZADA. Sigue sin discriminar.
- **Spearman negativo de afirmativos en la referencia:** sin información de proyecto, el número de afirmativos predicho sólo sigue la presencia de la sesión. Las votaciones con muchos afirmativos reales son las consensuadas, y en esas no hay más presentes.

## 4. Ablación · rolling origin (selección) y validación (sólo reporte)

- **"todas menos g"** muestra lo que se pierde al sacar el grupo g.
- **"ref + sólo g"** muestra lo que aporta el grupo g solo.
- **Folds mejor que ref:** en cuántos de los 4 folds (2017, 2018, 2019, 2022) la variante tiene menor log loss que la referencia.

| variante | C (RO) | RO · log loss medio | RO · folds mejor que ref | Val · B log loss | Val · B F1 macro | Val · EA neg. Σp | Val · Spearman neg. Σp |
|---|---|---|---|---|---|---|---|
| (c) logística con bloque/signo [ref. etapa 2] | 0.003 | 0.4079 | 0/4 | 0.505 [0.408, 0.597] | 0.322 [0.290, 0.352] | 41.1 | 0.01 |
| (c) con familia en lugar de bloque | 0.003 | 0.4074 | 4/4 | 0.492 [0.408, 0.569] | 0.331 [0.291, 0.369] | 40.4 | 0.38 |
| (c) con bloque + interbloque | 0.003 | 0.4056 | 4/4 | 0.516 [0.408, 0.616] | 0.323 [0.289, 0.354] | 39.0 | 0.36 |
| (d) todas las features de proyecto | 0.001 | 0.3959 | 3/4 | 0.494 [0.356, 0.630] | 0.419 [0.363, 0.487] | 32.6 | 0.45 |
| (d) todas, con familia en lugar de bloque | 0.003 | 0.3957 | 3/4 | 0.486 [0.334, 0.649] | 0.467 [0.404, 0.531] | 31.2 | 0.42 |
| (d) todas menos origen | 0.001 | 0.3921 | 3/4 | 0.489 [0.352, 0.622] | 0.424 [0.371, 0.489] | 32.6 | 0.45 |
| (c) ref + sólo origen | 0.0003 | 0.4155 | 2/4 | 0.540 [0.417, 0.662] | 0.315 [0.286, 0.352] | 39.3 | 0.39 |
| (d) todas menos signo_autor | 0.001 | 0.3950 | 3/4 | 0.492 [0.354, 0.627] | 0.420 [0.363, 0.488] | 32.5 | 0.45 |
| (c) ref + sólo signo_autor | 0.0003 | 0.4162 | 1/4 | 0.546 [0.433, 0.664] | 0.301 [0.279, 0.325] | 40.8 | 0.38 |
| (d) todas menos alineacion | 0.001 | 0.3959 | 3/4 | 0.498 [0.359, 0.634] | 0.410 [0.356, 0.476] | 33.2 | 0.45 |
| (c) ref + sólo alineacion | 0.001 | 0.4089 | 3/4 | 0.506 [0.400, 0.620] | 0.365 [0.314, 0.408] | 36.6 | 0.44 |
| (d) todas menos inter_signo | 0.001 | 0.3998 | 3/4 | 0.503 [0.362, 0.640] | 0.399 [0.335, 0.470] | 33.2 | 0.44 |
| (c) ref + sólo inter_signo | 0.001 | 0.4016 | 3/4 | 0.496 [0.395, 0.602] | 0.362 [0.313, 0.402] | 37.0 | 0.44 |
| (d) todas menos inter_bloque | 0.001 | 0.3991 | 3/4 | 0.498 [0.358, 0.639] | 0.409 [0.351, 0.478] | 32.6 | 0.45 |
| (c) ref + sólo inter_bloque | 0.003 | 0.3998 | 4/4 | 0.506 [0.405, 0.595] | 0.334 [0.305, 0.362] | 39.7 | 0.30 |
| (d) todas menos es_autor | 0.003 | 0.3957 | 3/4 | 0.501 [0.347, 0.677] | 0.462 [0.401, 0.523] | 30.9 | 0.40 |
| (c) ref + sólo es_autor | 0.003 | 0.4079 | 2/4 | 0.505 [0.408, 0.596] | 0.322 [0.290, 0.351] | 40.2 | 0.37 |
| (d) todas menos tema | 0.003 | 0.4006 | 3/4 | 0.471 [0.364, 0.588] | 0.441 [0.387, 0.486] | 32.9 | 0.52 |
| (c) ref + sólo tema | 0.003 | 0.3898 | 4/4 | 0.509 [0.367, 0.638] | 0.389 [0.348, 0.449] | 35.2 | 0.31 |
| (d) todas menos hist_tema | 0.003 | 0.3973 | 3/4 | 0.510 [0.349, 0.688] | 0.463 [0.402, 0.524] | 31.1 | 0.40 |
| (c) ref + sólo hist_tema | 0.003 | 0.3942 | 4/4 | 0.478 [0.387, 0.573] | 0.392 [0.323, 0.446] | 38.0 | 0.53 |

Lectura:
- **Tema e historial por tema** son los únicos grupos que solos ganan en los 4 folds.
- **Origen y signo del autor solos** empeoran: el modelo los usa mal sin interacción con el diputado. En la variante completa, sacar el origen incluso mejora en rolling origin, porque la alineación ya contiene esa información.
- **Las interacciones** (inter_signo, inter_bloque) aportan más que sus partes.
- **es_autor** es neutro.
- **Familia en lugar de bloque** gana en los 4 folds, pero por milésimas (0,4079 → 0,4074). **Interbloque**, igual (0,4056), y en validación empeora. No justifican cambiar la agrupación por ahora.

## 5. ¿Distingue proyectos? Consensuadas contra divididas (punto 3)

- **Corte pedido (margen < 30):** deja sólo 2 votaciones divididas en validación.
- **Corte de sensibilidad (margen < 100):** deja 10 divididas y 15 consensuadas.

| modelo | estrato (margen oficial |A−N|) | votaciones | EA afirm. Σp | EA neg. Σp | EA afirm. argmax | EA neg. argmax |
|---|---|---|---|---|---|---|
| (c) logística con bloque/signo [ref. etapa 2] | dividida < 30 | 2 | 45.4 [33.7, 57.0] | 68.8 [63.5, 74.1] | 113.0 [102.0, 124.0] | 100.5 [95.0, 106.0] |
| (c) logística con bloque/signo [ref. etapa 2] | consensuada ≥ 30 | 23 | 34.3 [23.2, 47.2] | 38.7 [31.9, 45.1] | 61.4 [41.4, 80.2] | 30.7 [8.0, 52.4] |
| (c) logística con bloque/signo [ref. etapa 2] | dividida < 100 | 10 | 28.2 [15.0, 40.3] | 48.9 [31.8, 66.6] | 90.8 [74.9, 106.0] | 80.1 [63.3, 98.6] |
| (c) logística con bloque/signo [ref. etapa 2] | consensuada ≥ 100 | 15 | 39.9 [18.9, 72.6] | 36.0 [29.7, 48.1] | 48.7 [21.5, 68.9] | 7.1 [1.4, 18.4] |
| (d) todas las features de proyecto | dividida < 30 | 2 | 40.5 [40.4, 40.6] | 60.9 [33.4, 88.4] | 70.5 [37.0, 104.0] | 56.0 [5.0, 107.0] |
| (d) todas las features de proyecto | consensuada ≥ 30 | 23 | 32.2 [23.2, 41.8] | 30.1 [21.5, 40.8] | 48.4 [26.7, 64.7] | 23.1 [7.1, 36.2] |
| (d) todas las features de proyecto | dividida < 100 | 10 | 33.9 [28.0, 39.2] | 45.7 [22.4, 66.4] | 63.5 [35.0, 81.7] | 52.4 [24.3, 67.7] |
| (d) todas las features de proyecto | consensuada ≥ 100 | 15 | 32.2 [18.2, 53.5] | 23.8 [20.5, 27.3] | 41.3 [21.1, 58.3] | 8.0 [1.9, 15.8] |
| (c) ref + sólo tema | dividida < 30 | 2 | 43.5 [37.2, 49.9] | 64.8 [44.8, 84.7] | 83.5 [63.0, 104.0] | 69.0 [31.0, 107.0] |
| (c) ref + sólo tema | consensuada ≥ 30 | 23 | 37.9 [25.5, 51.0] | 32.6 [20.3, 41.1] | 59.1 [42.2, 73.4] | 29.8 [10.8, 43.1] |
| (c) ref + sólo tema | dividida < 100 | 10 | 36.2 [28.8, 44.9] | 47.1 [22.7, 67.1] | 73.2 [53.2, 89.2] | 60.9 [39.0, 76.6] |
| (c) ref + sólo tema | consensuada ≥ 100 | 15 | 39.8 [21.2, 70.7] | 27.3 [17.3, 42.2] | 53.0 [40.4, 65.3] | 14.3 [1.3, 26.6] |

La mejora en negativos Σp viene sobre todo de las **consensuadas**: 36,0 → 23,8 en margen ≥ 100. Ahí el modelo ahora sabe que no hay oposición. En las **divididas** el error sigue alto, alrededor de 46–49. Saber *cuántos* de un bloque se van a oponer sigue siendo el problema abierto.

## 6. Con y sin historial

Móvil (sólo 34 filas sin historial; IC poco informativo):

| modelo | subgrupo | n filas | log loss | F1 macro | Brier |
|---|---|---|---|---|---|
| (c) logística con bloque/signo [ref. etapa 2] | con_historial | 5048 | 0.502 [0.408, 0.591] | 0.323 [0.292, 0.352] | 0.302 [0.232, 0.373] |
| (c) logística con bloque/signo [ref. etapa 2] | sin_historial | 34 | 1.013 [0.334, 1.265] | 0.222 [0.167, 1.000] | 0.636 [0.138, 0.809] |
| (d) todas las features de proyecto | con_historial | 5048 | 0.488 [0.354, 0.620] | 0.421 [0.366, 0.488] | 0.279 [0.190, 0.372] |
| (d) todas las features de proyecto | sin_historial | 34 | 1.307 [0.300, 1.675] | 0.222 [0.167, 1.000] | 0.729 [0.148, 0.933] |
| (c) ref + sólo tema | con_historial | 5048 | 0.504 [0.367, 0.625] | 0.391 [0.349, 0.450] | 0.299 [0.210, 0.385] |
| (c) ref + sólo tema | sin_historial | 34 | 1.254 [0.324, 1.603] | 0.222 [0.167, 1.000] | 0.736 [0.146, 0.945] |

Congelado al 2023-01-01 (arranque en frío: 680 filas sin historial):

| modelo | subgrupo | n filas | log loss | F1 macro | Brier |
|---|---|---|---|---|---|
| (c) logística con bloque/signo [ref. etapa 2] | con_historial | 4402 | 0.511 [0.405, 0.633] | 0.304 [0.280, 0.332] | 0.309 [0.231, 0.408] |
| (c) logística con bloque/signo [ref. etapa 2] | sin_historial | 680 | 0.413 [0.372, 0.842] | 0.303 [0.244, 0.433] | 0.232 [0.201, 0.527] |
| (d) todas las features de proyecto | con_historial | 4402 | 0.504 [0.355, 0.646] | 0.396 [0.321, 0.477] | 0.289 [0.190, 0.396] |
| (d) todas las features de proyecto | sin_historial | 680 | 0.391 [0.330, 1.072] | 0.478 [0.244, 0.890] | 0.209 [0.171, 0.589] |
| (c) ref + sólo tema | con_historial | 4402 | 0.515 [0.363, 0.658] | 0.387 [0.322, 0.467] | 0.307 [0.205, 0.420] |
| (c) ref + sólo tema | sin_historial | 680 | 0.407 [0.351, 1.027] | 0.455 [0.244, 0.791] | 0.226 [0.192, 0.596] |

Historial congelado, tabla completa:

| modelo | presencia | B · log loss | B · F1 macro | B · Brier | A · log loss | A×B · log loss | A×B · F1 (4 cl.) | Vot · EA afirm. Σp | Vot · EA neg. Σp | Vot · EA neg. argmax | Spearman afirm. Σp | Spearman neg. Σp | desvío intra-sesión Σneg | acierto resultado |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| (c) logística con bloque/signo [ref. etapa 2] | (b) historial+prior | 0.498 [0.406, 0.583] | 0.305 [0.285, 0.329] | 0.299 [0.232, 0.364] | 0.384 [0.313, 0.486] | 0.845 [0.786, 0.884] | 0.223 [0.217, 0.234] | 34.4 [25.9, 43.8] | 41.1 [35.6, 47.3] | 36.4 [19.3, 55.2] | -0.37 [-0.58, 0.31] | -0.11 [-0.48, 0.40] | 0.0 | 1.00 [1.00, 1.00] |
| (d) todas las features de proyecto | logística + proyecto | 0.489 [0.354, 0.618] | 0.406 [0.354, 0.481] | 0.278 [0.189, 0.370] | 0.398 [0.320, 0.496] | 0.848 [0.774, 0.915] | 0.304 [0.261, 0.347] | 33.3 [25.4, 43.2] | 32.9 [24.4, 44.1] | 26.0 [11.1, 41.6] | 0.12 [-0.24, 0.54] | 0.49 [0.23, 0.85] | 16.6 | 1.00 [1.00, 1.00] |
| (c) ref + sólo tema | logística + proyecto | 0.500 [0.363, 0.623] | 0.396 [0.339, 0.471] | 0.296 [0.206, 0.377] | 0.398 [0.320, 0.496] | 0.858 [0.769, 0.925] | 0.297 [0.254, 0.346] | 38.2 [28.0, 50.4] | 35.4 [26.9, 43.9] | 32.7 [18.0, 45.7] | -0.09 [-0.49, 0.42] | 0.38 [0.12, 0.78] | 12.7 | 0.96 [0.80, 1.00] |

## 7. Presencia

| modelo | hiperparámetro | RO · log loss medio | Val · log loss | Val · Brier | Val · F1 macro |
|---|---|---|---|---|---|
| (b) historial + prior bloque/signo [etapa 2] | 100 | 0.4161 | 0.373 [0.302, 0.481] | 0.219 [0.158, 0.306] | 0.492 [0.465, 0.513] |
| logística bloque/signo + origen, alineación, inter_signo, tema | 0.001 | 0.4064 | 0.372 [0.292, 0.474] | 0.219 [0.154, 0.303] | 0.501 [0.472, 0.527] |

En rolling origin, la logística con bloque/signo y features de proyecto le gana al historial con prior (0,406 frente a 0,416). En validación empatan. La elijo por rolling origin para el combinado.

## 8. Rolling origin por fold (voto, con el C elegido para cada variante)

| variante | 2017 | 2018 | 2019 | 2022 | media |
|---|---|---|---|---|---|
| (c) logística con bloque/signo [ref. etapa 2] | 0.4142 | 0.4524 | 0.2856 | 0.4794 | 0.4079 |
| (c) con familia en lugar de bloque | 0.4141 | 0.4512 | 0.2849 | 0.4793 | 0.4074 |
| (c) con bloque + interbloque | 0.414 | 0.452 | 0.2785 | 0.4778 | 0.4056 |
| (d) todas las features de proyecto | 0.4006 | 0.4698 | 0.2679 | 0.4451 | 0.3959 |
| (d) todas, con familia en lugar de bloque | 0.3985 | 0.4597 | 0.2751 | 0.4497 | 0.3957 |
| (d) todas menos origen | 0.3994 | 0.4645 | 0.2635 | 0.4408 | 0.3921 |
| (c) ref + sólo origen | 0.4113 | 0.497 | 0.2646 | 0.4889 | 0.4155 |
| (d) todas menos signo_autor | 0.3996 | 0.4679 | 0.2672 | 0.4455 | 0.395 |
| (c) ref + sólo signo_autor | 0.4171 | 0.493 | 0.264 | 0.4907 | 0.4162 |
| (d) todas menos alineacion | 0.402 | 0.469 | 0.2637 | 0.4491 | 0.3959 |
| (c) ref + sólo alineacion | 0.406 | 0.4776 | 0.2788 | 0.473 | 0.4089 |
| (d) todas menos inter_signo | 0.4047 | 0.474 | 0.268 | 0.4524 | 0.3998 |
| (c) ref + sólo inter_signo | 0.4018 | 0.4666 | 0.2746 | 0.4635 | 0.4016 |
| (d) todas menos inter_bloque | 0.4019 | 0.4763 | 0.2734 | 0.4448 | 0.3991 |
| (c) ref + sólo inter_bloque | 0.4088 | 0.4431 | 0.276 | 0.4712 | 0.3998 |
| (d) todas menos es_autor | 0.3994 | 0.4603 | 0.2745 | 0.4485 | 0.3957 |
| (c) ref + sólo es_autor | 0.414 | 0.4521 | 0.2859 | 0.4795 | 0.4079 |
| (d) todas menos tema | 0.4107 | 0.4588 | 0.2659 | 0.4672 | 0.4006 |
| (c) ref + sólo tema | 0.4049 | 0.4333 | 0.2608 | 0.4602 | 0.3898 |
| (d) todas menos hist_tema | 0.3992 | 0.4633 | 0.2765 | 0.4501 | 0.3973 |
| (c) ref + sólo hist_tema | 0.4074 | 0.4425 | 0.2716 | 0.4554 | 0.3942 |

## 9. Matrices de confusión (B, móvil, validación)

**(c) logística con bloque/signo [ref. etapa 2]**

| real | pred AFIRM | pred NEG | pred ABST |
|---|---|---|---|
| AFIRM | 3865 | 123 | 0 |
| NEG | 842 | 52 | 0 |
| ABST | 198 | 2 | 0 |

**(d) todas las features de proyecto**

| real | pred AFIRM | pred NEG | pred ABST |
|---|---|---|---|
| AFIRM | 3774 | 214 | 0 |
| NEG | 625 | 269 | 0 |
| ABST | 130 | 70 | 0 |

**(c) ref + sólo tema**

| real | pred AFIRM | pred NEG | pred ABST |
|---|---|---|---|
| AFIRM | 3686 | 302 | 0 |
| NEG | 674 | 220 | 0 |
| ABST | 156 | 44 | 0 |

## 10. Conclusión y elección provisoria

- **Elección por rolling origin:**
  - **Voto | presente → (c) ref + sólo tema, C=0.003.** Rolling origin medio 0,390, frente a 0,408 de la referencia.
  - **Presencia → logística + proyecto.**
- **Diferencia con validación:** en validación, "todas las features" (y "ref + sólo hist_tema") quedan mejor que la elegida en Spearman y en error de negativos. **No cambio la elección mirando validación.** Las diferencias entre las mejores variantes en rolling origin (0,390–0,396) son chicas frente a la variación entre folds. Propongo que la etapa 4 (LightGBM) parta del conjunto completo de features de proyecto y deje que rolling origin decida.
- **Producción:** ninguna de estas features usa firmas. Todas se pueden calcular para un proyecto nuevo de la app con su título y su autor. El autor hoy es texto libre: hace falta que la app identifique al autor (diputado, PE, senador) para tener origen y alineación. Sin eso, sólo queda el tema.

### Notas para la etapa 4

- Calibración (isotónica o Platt dentro de rolling origin) y curva de calibración. Si hace falta, umbral de decisión sobre probabilidades **calibradas**, para que NEGATIVO y ABSTENCION aparezcan sin usar class weights.
- Exponer en la app el **conteo esperado con intervalo** (por simulación de las probabilidades) además del voto por diputado. Σp es mejor que argmax en todas las variantes.
- Revisar las votaciones divididas: interacción tema × bloque e historial del bloque en el tema.
