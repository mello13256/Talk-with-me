import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { isProduction } from '../config/env.js';

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'not_found', message: 'Rota não encontrada.' } });
}

interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  let status = 500;
  let body: ErrorBody = { code: 'internal_error', message: 'Erro interno. Tente novamente.' };

  if (error instanceof AppError) {
    status = error.status;
    body = { code: error.code, message: error.message };
    if (error.details !== undefined) body.details = error.details;
  } else if (error instanceof ZodError) {
    status = 422;
    body = {
      code: 'validation_error',
      message: 'Alguns campos precisam ser corrigidos.',
      details: error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    };
  } else if (error instanceof multer.MulterError) {
    status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    body = {
      code: error.code === 'LIMIT_FILE_SIZE' ? 'payload_too_large' : 'bad_request',
      message:
        error.code === 'LIMIT_FILE_SIZE'
          ? 'Arquivo maior que o limite permitido.'
          : 'Não foi possível processar o arquivo enviado.',
    };
  } else if (error instanceof SyntaxError && 'body' in error) {
    status = 400;
    body = { code: 'bad_request', message: 'Corpo da requisição malformado.' };
  }

  if (status >= 500) {
    logger.error('Unhandled request error', {
      method: req.method,
      path: req.originalUrl,
      userId: req.auth?.user.id,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error && !isProduction ? error.stack : undefined,
    });
  } else {
    logger.debug('Request rejected', {
      method: req.method,
      path: req.originalUrl,
      status,
      code: body.code,
    });
  }

  if (res.headersSent) return;
  res.status(status).json({ error: body });
}
