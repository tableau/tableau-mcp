import { createHash } from 'node:crypto';

/** A whole-document binding is stricter than the source project's per-node
 * binding: upstream steps, connections and parameter changes invalidate it too.
 * Only its digest is returned. No script, connection or model is executed. */
export function prepDocumentSha256(document: unknown): string {
  let count = 0;
  let textBytes = 0;
  const seen = new WeakSet<object>();
  const canonical = (value: unknown, depth: number): unknown => {
    if (++count > 100000 || depth > 40)
      throw new Error('Prep schema binding exceeds its structural limit.');
    if (typeof value === 'string') {
      textBytes += Buffer.byteLength(value);
      if (textBytes > 16 * 1024 * 1024)
        throw new Error('Prep schema binding exceeds its byte limit.');
      return value;
    }
    if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
    if (value === undefined) return null;
    if (typeof value !== 'object' || seen.has(value))
      throw new Error('Unsupported Prep schema binding structure.');
    seen.add(value);
    const result = Array.isArray(value)
      ? value.map((child) => canonical(child, depth + 1))
      : Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => {
              textBytes += Buffer.byteLength(key);
              if (textBytes > 16 * 1024 * 1024)
                throw new Error('Prep schema binding exceeds its byte limit.');
              return [key, canonical((value as Record<string, unknown>)[key], depth + 1)];
            }),
        );
    seen.delete(value);
    return result;
  };
  const json = JSON.stringify(canonical(document, 0));
  if (Buffer.byteLength(json) > 16 * 1024 * 1024)
    throw new Error('Prep schema binding exceeds its byte limit.');
  return createHash('sha256').update(json).digest('hex');
}
