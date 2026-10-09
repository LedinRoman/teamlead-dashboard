import { NextResponse } from 'next/server';

import { JiraError } from '@backend/jira/client';
import { ScopeError } from '@backend/jira/scope';
import type { ApiErrorBody } from '@shared/api';
import { NotConnectedError } from './context';
import { UnauthorizedError } from './user';
import { ValidationError } from './validate';

export type { ApiErrorBody } from '@shared/api';

export function ok<T>(payload: T): NextResponse {
  return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
}

export function badRequest(message: string, detail?: string): NextResponse {
  return NextResponse.json<ApiErrorBody>({ error: message, detail, code: 'bad-request' }, { status: 400 });
}

/** Turns known failures into messages that say what to do next. */
export function failure(error: unknown): NextResponse {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json<ApiErrorBody>({ error: error.message, code: 'unauthorized' }, { status: 401 });
  }
  if (error instanceof NotConnectedError) {
    return NextResponse.json<ApiErrorBody>({ error: error.message, code: 'not-connected' }, { status: 409 });
  }
  if (error instanceof ValidationError) {
    return NextResponse.json<ApiErrorBody>({ error: error.message, code: 'bad-request' }, { status: 400 });
  }
  if (error instanceof ScopeError) {
    return NextResponse.json<ApiErrorBody>({ error: error.message, code: 'scope' }, { status: 422 });
  }
  if (error instanceof JiraError) {
    return NextResponse.json<ApiErrorBody>(
      { error: error.message, detail: error.detail, code: 'jira' },
      { status: error.status >= 400 && error.status < 600 ? error.status : 502 },
    );
  }
  const message = error instanceof Error ? error.message : 'Unexpected server error.';
  return NextResponse.json<ApiErrorBody>({ error: message, code: 'server' }, { status: 500 });
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new Error('Request body must be valid JSON.');
  }
}
