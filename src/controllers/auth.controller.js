import * as authService from '../services/auth.service.js';
import {
  clearPkceCookie,
  clearSessionCookies,
  PKCE_COOKIE,
  readCookie,
  respondAuth,
  setPkceCookie,
} from '../middlewares/sessionSecurity.js';
import { AppError } from '../utils/AppError.js';

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
    await authService.logout(req.valid.auth.accessToken, req.valid.auth.refreshToken);
  } finally {
    if (req.cookieSession) clearSessionCookies(res);
  }
  res.status(204).end();
}

export async function googleInicio(req, res) {
  const { url, codeVerifier } = await authService.iniciarGoogle(req.valid.query.redirectTo);
  setPkceCookie(res, codeVerifier);
  res.json({ data: { url } });
}

export async function googleCallback(req, res) {
  const codeVerifier = readCookie(req, PKCE_COOKIE);
  clearPkceCookie(res); // un solo intento por inicio
  if (!codeVerifier) {
    throw new AppError(
      400,
      'OAUTH_FAILED',
      'No se pudo completar el ingreso con Google. Volvé a intentarlo desde el mismo navegador.',
    );
  }
  const { code } = req.valid.body;
  respondAuth(req, res, await authService.completarGoogle({ code, codeVerifier }));
}
