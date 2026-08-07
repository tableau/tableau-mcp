import { describe, expect, it } from 'vitest';

import { buildMultipartMixedBody } from './multipart.js';

describe('buildMultipartMixedBody', () => {
  it('returns a multipart/mixed Content-Type with a boundary', () => {
    const { contentType } = buildMultipartMixedBody([
      { name: 'request_payload', contentType: 'text/xml', data: '' },
    ]);

    expect(contentType).toMatch(/^multipart\/mixed; boundary=[0-9a-f]+$/);
  });

  it('uses a different boundary on each call', () => {
    const first = buildMultipartMixedBody([{ name: 'a', contentType: 'text/xml', data: '' }]);
    const second = buildMultipartMixedBody([{ name: 'a', contentType: 'text/xml', data: '' }]);

    expect(first.contentType).not.toEqual(second.contentType);
  });

  it('builds a single-part body with the exact byte layout Tableau expects', () => {
    const { body, contentType } = buildMultipartMixedBody([
      { name: 'request_payload', contentType: 'text/xml', data: '<tsRequest/>' },
    ]);
    const boundary = contentType.split('boundary=')[1];

    expect(body.toString('latin1')).toEqual(
      `--${boundary}\r\n` +
        'Content-Disposition: name="request_payload"\r\n' +
        'Content-Type: text/xml\r\n' +
        '\r\n' +
        '<tsRequest/>\r\n' +
        `--${boundary}--\r\n`,
    );
  });

  it('builds a multi-part body with a filename on the second part, matching Append-to-File-Upload wire format', () => {
    const chunk = Buffer.from([0x01, 0x02, 0x03]);
    const { body, contentType } = buildMultipartMixedBody([
      { name: 'request_payload', contentType: 'text/xml', data: '' },
      {
        name: 'tableau_file',
        filename: 'file',
        contentType: 'application/octet-stream',
        data: chunk,
      },
    ]);
    const boundary = contentType.split('boundary=')[1];

    const expected = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
          'Content-Disposition: name="request_payload"\r\n' +
          'Content-Type: text/xml\r\n' +
          '\r\n' +
          '\r\n',
        'latin1',
      ),
      Buffer.from(
        `--${boundary}\r\n` +
          'Content-Disposition: name="tableau_file"; filename="file"\r\n' +
          'Content-Type: application/octet-stream\r\n' +
          '\r\n',
        'latin1',
      ),
      chunk,
      Buffer.from(`\r\n--${boundary}--\r\n`, 'latin1'),
    ]);

    expect(body).toEqual(expected);
  });

  it('preserves binary data unmodified (no UTF-8 mangling)', () => {
    const binaryChunk = Buffer.from([0x00, 0xff, 0x80, 0x7f]);
    const { body } = buildMultipartMixedBody([
      {
        name: 'tableau_file',
        filename: 'file',
        contentType: 'application/octet-stream',
        data: binaryChunk,
      },
    ]);

    expect(body.includes(binaryChunk)).toBe(true);
  });
});
