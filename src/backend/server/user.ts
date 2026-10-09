/** Shared owner for the single local cabinet. Sign-in is not required. */
export const GLOBAL_USER_ID = '';

export class UnauthorizedError extends Error {
  constructor(message = 'Sign in required.') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export interface UserScope {
  id: string;
  aliases: string[];
}

const SHARED_SCOPE: UserScope = { id: GLOBAL_USER_ID, aliases: [GLOBAL_USER_ID] };

export async function currentUserScope(): Promise<UserScope> {
  return SHARED_SCOPE;
}

export async function requireUserId(): Promise<string> {
  return SHARED_SCOPE.id;
}

export async function currentUserId(): Promise<string> {
  return SHARED_SCOPE.id;
}

export async function bindUserFromSession(): Promise<void> {}
