import * as authService from '../services/auth.service.js';
import * as oauthService from '../services/oauth.service.js';

export async function registro(req, res) {
  const resultado = await authService.registrar(req.valid.body);
  res.status(201).json({ data: resultado });
}

export async function login(req, res) {
  res.json({ data: await authService.login(req.valid.body) });
}

/** Paso 1 del login con Google: URL de autorización + verifier PKCE para el front. */
export async function googleInicio(_req, res) {
  res.set('Cache-Control', 'no-store').json({ data: await oauthService.iniciarGoogle() });
}

/** Paso 2: el front manda el código que trajo Google y el verifier → sesión. */
export async function googleCallback(req, res) {
  res
    .set('Cache-Control', 'no-store')
    .json({ data: await oauthService.completarGoogle(req.valid.body) });
}

export async function refresh(req, res) {
  res.json({ data: await authService.refrescar(req.valid.body) });
}

export async function logout(req, res) {
  await authService.logout(req.accessToken);
  res.status(204).end();
}

export async function me(req, res) {
  res.json({ data: req.usuario });
}
