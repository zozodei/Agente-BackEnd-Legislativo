import * as authService from '../services/auth.service.js';

export async function registrar(req, res) {
  res.status(201).json({ data: await authService.registrar(req.valid.body) });
}

export async function login(req, res) {
  res.json({ data: await authService.login(req.valid.body) });
}

export async function refresh(req, res) {
  res.json({ data: await authService.refresh(req.valid.body.refreshToken) });
}

export async function me(req, res) {
  res.json({ data: await authService.getUsuario(req.valid.auth.accessToken) });
}

export async function logout(req, res) {
  await authService.logout(req.valid.auth.accessToken);
  res.status(204).end();
}
