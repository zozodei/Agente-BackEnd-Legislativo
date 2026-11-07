import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

function config(values = {}) {
  return spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import { env } from './src/config/env.js'; process.stdout.write(JSON.stringify({ proxy: env.TRUST_PROXY, sameSite: env.SESSION_SAME_SITE }));",
    ],
    { cwd: process.cwd(), env: { ...process.env, TRUST_PROXY: '', ...values }, encoding: 'utf8' },
  );
}
it('no confía en proxies por defecto y no acepta origen comodín/ruta ni None inseguro', () => {
  const valid = config();
  expect(valid.status).toBe(0);
  expect(JSON.parse(valid.stdout)).toEqual({ proxy: false, sameSite: 'lax' });
  for (const values of [
    { CORS_ORIGINS: '*' },
    { CORS_ORIGINS: 'https://example.org/ruta' },
    { SESSION_SAME_SITE: 'none' },
    { NODE_ENV: 'production', CORS_ORIGINS: 'http://example.org' },
  ])
    expect(config(values).status).toBe(1);
});
