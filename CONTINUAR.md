# Cómo continuar el proyecto "Poroteo Legislativo con IA"

Nota de traspaso para la próxima persona o agente que tome el proyecto.

## Repos y rama

Trabajar siempre en la rama **`feature/poroteo-ia-completo`** de los dos repos.
`ML-TESTING` es de otro compañero: no tocarla.

- Backend: https://github.com/zozodei/Agente-BackEnd-Legislativo
- Frontend: https://github.com/zozodei/Agente-FrontEnd-Legislativo

## Levantarlo

1. En cada repo: `git fetch`, `git checkout feature/poroteo-ia-completo`, `git pull`, `npm install`.
2. Crear los `.env` (no están en git; pedírselos al equipo). Ver `.env.example` de cada repo.
   El backend necesita `GEMINI_API_KEY` (gratis en https://aistudio.google.com/apikey) para el
   analista de bloques con IA; sin ella, la predicción usa solo el historial.
3. Backend: `npm run dev` (puerto 4000). Frontend: `npm run dev` → http://localhost:5173.
4. Prueba de punta a punta: `E2E_EMAIL=... E2E_PASSWORD=... npm run e2e` (en el backend).

## Qué leer primero

- `CLAUDE.md` de cada repo (sección "Poroteo con IA" al final).
- `PROGRESO.md`: hecho y pendiente. `DECISIONES.md`: por qué se eligió cada cosa.
- `EVALUACION_MODELOS.md`: métricas, comparaciones y evaluación del analista con IA.
- `DIAGNOSTICO.md` y `data/README.md`: el dataset y sus problemas.

## Cómo funciona la predicción

- **Datos:** ¿Cómo Votó? en Supabase (2.992 votaciones y 768.789 votos, 1993–2026). Export y
  dataset limpio en `data/`.
- **Modelo estadístico:** regresión logística calibrada con 108 features, en JS puro
  (`src/prediccion/`). Artefactos versionados en `data/modelo/`.
- **Analista de bloques con IA:** Gemini, plan gratis (`src/services/analistaBloques.service.js`).
  Lee el proyecto y estima la postura de cada bloque; el modelo la reparte por diputado
  (con antecedentes, actualización suave; sin antecedentes, manda la IA).
- **Resultado medido:** con 22 leyes de agosto a octubre de 2026 que el sistema no vio, acierta el
  84,8 % de los votos individuales (solo historial: 83,0 %); el error en negativos por votación
  baja de 25 a 13.
- **Supabase:** la migración `supabase/migrations/20261120120000_poroteo_ia.sql` ya está aplicada
  en producción y los datos limpios están cargados (`npm run supabase:cargar`).

## Pendiente

1. **Deploy en Vercel.** La versión online tiene el código viejo. En Vercel la función corta a
   los 60 s y Gemini gratis a veces tarda entre 30 y 120 s: hacer la estimación en segundo plano
   y consultar el estado (o un plan pago).
2. Mejorar las votaciones muy parejas (p. ej. Propiedad privada: real 124–119, estima 144–90).
3. Opcional: explicaciones redactadas por la IA (hoy se arman con plantilla para no gastar el
   límite gratis de Gemini).

## Reglas del equipo

- Trabajar solo en esta rama. No subir los `.env` a git.
- No gastar plata: por eso Gemini gratis.
- Interfaz en español rioplatense.
- Neutralidad política: no calificar a legisladores, partidos ni proyectos; siempre el aviso
  "Estimación, no resultado".
