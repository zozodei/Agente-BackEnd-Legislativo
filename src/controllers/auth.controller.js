import * as authService from '../services/auth.service.js';

export async function registro(req, res) {
  const resultado = await authService.registrar(req.valid.body);
  res.status(201).json({ data: resultado });
}

export async function login(req, res) {
  res.json({ data: await authService.login(req.valid.body) });
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
