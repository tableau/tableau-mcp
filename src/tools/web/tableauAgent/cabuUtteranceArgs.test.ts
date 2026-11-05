import { decodeUtteranceArgs, encodeUtteranceArgs } from './cabuUtteranceArgs.js';

describe('encodeUtteranceArgs / decodeUtteranceArgs', () => {
  const fields = {
    scope: 'tenant-123',
    datasources: [
      {
        sdmName: 'Superstore',
        datasourceLuid: 'ds-luid-1',
        datasourceName: 'Superstore',
        vdsDatasourceLuid: 'vds-luid-1',
      },
    ],
    localization: { locale: 'en-US', language: 'en' },
    embedded: false,
  };

  it('round-trips the invariant per-conversation fields through base64 JSON', () => {
    const encoded = encodeUtteranceArgs(fields);

    expect(decodeUtteranceArgs(encoded)).toEqual(fields);
  });

  it('produces an opaque (non-JSON-looking) string', () => {
    const encoded = encodeUtteranceArgs(fields);

    expect(() => JSON.parse(encoded)).toThrow();
  });

  it('throws a clear error when the token is not valid base64 JSON', () => {
    expect(() => decodeUtteranceArgs('not-valid-base64-json')).toThrow(
      /utteranceArgs.*invalid|corrupt/i,
    );
  });

  it('throws a clear error when the decoded JSON does not match the expected shape', () => {
    const wrongShape = Buffer.from(JSON.stringify({ foo: 'bar' }), 'utf8').toString('base64');

    expect(() => decodeUtteranceArgs(wrongShape)).toThrow(/utteranceArgs.*invalid|corrupt/i);
  });
});
