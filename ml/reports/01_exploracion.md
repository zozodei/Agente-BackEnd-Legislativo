# Etapa 1 · Exploración del dataset Fase 4

Generado por `scripts/01_exploracion.py`. Sin modelos. De PRUEBA solo se informan conteos descriptivos.

> Todo el dataset tiene `aptitud = PENDIENTE` (0 registros APTO). Lo que sigue es experimentación, no un predictor certificado.

## 0. Avisos antes de seguir (conflictos con el pedido o decisiones abiertas)

1. **Signo político y bloque.** El protocolo los incluye en `metadatos_no_predictores` (`signo_politico`, `bloque`, `interbloque`) porque son los **observados en el evento**. La etapa 2c pide signo y bloque "al inicio de la sesión". **Propuesta:** no usar esas columnas y construir `bloque_inicio` a partir de `historial_bloques_intervalos` (intervalo con `BLOQUE_INICIO` < límite de la sesión), `distrito` desde el mandato vigente y `signo_inicio` = ese bloque × gobierno vigente el día anterior (`contexto_bloque_fecha`). Riesgo: los intervalos se corrigieron en Fase 4 usando actas, así que tienen un componente retrospectivo. El permitido sin discusión es `bloque_hist_train` (último bloque observado antes del corte). **Necesito tu OK para usar la variante construida.**
2. **Historial congelado o móvil.** El benchmark del protocolo usa `hist_train_*`, congelado al 2023-01-01. Con esa versión, **105 de 368** legisladores de validación y **210 de 372** de prueba no tienen historial. El historial móvil `prev_*` (protocolo separado, causal antes de la sesión) es el que usaría el producto: con él quedan sin historial solo 7 en validación y 107 en prueba. **Propuesta:** reportar las dos versiones y tomar como principal `prev_*`, aclarando que no es el benchmark congelado.
3. **Las firmas valen 0 en todo ENTRENAMIENTO.** Hay firmas admisibles de 2020–2021, pero ningún dictamen de esos años corresponde a un expediente votado en general dentro del conjunto. Solo hay señal en 13 expedientes de validación y 34 de prueba. **La etapa 3 no se puede entrenar como está planteada.** Alternativas: (a) reglas o priors fijados a mano, (b) estimar el efecto de las firmas con validación cruzada agrupada por votación **dentro** de validación (eso consume validación y deja muy pocos datos), (c) reconstruir firmas de dictámenes anteriores a 2023, cosa que excede este paquete. Propongo (b), reportado como exploratorio, y que el modelo de producción siga siendo la variante sin firmas.
4. **Tipo de mayoría.** Las 25 votaciones generales de validación y las 39 de prueba **no traen `oficial_tipo_mayoria`**. Como pediste, uso mayoría **simple** para todas. En entrenamiento sí aparece (Más de la mitad / Votos emitidos ≈ simple; Miembros del Cuerpo ≈ absoluta; Dos tercios). Además existe "Tres cuartos", que la app no contempla (no aparece en el conjunto general).
5. **El acierto APROBADO/RECHAZADO no informa en validación.** Las **25 de 25** votaciones de validación fueron aprobadas (en entrenamiento, 399 de 400). Una regla constante de "APROBADO" acierta el 100%. Las métricas útiles por votación son el error en afirmativos y negativos y el quórum.
6. **Validación es chica:** 25 votaciones en **6 sesiones**. Los intervalos bootstrap van a ser anchos. Hago bootstrap agrupado por votación, como pediste, y propongo informar también uno agrupado por **sesión**, porque las votaciones de una misma sesión están correlacionadas.
7. **Modelo de presencia y tipo de votación.** El conjunto de presencia mezcla votaciones generales, particulares, procedimentales y sin confirmar, y el tipo real es metadato no predictor. Propuesta: entrenar P(presente) con todo el conjunto y evaluarlo además sobre las 25 votaciones generales de validación, que están completas en presencia (25 de 25, 6.121 filas, 5.082 presentes, igual a las filas del conjunto general).
8. **"Firmó el proyecto"** no está como variable. Las fuentes posibles son `proyectos_de_ley.AUTOR` (un solo nombre) y `documentos_proyectos.firmantes_ficha` (lista de [nombre, provincia, bloque], **sin `legislador_id`**). `firmantes_ficha` no cubre **ninguna** votación de validación ni de prueba (solo 175 de 396 de entrenamiento), así que no sirve. `AUTOR` cubre el 100%, pero es solo el autor principal y hay que cruzarlo por nombre normalizado + fecha de mandato, sin difuso, igual que en el cruce con la app. Propongo `es_autor_principal` como feature de la etapa 3.
9. **Escaños sin fila.** Una votación general tiene en promedio unas 245 filas en presencia, no 257: hay vacantes y `SIN_DATO`. El quórum (129) se calcula sobre los presentes predichos de las filas existentes, igual que la app con "sin asignar".
10. Entorno: Python 3.10 (el proveedor sugiere 3.12, pero solo para *reconstruir* Fase 3 → 4, que no hace falta). La carpeta de trabajo no estaba vacía (era el repo backend), así que el proyecto vive en `Downloads\demoIA-prediccion`.

## 1. Tablas

### 01_datos (CSV contados con parser csv; contraste con SQLite)

| tabla | filas_csv | filas_sqlite | columnas | primeras columnas |
|---|---|---|---|---|
| acta_documental_votacion.csv | 423 | 423 | 4 | acta_documental_id, votacion_id, es_nueva, metodo |
| actas_documentales.csv | 479 | 479 | 28 | acta_documental_id, sesion_id, periodo, reunion, acta_local, fecha_local … |
| bloque_interbloque_historico.csv | 44 | 44 | 11 | regla_id, bloque_normalizado, interbloque, desde, hasta, metodo … |
| bloques.csv | 211 | 211 | 3 | bloque_id, nombre_original, nombre_normalizado_auxiliar |
| contexto_bloque_fecha.csv | 7322 | 7322 | 15 | bloque_id, bloque, fecha_dia, familia_politica_literal, interbloque, interbloque_estado … |
| dictamenes.csv | 143 | 143 | 11 | documento_id, fecha_publicacion_od, fecha_indice, fecha_impresion, fecha_estado, estado_firmas … |
| documento_expediente.csv | 2084 | 2084 | 4 | documento_id, expediente, fuente_relacion, estado |
| documentos_proyectos.csv | 1879 | 1879 | 37 | expediente, url, consultado_utc, estado, error, texto_original … |
| eventos_interbloques.csv | 44 | 44 | 13 | comunicacion_original_indice, evento_id, expediente, bae_numero, fecha_cierre_bae, fecha_efecto_explicita … |
| firmas_dictamen.csv | 5851 | 5851 | 21 | documento_id, dictamen_seccion, tipo_dictamen, nombre_literal, fecha_firma, fecha_publicacion_od … |
| gobiernos_historicos.csv | 4 | 4 | 6 | gobierno_id, desde, hasta, presidente, coalicion, fuente |
| historial_bloques_intervalos.csv | 2168 | 2168 | 12 | ID, APELLIDO, NOMBRE, GENERO, DISTRITO, INICIO … |
| historial_mandatos_bloques.csv | 2168 | 2168 | 12 | ID, APELLIDO, NOMBRE, GENERO, DISTRITO, INICIO … |
| legisladores.csv | 1449 | 1449 | 4 | legislador_id, persona_id, nombre_original, identidad_estado |
| provincias.csv | 24 | 24 | 1 | nombre |
| proyectos.csv | 95695 | 95695 | 10 | PROYECTO_ID, TITULO, PUBLICACION_FECHA, PUBLICACION_ID, CAMARA_ORIGEN, EXP_DIPUTADOS … |
| proyectos_de_ley.csv | 35963 | 35963 | 10 | PROYECTO_ID, TITULO, PUBLICACION_FECHA, PUBLICACION_ID, CAMARA_ORIGEN, EXP_DIPUTADOS … |
| sesiones.csv | 294 | 294 | 11 | sesion_id, fecha, periodo, reunion, url, sha256 … |
| votacion_expediente.csv | 2724 | 2724 | 15 | acta_id, numero, origen, anio, expediente, titulo … |
| votacion_sesion.csv | 1706 | 1706 | 7 | votacion_id, sesion_id, fecha_inicio_sesion, limite_predictivo_sesion, precision_inicio_sesion, metodo … |
| votacion_version_documental.csv | 377 | 377 | 14 | votacion_id, documento_id, expediente, version_identificada, estado_relacion, version_votada_estado … |
| votaciones.csv | 1706 | 1706 | 76 | votacion_id, acta_id, camara, fecha_local, zona_horaria, titulo … |
| votos.csv | 438418 | 438418 | 77 | votacion_id, legislador_id, bloque_id, provincia_original, provincia_indice_original, voto_original_repo_codigo … |
| votos_documentales.csv | 119685 | 119685 | 6 | acta_documental_id, nombre, bloque, provincia, voto, pagina |

### 04_machine_learning (conjuntos experimentales)

| conjunto | archivo | filas | columnas |
|---|---|---|---|
| general | dataset_intencion_general.csv | 85918 | 42 |
| texto_digital | dataset_texto_digital_experimental.csv | 51885 | 42 |
| ocr_spa_pendiente | dataset_texto_ocr_spa_pendiente.csv | 5588 | 42 |
| presencia | dataset_presencia_registrada.csv | 281087 | 43 |

`votos_documentales` está en `01_datos` y en SQLite; los 24 conteos CSV coinciden con SQLite.

## 2. Protocolo (`protocolo_evaluacion.json`): qué se puede usar

- **Predictores permitidos (benchmark):** `hist_train_afirmativo`, `hist_train_negativo`, `hist_train_abstencion`, `hist_train_ausente`, `bloque_hist_train`, `firmas_mayoria_previas_detectadas`, `firmas_minoria_previas_detectadas`, `firmas_sin_calificar_previas_detectadas`, `firmas_con_disidencia_previas_detectadas`, `dictamenes_publicados_antes_detectados`.
- **Historial móvil (protocolo separado):** `prev_afirmativo`, `prev_negativo`, `prev_abstencion`, `prev_ausente`. Es causal: solo resultados anteriores al inicio de la sesión.
- **Metadatos que NO son predictores:** `votacion_id`, `legislador_id`, `fecha_local`, `tipo_verificado`, `split`, `grupo_proyecto`, `bloque`, `interbloque`, `signo_politico`, `objetivo_presencia_registrada`.
- **Horizonte:** `ANTES_DE_INICIO_DE_LA_SESION`. Todas las votaciones de una sesión comparten corte, incluso después de medianoche. Columna `limite_predictivo_sesion` (hora local de Buenos Aires). Cuando no hay hora, se usa 00:00 del día como cota conservadora.
- **Transformaciones** (vocabulario, escalas, selección de variables, hiperparámetros): se ajustan solo con entrenamiento.
- `hist_train_*` cuenta resultados elegibles anteriores a min(inicio de la sesión, 2023-01-01). Los totales contradictorios (10 eventos) ya están fuera del historial. Las cuentas de historial incluyen votaciones particulares, no solo generales.
- `firmas_*`: solo firmas admisibles (`firma_admisible_fase4=1`, 5.350), de documentos de **un único expediente**, con fecha de firma y publicación anterior al día de la sesión. **0 = no detectado, no "no firmó".** La disidencia se cuenta aparte.
- `provincia_normalizada` (distrito) **no** está en la lista de metadatos: no cambia dentro de un mandato.

### Splits, cuarentena y sin grupo

- La columna `split` está en cada conjunto ML y en `particiones_temporales.csv`, por votación. Valores: `ENTRENAMIENTO` (2011–2022), `VALIDACION` (2023–2024), `PRUEBA` (2025–2026), `CUARENTENA_CRUZA_CORTE` (5 eventos cuyos proyectos cruzan un corte) y `SIN_GRUPO_VERIFICADO` (364 eventos en total; en presencia aparecen 87).
- La unidad es la **componente conexa de expedientes y votaciones** (`grupo_proyecto`). Por eso un mismo proyecto no queda repartido entre splits.
- `carga.leer_dataset()` se queda solo con los tres splits estándar. Verificado: ninguna votación tiene más de un split entre conjuntos.

| dataset | split | filas | votaciones | identificadores_legislador | proyectos |
|---|---|---|---|---|---|
| general | CUARENTENA_CRUZA_CORTE | 212 | 1 | 212 | 1 |
| general | ENTRENAMIENTO | 72118 | 400 | 829 | 396 |
| general | PRUEBA | 8506 | 39 | 372 | 39 |
| general | VALIDACION | 5082 | 25 | 368 | 25 |
| texto_digital | ENTRENAMIENTO | 43147 | 248 | 634 | 245 |
| texto_digital | PRUEBA | 5958 | 27 | 372 | 27 |
| texto_digital | VALIDACION | 2780 | 13 | 365 | 13 |
| ocr_spa_pendiente | ENTRENAMIENTO | 5588 | 30 | 574 | 30 |
| presencia | CUARENTENA_CRUZA_CORTE | 1224 | 5 | 368 | 2 |
| presencia | ENTRENAMIENTO | 215642 | 916 | 856 | 579 |
| presencia | PRUEBA | 32518 | 128 | 372 | 62 |
| presencia | SIN_GRUPO_VERIFICADO | 18412 | 87 | 841 | 1 |
| presencia | VALIDACION | 13291 | 54 | 370 | 32 |

### Cómo se unen las tablas

```
votos.votacion_id ─────────── votaciones.votacion_id            (1.706 eventos)
votos.votacion_id ─────────── votacion_sesion.votacion_id       → sesion_id, limite_predictivo_sesion
votos.legislador_id ───────── legisladores.legislador_id        → persona_id (vacío en 360 con identidad PENDIENTE)
legisladores.persona_id ───── historial_bloques_intervalos.ID   (mandatos, distrito y bloque por intervalo; 97% de los ID)
firmas_dictamen.legislador_id   (usar solo firma_admisible_fase4 = 1)
firmas_dictamen.documento_id ─ dictamenes.documento_id ─ documento_expediente.documento_id → expediente
votacion_expediente.votacion_id → expediente, proyecto_id ─ proyectos_de_ley.PROYECTO_ID / EXP_DIPUTADOS
votacion_version_documental: votación ↔ documento (admisible_predictor = 0 en todas)
```

Los conjuntos ML ya traen `votacion_id`, `legislador_id`, `expediente`, `proyecto_id`, `grupo_proyecto`, `split` y `limite_predictivo_sesion`. Todas las filas del conjunto general tienen identidad resuelta (`NOMBRE_COMPLETO_PROVINCIA_MANDATO_UNICOS` o un alias).

## 3. Distribución de clases por split

### Intención general · objetivo_voto (sólo presentes)

| split | ABSTENCION | AFIRMATIVO | NEGATIVO | total | ABSTENCION % | AFIRMATIVO % | NEGATIVO % | votaciones | sesiones | legisladores |
|---|---|---|---|---|---|---|---|---|---|---|
| CUARENTENA_CRUZA_CORTE | 0 | 211 | 1 | 212 | 0.0 | 99.5 | 0.5 | 1 | 1 | 212 |
| ENTRENAMIENTO | 2164 | 61574 | 8380 | 72118 | 3.0 | 85.4 | 11.6 | 400 | 94 | 829 |
| PRUEBA | 101 | 7132 | 1273 | 8506 | 1.2 | 83.8 | 15.0 | 39 | 11 | 372 |
| VALIDACION | 200 | 3988 | 894 | 5082 | 3.9 | 78.5 | 17.6 | 25 | 6 | 368 |

### Presencia nominal · objetivo_presencia_registrada (1 = registrado en la votación)

| split | 0 | 1 | total | 0 % | 1 % | votaciones | sesiones | legisladores |
|---|---|---|---|---|---|---|---|---|
| CUARENTENA_CRUZA_CORTE | 174 | 1050 | 1224 | 14.2 | 85.8 | 5 | 4 | 368 |
| ENTRENAMIENTO | 46682 | 168960 | 215642 | 21.6 | 78.4 | 916 | 120 | 856 |
| PRUEBA | 3271 | 29247 | 32518 | 10.1 | 89.9 | 128 | 13 | 372 |
| SIN_GRUPO_VERIFICADO | 3384 | 15028 | 18412 | 18.4 | 81.6 | 87 | 23 | 841 |
| VALIDACION | 1572 | 11719 | 13291 | 11.8 | 88.2 | 54 | 10 | 370 |

### texto_digital · objetivo_voto

| split | ABSTENCION | AFIRMATIVO | NEGATIVO | total | ABSTENCION % | AFIRMATIVO % | NEGATIVO % | votaciones | sesiones | legisladores |
|---|---|---|---|---|---|---|---|---|---|---|
| ENTRENAMIENTO | 1340 | 37953 | 3854 | 43147 | 3.1 | 88.0 | 8.9 | 248 | 64 | 634 |
| PRUEBA | 56 | 4888 | 1014 | 5958 | 0.9 | 82.0 | 17.0 | 27 | 10 | 372 |
| VALIDACION | 82 | 2072 | 626 | 2780 | 2.9 | 74.5 | 22.5 | 13 | 5 | 365 |

### ocr_spa_pendiente · objetivo_voto

| split | ABSTENCION | AFIRMATIVO | NEGATIVO | total | ABSTENCION % | AFIRMATIVO % | NEGATIVO % | votaciones | sesiones | legisladores |
|---|---|---|---|---|---|---|---|---|---|---|
| ENTRENAMIENTO | 231 | 4674 | 683 | 5588 | 4.1 | 83.6 | 12.2 | 30 | 25 | 574 |

Baseline constante del proveedor (`baseline_constante_diagnostico.csv`), ajustado solo con entrenamiento:

| split | n | prediccion_constante | accuracy | f1_macro_tres_clases |
|---|---|---|---|---|
| ENTRENAMIENTO | 72118 | AFIRMATIVO | 0.8537951690285366 | 0.3070440515014611 |
| PRUEBA | 8506 | AFIRMATIVO | 0.8384669644956502 | 0.3040457006437311 |
| VALIDACION | 5082 | AFIRMATIVO | 0.7847304210940574 | 0.2931275266446159 |

`SIN_DATO` no aparece en ningún objetivo: el conjunto general tiene solo AFIRMATIVO/NEGATIVO/ABSTENCION, y presencia es 0/1 solo cuando hay evidencia nominal. No se imputa.

## 4. Diputados sin historial

| conjunto | split | legisladores | sin hist_train (leg) | sin hist_train (filas) | sin historial móvil prev_* (leg) | sin historial móvil prev_* (filas) |
|---|---|---|---|---|---|---|
| general | ENTRENAMIENTO | 829 | 0 | 0 | 572 | 1762 |
| general | VALIDACION | 368 | 105 | 680 | 7 | 34 |
| general | PRUEBA | 372 | 210 | 5804 | 107 | 122 |
| presencia | ENTRENAMIENTO | 856 | 0 | 0 | 778 | 4280 |
| presencia | VALIDACION | 370 | 107 | 3107 | 12 | 54 |
| presencia | PRUEBA | 372 | 210 | 20273 | 108 | 371 |

## 5. Firmas y dictámenes por split (filas del conjunto general con valor > 0)

| split | filas | firmas_mayoria | firmas_minoria | firmas_sin_calificar | firmas_con_disidencia | dictamenes_publicados_antes |
|---|---|---|---|---|---|---|
| ENTRENAMIENTO | 72118 | 0 | 0 | 0 | 0 | 0 |
| VALIDACION | 5082 | 108 | 43 | 235 | 3 | 2334 |
| PRUEBA | 8506 | 429 | 157 | 737 | 22 | 7549 |

Cobertura de autoría o firmantes del proyecto (expedientes votados en general):

| split | expedientes | con AUTOR (proyectos_de_ley) | con firmantes_ficha (documentos_proyectos) |
|---|---|---|---|
| ENTRENAMIENTO | 396 | 396 | 175 |
| VALIDACION | 25 | 25 | 0 |
| PRUEBA | 39 | 39 | 0 |

## 6. Mayoría y resultado oficial de las votaciones generales

| mayoria (tipo / base) | ENTRENAMIENTO | VALIDACION | PRUEBA |
|---|---|---|---|
| (vacío) | 13 | 25 | 39 |
| Dos tercios / Miembros del Cuerpo | 2 | 0 | 0 |
| Dos tercios / Votos Emitidos | 1 | 0 | 0 |
| La mitad más uno / Votos Emitidos | 2 | 0 | 0 |
| Más de la mitad / Legisladores Presentes | 1 | 0 | 0 |
| Más de la mitad / Miembros del Cuerpo | 7 | 0 | 0 |
| Más de la mitad / Votos Emitidos | 374 | 0 | 0 |

| oficial_resultado | ENTRENAMIENTO | VALIDACION | PRUEBA |
|---|---|---|---|
| AFIRMATIVO | 399 | 25 | 38 |
| NEGATIVO | 1 | 0 | 1 |

## 7. Plan para la etapa 2 (a confirmar)

- Objetivo B: `objetivo_voto` del conjunto general. Objetivo A: `objetivo_presencia_registrada`.
- Baselines en validación: (a) clase constante, (b) historial personal (la proporción de A/N/Abs en `prev_*` suavizada hacia la tasa global de entrenamiento; las presencias con `prev_ausente`), (c) regresión logística con historial, `bloque_inicio`, `signo_inicio` y distrito (sujeto al aviso 1).
- Métricas por diputado y por votación, con bootstrap agrupado por votación (y por sesión, si lo aprobás).
