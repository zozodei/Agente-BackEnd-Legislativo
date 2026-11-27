# Etapa 4c · Alineación reciente v2 (corte por gobierno, dirección y protocolo)

Generado por `scripts/04c_reporte.py` sobre los derivados de `scripts/04_modelos.py` (corrida del 27/11/2026).
**PRUEBA no se cargó ni se predijo.** Validación 2023–2024, historial móvil, 25 votaciones. Rolling origin: 115 votaciones OOF de ENTRENAMIENTO.

## 0 · Qué cambió respecto de 4b

1. **Corte por gobierno.** La ventana de 180 días de `alin_rec` no arranca antes de la asunción del gobierno vigente en el límite (`gobiernos_historicos`: Milei desde 10/12/2023). Sin votos en la ventana, el valor vale 0,5. Se cambiaron 557 de 77 200 filas. Afecta sólo a sesiones de principios de 2024 en las que la ventana de 180 días cruzaba el cambio de gobierno.
2. **Dirección.** Confirmado: en 4b `alin_rec` **no estaba cruzada** con el signo del proyecto. Entraba como efecto principal y una logística no puede aprender que pesa distinto en proyectos del oficialismo que en los de la oposición. Se agregaron `alin_x_ofic` (EJECUTIVO_VIGENTE, DIPUTADO_OFICIALISMO), `alin_x_opos` (DIPUTADO_NO_OFICIALISTA) y `alin_x_ejec_ant` (EJECUTIVO_ANTERIOR), con la alineación centrada en 0,5. Los proyectos sin dirección documentada (NO_VERIFICADO, SENADOR, COMISION) quedan sin interacción.
3. **Protocolo.** Intervalos bootstrap del 90 % por votación (1000 remuestreos), comparación pareada contra `solo_tema` y promedio de rolling origin + validación.
4. **Metas.** Se quitó el Brier de P(aprobación). Se agregó el error absoluto en el margen (afirmativos − negativos con Σp), total y en divididas.
5. **Votación dividida.** Ver §6: no encuentro en el repo un modelo de votación dividida ni una alerta; no hay nada que sacar.
6. **F1 macro con umbral.** Calculado para todas las variantes (ver §2).

## 1 · Valor de `alin_rec` en Ley Bases y armas (PRO y UCR)

Antes = regla de HEAD (sin corte). Después = 4c. Valores de `alin_rec` en la fecha de la votación, con el número de votaciones en la ventana.

| votación | bloque | antes | después | ventana |
|---|---|---|---|---|
| Ley Bases (HCDN_ACTA_5101, límite 2024-02-02) | PRO | 0,367 (n=10) | 0,583 (n=1) | desde 2023-12-10 |
| Ley Bases | UCR | 0,583 (n=1) | 0,583 (n=1) | sin cambio |
| armas (HCDN_ACTA_5385, límite 2024-10-01) | PRO | 0,891 (n=18) | 0,891 (n=18) | desde 2024-04-04, sin cambio |
| armas | UCR | 0,386 (n=17) | 0,386 (n=17) | desde 2024-04-04, sin cambio |

Con n=1 el valor es 0,583 y no 0,5: el suavizado α = 5 es parcial por diseño. Si se quiere que con pocas votaciones quede exactamente en 0,5 hace falta un mínimo de votos. Está pendiente tu decisión.

## 2 · Tabla de validación con intervalos (bootstrap 90 %, por votación)

| variante | Log loss voto (B) | EA neg. Σp total | EA neg. Σp divididas | EA margen Σp total | EA margen Σp divididas | F1 macro con umbral |
|---|---|---|---|---|---|---|
| solo_tema (base) | 0,502 [0,403; 0,598] | 34,8 [27,4; 42,6] | 49,9 [37,9; 61,4] | 59,3 [41,7; 77,5] | 74,3 [49,2; 99,1] | 0,450 [0,386; 0,504] |
| solo_tema_alin | 0,515 [0,409; 0,615] | 35,0 [26,6; 43,2] | 49,9 [36,1; 63,9] | 64,2 [46,9; 84,4] | 81,3 [52,7; 108,6] | 0,423 [0,340; 0,507] |
| con_autor | 0,501 [0,390; 0,614] | 31,2 [23,6; 39,6] | 46,0 [30,7; 61,5] | 54,5 [40,7; 68,5] | 81,6 [60,6; 103,0] | 0,496 [0,423; 0,554] |
| con_autor_alin | 0,545 [0,415; 0,674] | 32,6 [23,5; 42,6] | 61,6 [46,3; 74,8] | 61,2 [47,3; 77,5] | 102,2 [79,7; 123,8] | 0,469 [0,386; 0,525] |

Notas de definición:
- Log loss: ponderado por fila, sobre la probabilidad condicional a estar presente (igual a la salida B calibrada). Intervalo por remuestreo de votaciones.
- EA = |Σp − total oficial| promediado por votación. Divididas = margen oficial < 100 (estrato de la etapa 4).
- F1 macro: tres clases, pesos de decisión de la etapa 4 (calibrados en OOF), recalculado desde las predicciones. Matrices de confusión por votación, remuestreadas.
- Con la misma definición, `solo_tema` reproduce el 4b (0,502; 34,8; 49,9; F1 0,450).

## 3 · Comparación pareada contra solo_tema

Diferencia = variante − solo_tema. Negativo es mejor en log loss y en error. Intervalo bootstrap 90 %, mismas votaciones remuestreadas.

**Validación (25 votaciones)**

| comparación | Log loss voto | EA neg. Σp total | EA margen total | F1 macro |
|---|---|---|---|---|
| solo_tema_alin − solo_tema | +0,012 [−0,019; +0,046] | +0,27 [−1,00; +1,56] | +4,9 [+1,6; +8,3] | −0,027 [−0,094; +0,046] |
| con_autor − solo_tema (referencia) | −0,001 [−0,038; +0,038] | −3,58 [−8,34; +0,84] | −4,8 [−13,4; +3,1] | +0,045 [+0,004; +0,085] |
| con_autor_alin − solo_tema | +0,043 [−0,027; +0,104] | −2,14 [−8,40; +3,77] | +1,9 [−9,5; +11,9] | +0,019 [−0,041; +0,084] |

**Rolling origin (promedio de los folds OOF, ENTRENAMIENTO)**

| comparación | Log loss voto (RO, por año) | EA neg. Σp total (OOF) | EA neg. Σp divididas (OOF) |
|---|---|---|---|
| solo_tema_alin − solo_tema | −0,001 [−0,007; +0,004] | +0,61 [+0,06; +1,17] | +0,58 [−0,72; +1,79] |
| con_autor_alin − solo_tema | +0,006 [−0,010; +0,027] | −2,35 [−4,25; −0,43] | +8,81 [+5,18; +12,63] |

Medias de rolling origin: EA neg. total: solo_tema 21,7; solo_tema_alin 22,3; con_autor_alin 19,3. EA neg. divididas: solo_tema 42,1; solo_tema_alin 42,7; con_autor_alin 50,9. Log loss RO (uncalibrado): solo_tema 0,388; solo_tema_alin 0,386; con_autor_alin 0,393.

## 4 · Regla de decisión

Regla: la alineación entra sólo si mejora el log loss de voto **y** el error en negativos, con una diferencia pareada cuyo intervalo no cruce cero en al menos uno de los dos, y sin empeorar el otro.

- **solo_tema_alin:** no mejora el log loss (+0,012) ni el error en negativos (+0,27). **Descartada.**
- **con_autor_alin:** mejora el error en negativos (−2,1 en validación, intervalo cruza cero; −2,3 en RO, intervalo excluye cero), pero **empeora el log loss de voto** (+0,043 en validación, +0,006 en RO). No cumple la regla. **Descartada.**

**Decisión: se descarta la alineación. Queda `solo_tema` como base**, igual que en 4b, aunque ahora por una razón distinta: con las interacciones el log loss de `con_autor_alin` empeora (0,499 en 4b → 0,545 en 4c). Las interacciones agregan varianza sin señal en 25 votaciones.

Fuera de la regla: `con_autor` (sin alineación) sí mejora F1 frente a `solo_tema` (+0,045, intervalo [+0,004; +0,085]), pero no mejora el error en negativos (intervalo cruza cero). Ésa es una decisión aparte.

## 5 · Ley Bases y armas (PRO y UCR, validación)

P(NEG) medio por bloque y resultado predicho (Σp, regla de la app). Resultado oficial: APROBADO en ambas.

| variante | Ley Bases PRO | Ley Bases UCR | Ley Bases resultado | armas PRO | armas UCR | armas resultado |
|---|---|---|---|---|---|---|
| solo_tema | 0,43 | 0,52 | APROBADO | 0,32 | 0,42 | APROBADO |
| solo_tema_alin | 0,38 | 0,49 | APROBADO | 0,22 | 0,44 | APROBADO |
| con_autor | 0,50 | 0,60 | RECHAZADO | 0,50 | 0,58 | RECHAZADO |
| con_autor_alin | 0,17 | 0,20 | APROBADO | 0,16 | 0,50 | APROBADO |

`con_autor_alin` acierta ambos resultados, pero el acierto no basta según la regla: su log loss empeora. Con `solo_tema` las dos votaciones ya dan APROBADO.

## 6 · Estado de las metas y puntos pendientes

- **Metas (Spearman, error en negativos, intervalos, Brier):** el Brier de P(aprobación) se quitó. En el dataset casi no hay rechazos (399 de 400 en ENTRENAMIENTO, 25 de 25 en VALIDACIÓN), así que la tasa base tiene Brier ≈ 0. Hace falta redefinir la meta antes de volver a usarla.
- **Error en el margen:** agregado (§2). Ninguna variante queda cerca de la meta en divididas.
- **Votación dividida:** no encontré en el repo un modelo de votación dividida ni una alerta. Lo único que existe son los estratos "divididas (<100)" y "divididas (<30)" de los reportes. El error en negativos en divididas queda entre 46 y 62 en todas las variantes, contra una meta de 30. Ésa es la razón por la que no hay nada que sacar: el problema sigue abierto, no hay un modelo que falle en validación.
- **F1 macro con umbral:** calculado (§2). La celda vacía de 4b no la diagnostiqué; 4c ya la tiene.

## 7 · Limitaciones

- 25 votaciones de validación. Los intervalos de 90 % son anchos (±10 en el error en negativos, ±0,1 en log loss). Diferencias de 0,01 en log loss no son distinguibles de cero.
- El log loss de rolling origin es uncalibrado y por año (sin datos por votación en los derivados). Por eso su intervalo se calculó sobre años, no votaciones.
- El corte por gobierno cambia poco los datos (557 filas). Su efecto principal es sobre sesiones de principios de 2024.
- El Ley Bases de la app depende de la fecha que el dataset asigna a ACTA_5101 (límite 2024-02-02).

## 8 · Para que decidas

1. ¿Confirmás descartar la alineación y dejar `solo_tema` como base para la etapa 5?
2. Si querés el suavizado a 0,5 con pocas votaciones, ¿con qué mínimo de votos (por ejemplo, 3)?
3. ¿Querés que `con_autor` (sin alineación) siga como candidato, o se queda como está la etapa 4?

No arranqué la etapa 5. PRUEBA no se tocó.
