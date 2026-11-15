// Cursors are opaque to clients: base64url of the next offset in the sorted registry.
// Repeated requests are stable within one registry snapshot. Cursors are not bound to a
// snapshot: after a rebuild, an old cursor may point at different entries if it remains in range.
const CURSOR_PATTERN = /^(0|[1-9]\d*)$/;
const MAX_CURSOR_LENGTH = 32; // base64url of a 16-digit safe integer is 22 chars

/** Thrown by `SkillRegistry.list` for a malformed cursor or an offset outside this registry. */
export class InvalidSkillsCursorError extends Error {
  constructor() {
    super('Invalid skills cursor');
    this.name = 'InvalidSkillsCursorError';
  }
}

export function encodeCursor(offset: number): string {
  return Buffer.from(String(offset)).toString('base64url');
}

// Strict: only a canonical encoding of an offset that points at a remaining entry is accepted.
export function decodeCursor(cursor: string, total: number): number {
  if (cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH) {
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
