/** Reads normalized response headers while preserving the existing workbook contract. */
export function getHeader(headers: Record<string, unknown>, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === 'string' ? first : undefined;
  }
  return typeof value === 'string' ? value : undefined;
}

/** Prefers an extended UTF-8 filename, independently of parameter order. */
export function getFilenameFromContentDisposition(
  contentDispositionHeader: string | undefined,
): string | undefined {
  if (!contentDispositionHeader) return undefined;

  let legacyFilename: string | undefined;
  const parameter = /(?:^|;)\s*([^\s=;]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]*))/g;
  for (const [, name, quoted, unquoted] of contentDispositionHeader.matchAll(parameter)) {
    const value = (quoted ?? unquoted).trim();
    if (!value) continue;
    const normalized = name.toLowerCase();
    if (normalized === 'filename') {
      legacyFilename ??= value;
    } else if (normalized === 'filename*') {
      const extended = /^UTF-8'[^']*'(.+)$/i.exec(value);
      if (!extended) continue;
      try {
        return decodeURIComponent(extended[1]);
      } catch {
        return extended[1];
      }
    }
  }
  return legacyFilename;
}
