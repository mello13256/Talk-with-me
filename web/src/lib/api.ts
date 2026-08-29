const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export interface ApiErrorDetail {
  field: string;
  message: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ApiErrorDetail[];

  constructor(status: number, code: string, message: string, details?: ApiErrorDetail[]) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Message for a specific form field, when the server flagged one. */
  fieldError(field: string): string | undefined {
    return this.details?.find((detail) => detail.field === field)?.message;
  }
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/**
 * The CSRF token is stored in a readable cookie and echoed back in a header.
 * A cross-site page can make the browser send the cookie but cannot read it.
 */
export const csrfToken = (): string | null => readCookie('twm_csrf');

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();

/** Fired when the server rejects the session, so the app can reset to signed-out. */
export function onUnauthorized(listener: Listener): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

async function parseError(response: Response): Promise<ApiError> {
  let code = 'error';
  let message = 'Não foi possível concluir a operação.';
  let details: ApiErrorDetail[] | undefined;
  try {
    const payload = (await response.json()) as {
      error?: { code?: string; message?: string; details?: ApiErrorDetail[] };
    };
    if (payload.error) {
      code = payload.error.code ?? code;
      message = payload.error.message ?? message;
      details = payload.error.details;
    }
  } catch {
    if (response.status === 0) message = 'Sem conexão com o servidor.';
  }
  return new ApiError(response.status, code, message, details);
}

interface RequestOptions {
  signal?: AbortSignal;
  /** Suppresses the global signed-out broadcast (used by the initial /me probe). */
  silent401?: boolean;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const token = csrfToken();
  if (token && method !== 'GET') headers['X-CSRF-Token'] = token;

  let response: Response;
  try {
    response = await fetch(`${BASE}/api${path}`, {
      method,
      headers,
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: options.signal ?? null,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError(0, 'network_error', 'Sem conexão com o servidor. Verifique sua internet.');
  }

  if (response.status === 401 && !options.silent401) {
    for (const listener of unauthorizedListeners) listener();
  }

  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('POST', path, body ?? {}, options),
  patch: <T>(path: string, body: unknown, options?: RequestOptions) =>
    request<T>('PATCH', path, body, options),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>('DELETE', path, undefined, options),

  /**
   * Uploads use XHR rather than fetch: it is still the only way to observe
   * upload progress, which the composer shows per file.
   */
  upload<T>(
    path: string,
    formData: FormData,
    handlers: { onProgress?: (percent: number) => void; signal?: AbortSignal } = {},
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE}/api${path}`);
      xhr.withCredentials = true;

      const token = csrfToken();
      if (token) xhr.setRequestHeader('X-CSRF-Token', token);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && handlers.onProgress) {
          handlers.onProgress(Math.round((event.loaded / event.total) * 100));
        }
      };

      xhr.onload = () => {
        if (xhr.status === 401) for (const listener of unauthorizedListeners) listener();
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(xhr.responseText ? (JSON.parse(xhr.responseText) as T) : (undefined as T));
          } catch {
            reject(new ApiError(xhr.status, 'bad_response', 'Resposta inválida do servidor.'));
          }
          return;
        }
        try {
          const payload = JSON.parse(xhr.responseText) as {
            error?: { code?: string; message?: string };
          };
          reject(
            new ApiError(
              xhr.status,
              payload.error?.code ?? 'error',
              payload.error?.message ?? 'Falha no envio do arquivo.',
            ),
          );
        } catch {
          reject(new ApiError(xhr.status, 'error', 'Falha no envio do arquivo.'));
        }
      };

      xhr.onerror = () => reject(new ApiError(0, 'network_error', 'Falha de rede durante o envio.'));
      xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));

      handlers.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
      xhr.send(formData);
    });
  },
};

export const apiUrl = (path: string): string => `${BASE}${path}`;
