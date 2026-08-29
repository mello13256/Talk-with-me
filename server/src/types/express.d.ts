import type { SessionRow, UserRow } from './index.js';

declare global {
  namespace Express {
    interface Request {
      /** Present only after `loadSession` has run and found a live session. */
      auth?: {
        user: UserRow;
        session: SessionRow;
      };
      requestId?: string;
    }
  }
}

export {};
