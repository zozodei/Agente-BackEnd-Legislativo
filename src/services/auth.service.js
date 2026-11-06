import * as authRepository from '../repositories/auth.repository.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { resolverRol } from './roles.service.js';

function toUsuarioDTO(user, incluirFecha = true) {
  if (!user?.id || !user.email) throw AppError.upstream('Respuesta de autenticación incompleta');
  return {
    id: user.id,
    email: user.email,
    rol: resolverRol(user),
    // Es un dato de presentación editable, nunca un rol ni un permiso.
    nombre: typeof user.user_metadata?.nombre === 'string' ? user.user_metadata.nombre : null,
    ...(incluirFecha && user.created_at ? { createdAt: user.created_at } : {}),
  };
}

function toSesionDTO(session) {
  if (
    !session?.access_token ||
    !session.refresh_token ||
    !Number.isFinite(session.expires_at) ||
    !Number.isFinite(session.expires_in) ||
    session.token_type !== 'bearer'
  ) {
    throw AppError.upstream('Respuesta de sesión incompleta');
  }
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresIn: session.expires_in,
    expiresAt: session.expires_at,
    tokenType: 'bearer',
  };
}

function toAuthDTO(data) {
  if (!data) throw AppError.upstream('Respuesta de autenticación incompleta');
  return { usuario: toUsuarioDTO(data.user), sesion: toSesionDTO(data.session) };
}

export async function registrar(input) {
  const data = await authRepository.registrar(input, `${env.CORS_ORIGINS[0]}/login`);
  if (!data) throw AppError.upstream('Respuesta de autenticación incompleta');
  return {
    // Sin sesión (incluidas respuestas ofuscadas de Auth) no se anuncian privilegios.
    usuario: { ...toUsuarioDTO(data.user), ...(!data.session && { rol: 'usuario' }) },
    sesion: data.session ? toSesionDTO(data.session) : null,
    requiereConfirmacion: !data.session,
  };
}

export async function login(input) {
  return toAuthDTO(await authRepository.login(input));
}

export async function refresh(refreshToken) {
  return toAuthDTO(await authRepository.refresh(refreshToken));
}

export async function getUsuario(accessToken) {
  const data = await authRepository.getUsuario(accessToken);
  if (!data?.user) throw new AppError(401, 'SESSION_EXPIRED', 'La sesión venció o no es válida');
  return toUsuarioDTO(data.user, false);
}

export async function logout(accessToken) {
  await authRepository.logout(accessToken);
}
