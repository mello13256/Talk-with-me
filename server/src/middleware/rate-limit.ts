import rateLimit, { type Options } from 'express-rate-limit';
import type { Request } from 'express';
import { isTest } from '../config/env.js';
import { tooManyRequests } from '../lib/errors.js';

/**
 * IPv6 addresses are bucketed by /64 prefix: a single client is routinely handed
 * a whole /64, so keying on the full address would make the limiter trivial to
 * evade by rotating the host part.
 */
function ipKey(ip: string | undefined): string {
  if (!ip) return 'unknown';
  const address = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (!address.includes(':')) return address;
  return address.split(':').slice(0, 4).join(':');
}

function make(options: Partial<Options> & { windowMs: number; limit: number }) {
  return rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Disabled under test so the suite is not throttled by its own fixtures.
    skip: () => isTest,
    handler: (_req, _res, next) => next(tooManyRequests(options.message as string | undefined)),
    ...options,
  });
}

/** Authenticated users are limited per account; anonymous traffic per IP. */
const perUserOrIp = (req: Request) => req.auth?.user.id ?? ipKey(req.ip);

// Generous by design: it is a blast shield, not the primary control. The
// endpoint-specific limiters below are what actually protect sensitive routes.
export const globalLimiter = make({
  windowMs: 60_000,
  limit: 600,
  keyGenerator: perUserOrIp,
});

export const loginLimiter = make({
  windowMs: 15 * 60_000,
  limit: 10,
  keyGenerator: (req: Request) => {
    const body = req.body as { email?: unknown } | undefined;
    const email = typeof body?.email === 'string' ? body.email.toLowerCase().slice(0, 254) : '';
    return `${ipKey(req.ip)}:${email}`;
  },
  message: 'Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente.',
});

export const registerLimiter = make({
  windowMs: 60 * 60_000,
  limit: 5,
  keyGenerator: (req: Request) => ipKey(req.ip),
  message: 'Limite de criação de contas atingido. Tente novamente mais tarde.',
});

export const passwordResetLimiter = make({
  windowMs: 60 * 60_000,
  limit: 5,
  keyGenerator: (req: Request) => ipKey(req.ip),
  message: 'Muitas solicitações de recuperação. Tente novamente mais tarde.',
});

export const messageLimiter = make({
  windowMs: 60_000,
  limit: 60,
  keyGenerator: perUserOrIp,
  message: 'Você está enviando mensagens rápido demais. Aguarde alguns segundos.',
});

export const uploadLimiter = make({
  windowMs: 60_000,
  limit: 20,
  keyGenerator: perUserOrIp,
  message: 'Limite de uploads atingido. Aguarde um minuto.',
});

export const searchLimiter = make({
  windowMs: 60_000,
  limit: 60,
  keyGenerator: perUserOrIp,
});

/**
 * Listing endpoints are hit by ordinary navigation and by realtime-driven
 * refreshes, so they get a looser budget than free-text search.
 */
export const listLimiter = make({
  windowMs: 60_000,
  limit: 180,
  keyGenerator: perUserOrIp,
});
