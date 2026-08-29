/**
 * Application errors carry a stable machine-readable `code` so the client can
 * localize messages, plus a `safeMessage` that is explicitly cleared for
 * disclosure to the caller. Anything else is reported as a generic 500.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly expose = true;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message = 'Requisição inválida.', details?: unknown) =>
  new AppError(400, 'bad_request', message, details);

export const unauthorized = (message = 'Você precisa entrar para continuar.') =>
  new AppError(401, 'unauthorized', message);

export const forbidden = (message = 'Você não tem permissão para acessar este recurso.') =>
  new AppError(403, 'forbidden', message);

export const notFound = (message = 'Recurso não encontrado.') =>
  new AppError(404, 'not_found', message);

export const conflict = (message = 'Conflito com o estado atual do recurso.') =>
  new AppError(409, 'conflict', message);

export const payloadTooLarge = (message = 'Arquivo maior que o limite permitido.') =>
  new AppError(413, 'payload_too_large', message);

export const unsupportedMedia = (message = 'Tipo de arquivo não suportado.') =>
  new AppError(415, 'unsupported_media_type', message);

export const tooManyRequests = (message = 'Muitas tentativas. Tente novamente em instantes.') =>
  new AppError(429, 'too_many_requests', message);

export const serverError = (message = 'Erro interno. Tente novamente.') =>
  new AppError(500, 'internal_error', message);
