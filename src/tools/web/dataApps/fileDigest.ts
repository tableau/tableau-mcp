import { createHash } from 'crypto';

/**
 * SHA-256 hex digest of a single workspace file's raw bytes.
 *
 * This is a *per-file* digest, distinct from the whole-workspace digest returned by
 * `upsert-data-app-files`/`patch-data-app-file`. It is returned by `read-data-app-file`,
 * `search-data-app-file`, and `patch-data-app-file` so a caller can pass it back as an edit's
 * `expectedDigest` for optimistic-concurrency checks that are scoped to the one file being edited —
 * a workspace-level digest would spuriously report a conflict whenever any *other* file changed.
 */
export function fileDigest(content: string | Uint8Array): string {
  const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
  return createHash('sha256').update(bytes).digest('hex');
}
