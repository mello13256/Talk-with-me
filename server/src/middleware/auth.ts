import type { NextFunction, Request, Response } from 'express';
import { forbidden, unauthorized } from '../lib/errors.js';
import { readSessionToken, resolveSessionToken, touchSession } from '../modules/auth/session.service.js';

/**
 * Attaches `req.auth` when a valid session cookie is present. Never throws —
 * route-level guards decide whether anonymous access is acceptable.
 */
export async function loadSession(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = readSessionToken(req);
    if (!token) return next();
    const resolved = await resolveSessionToken(token);
    if (!resolved) return next();
    req.auth = resolved;
    void touchSession(resolved.session.id).catch(() => undefined);
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) return next(unauthorized());
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) return next(unauthorized());
  // Role comes from the users table on every request, never from the cookie or
  // any client-supplied value.
  if (req.auth.user.role !== 'admin') return next(forbidden('Acesso restrito ao administrador.'));
  next();
}

export function requireClient(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) return next(unauthorized());
  if (req.auth.user.role !== 'client') {
    return next(forbidden('Esta rota é exclusiva para clientes.'));
  }
  next();
}
