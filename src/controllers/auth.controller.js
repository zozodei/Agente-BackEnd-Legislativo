import * as authService from '../services/auth.service.js';

export async function googleUrl(req, res) {
  res.json({ data: await authService.generarUrlGoogle(req.valid.query) });
}

export async function googleIdToken(req, res) {
  res.json({ data: await authService.autenticarConIdTokenGoogle(req.valid.body) });
}

export async function refresh(req, res) {
  res.json({ data: await authService.refrescar(req.valid.body) });
}

export async function logout(req, res) {
  await authService.cerrarSesion(req.accessToken);
  res.status(204).end();
}

export async function me(req, res) {
  res.json({ data: req.usuario });
}
