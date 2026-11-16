// Entrada para Vercel: exporta la app de Express como función serverless.
// En local se sigue usando src/server.js (npm run dev / npm start).
import { createApp } from '../src/app.js';

export default createApp();
