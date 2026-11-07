// Variables de entorno falsas para los tests: nunca se conecta a Supabase real.
process.env.NODE_ENV = 'test';
// Proxy simulado en los tests existentes; producción no confía en ningún proxy por defecto.
process.env.TRUST_PROXY = 'loopback';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.SUPABASE_URL = 'https://test-project.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
process.env.SUPABASE_SECRET_KEY = 'sb_secret_test';
