// Cursors are opaque to clients: base64url of `v1:<next offset>`. Offsets are only meaningful for
// the registry that issued them; the registry is immutable, so a cursor is stable until a rebuild.
const CURSOR_VERSION = 'v1';
const CURSOR_PATTERN = /^v1:(0|[1-9]\d*)$/;
const MAX_CURSOR_LENGTH = 32; // base64url of `v1:` + a 16-digit safe integer is 26 chars

/** Thrown by `SkillRegistry.list` for a malformed cursor or an offset outside this registry. */
export class InvalidSkillsCursorError extends Error {
  constructor() {
    super('Invalid skills cursor');
    this.name = 'InvalidSkillsCursorError';
  }
}

export function encodeCursor(offset: number): string {
  return Buffer.from(`${CURSOR_VERSION}:${offset}`).toString('base64url');
}

// Strict: only a canonical encoding of an offset that points at a remaining entry is accepted.
export function decodeCursor(cursor: string, total: number): number {
  if (
    cursor.length === 0 ||
    cursor.length > MAX_CURSOR_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(cursor)
  ) {
    throw new InvalidSkillsCursorError();
  }

  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const match = CURSOR_PATTERN.exec(decoded);
  if (!match || encodeCursor(Number(match[1])) !== cursor) {
    throw new InvalidSkillsCursorError();
  }

  const offset = Number(match[1]);
  if (!Number.isSafeInteger(offset) || offset < 1 || offset >= total) {
    throw new InvalidSkillsCursorError();
  }
  return offset;
}
