/** Reads normalized response headers while preserving the existing workbook contract. */
export function getHeader(headers: Record<string, unknown>, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === 'string' ? first : undefined;
  }
  return typeof value === 'string' ? value : undefined;
}

/** Parses UTF-8, quoted and unquoted filenames without changing malformed encoded values. */
export function getFilenameFromContentDisposition(
  contentDispositionHeader: string | undefined,
): string | undefined {
  if (!contentDispositionHeader) {
    return undefined;
  }

  const match = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"|filename=([^;]+)/i.exec(
    contentDispositionHeader,
  );
  const encodedOrQuotedOrRaw = match?.[1] ?? match?.[2] ?? match?.[3];
  if (!encodedOrQuotedOrRaw) {
    return undefined;
  }

  const filename = encodedOrQuotedOrRaw.trim();
  if (!filename) {
    return undefined;
  }

  if (match?.[1]) {
    try {
      return decodeURIComponent(filename);
    } catch {
      return filename;
    }
  }

  return filename;
}
