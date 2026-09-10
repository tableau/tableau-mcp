import { randomBytes } from 'crypto';

export type MultipartPart = {
  name: string;
  filename?: string;
  contentType: string;
  data: string | Buffer;
  dispositionType?: 'form-data';
};

export function buildMultipartMixedBody(parts: ReadonlyArray<MultipartPart>): {
  body: Buffer;
  contentType: string;
} {
  const boundary = randomBytes(16).toString('hex');

  const chunks: Array<Buffer> = [];
  for (const part of parts) {
    let disposition = `name="${part.name}"`;
    if (part.filename !== undefined) {
      disposition += `; filename="${part.filename}"`;
    }
    if (part.dispositionType !== undefined) {
      disposition = `${part.dispositionType}; ${disposition}`;
    }

    chunks.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: ${disposition}\r\n` +
          `Content-Type: ${part.contentType}\r\n` +
          '\r\n',
        'latin1',
      ),
    );
    chunks.push(typeof part.data === 'string' ? Buffer.from(part.data, 'utf-8') : part.data);
    chunks.push(Buffer.from('\r\n', 'latin1'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'latin1'));

  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/mixed; boundary=${boundary}`,
  };
}
