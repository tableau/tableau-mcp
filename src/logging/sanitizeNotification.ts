const DEFAULT_MAX_STRING_LENGTH = 8192;
const MAX_DEPTH = 8;

type SanitizeOptions = {
  maxStringLength?: number;
};

type BinaryLike = ArrayBuffer | ArrayBufferView;

export function sanitizeForNotification(value: unknown, options: SanitizeOptions = {}): unknown {
  return sanitizeValue(value, {
    maxStringLength: options.maxStringLength ?? DEFAULT_MAX_STRING_LENGTH,
    seen: new WeakSet<object>(),
    depth: 0,
  });
}

function sanitizeValue(
  value: unknown,
  context: { maxStringLength: number; seen: WeakSet<object>; depth: number },
): unknown {
  if (typeof value === 'string') {
    return sanitizeString(value, context.maxStringLength);
  }

  if (isBinaryLike(value)) {
    return getBinaryRedaction(value);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  if (context.seen.has(value)) {
    return '[Circular notification value]';
  }

  if (context.depth >= MAX_DEPTH) {
    return '[Notification value exceeds maximum depth]';
  }

  context.seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, { ...context, depth: context.depth + 1 }));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    sanitized[key] = sanitizeValue(nestedValue, {
      ...context,
      depth: context.depth + 1,
    });
  }

  return sanitized;
}

function sanitizeString(value: string, maxStringLength: number): unknown {
  if (value.length <= maxStringLength) {
    return value;
  }

  if (isSvgOrXml(value)) {
    return {
      redacted: true,
      reason: 'svg-xml-payload',
      message: '[redacted large SVG/XML payload]',
      mimeTypeGuess: 'image/svg+xml',
      originalLength: value.length,
      threshold: maxStringLength,
    };
  }

  const imageMimeType = getBase64ImageMimeType(value);
  if (imageMimeType) {
    return {
      redacted: true,
      reason: 'base64-image-payload',
      message: '[redacted large base64 image payload]',
      mimeTypeGuess: imageMimeType,
      originalLength: value.length,
      threshold: maxStringLength,
    };
  }

  return {
    truncated: true,
    reason: 'oversized-string',
    message: '[truncated oversized string]',
    value: value.slice(0, maxStringLength),
    originalLength: value.length,
    threshold: maxStringLength,
  };
}

function isBinaryLike(value: unknown): value is BinaryLike {
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value);
}

function getBinaryRedaction(value: BinaryLike): Record<string, unknown> {
  return {
    redacted: true,
    reason: 'binary-payload',
    message: '[redacted binary payload]',
    kind: Buffer.isBuffer(value) ? 'Buffer' : value.constructor.name,
    byteLength: value.byteLength,
  };
}

function isSvgOrXml(value: string): boolean {
  return /^\s*(<\?xml|<svg\b)/i.test(value);
}

function getBase64ImageMimeType(value: string): string | undefined {
  if (!isBase64Like(value)) {
    return undefined;
  }

  if (value.startsWith('iVBOR')) {
    return 'image/png';
  }

  if (value.startsWith('/9j/')) {
    return 'image/jpeg';
  }

  if (value.startsWith('R0lGOD')) {
    return 'image/gif';
  }

  if (value.startsWith('UklGR')) {
    return 'image/webp';
  }

  return undefined;
}

function isBase64Like(value: string): boolean {
  return value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}
