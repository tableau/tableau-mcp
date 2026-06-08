import { SanitizeOptions, sanitizeValue } from './sanitize.js';

export function sanitizeForNotification(value: unknown, options: SanitizeOptions = {}): unknown {
  return sanitizeValue(value, {
    maxStringLength: options.maxStringLength,
    seen: new WeakSet<object>(),
    depth: 0,
  });
}
