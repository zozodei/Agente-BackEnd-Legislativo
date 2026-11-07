import * as authService from '../services/auth.service.js';
import { clearSessionCookies, respondAuth } from '../middlewares/sessionSecurity.js';

export async function registrar(req, res) {
  respondAuth(req, res, await authService.registrar(req.valid.body), 201);
}

export async function login(req, res) {
  respondAuth(req, res, await authService.login(req.valid.body));
}

export async function refresh(req, res) {
  try {
    respondAuth(req, res, await authService.refresh(req.valid.body.refreshToken));
  } catch (error) {
    if (req.cookieSession && error.status === 401) clearSessionCookies(res);
    throw error;
  }
}

export async function me(req, res) {
  res.json({ data: await authService.getUsuario(req.valid.auth.accessToken) });
}

export async function logout(req, res) {
  try {
    await authService.logout(req.valid.auth.accessToken);
  } finally {
    if (req.cookieSession) clearSessionCookies(res);
  }
  res.status(204).end();
}
