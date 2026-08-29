import type { NextFunction, Request, Response } from 'express';
import { forbidden } from '../lib/errors.js';
import { timingSafeEqual } from '../lib/crypto.js';
import { CSRF_COOKIE } from '../modules/auth/session.service.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit CSRF check. The token lives in a non-HttpOnly cookie and must be
 * echoed in the X-CSRF-Token header; a cross-site attacker can send the cookie
 * but cannot read it to build the header. Layered on top of SameSite=Lax.
 */
export function verifyCsrf(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next();
  // Unauthenticated endpoints (login, register) are not CSRF-relevant: there is
  // no ambient authority to ride on, and they are rate limited separately.
  if (!req.auth) return next();

  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  const cookieToken = cookies?.[CSRF_COOKIE];
  const headerToken = req.get('x-csrf-token');

  if (!cookieToken || !headerToken || !timingSafeEqual(cookieToken, headerToken)) {
    return next(forbidden('Token de segurança inválido. Recarregue a página e tente novamente.'));
  }
  next();
}
