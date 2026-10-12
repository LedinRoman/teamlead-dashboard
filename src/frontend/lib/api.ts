import type { ApiErrorBody } from '@shared/api';
import { activeLocale, tr } from '@shared/locale';

export class ApiError extends Error {
  readonly code: ApiErrorBody['code'];
  readonly detail?: string;
  readonly status: number;

  constructor(message: string, status: number, code: ApiErrorBody['code'], detail?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }

  get isNotConnected(): boolean {
    return this.code === 'not-connected';
  }

  get fullMessage(): string {
    return this.detail ? `${this.message} — ${this.detail}` : this.message;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-Locale': activeLocale(),
        ...(init?.headers ?? {}),
      },
    });
  } catch (error) {
    throw new ApiError(
      tr(
        'The local server did not respond. Is the app still running?',
        'Локальный сервер не ответил. Приложение ещё запущено?',
      ),
      0,
      'server',
      error instanceof Error ? error.message : undefined,
    );
  }

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : {};

  if (!response.ok) {
    const body = payload as ApiErrorBody;
    throw new ApiError(
      body.error ?? `Request failed with HTTP ${response.status}.`,
      response.status,
      body.code ?? 'server',
      body.detail,
    );
  }
  return payload as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'GET', cache: 'no-store' });
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
}

export function apiPut<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) });
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) });
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' });
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.fullMessage;
  if (error instanceof Error) return error.message;
  return 'Unexpected error.';
}
