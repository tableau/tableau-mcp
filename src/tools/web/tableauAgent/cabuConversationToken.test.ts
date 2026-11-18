import { decodeConversationToken, encodeConversationToken } from './cabuConversationToken.js';

describe('encodeConversationToken / decodeConversationToken', () => {
  const fields = {
    conversationId: 'conversation-1',
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

  it('round-trips the conversation fields through base64 JSON', () => {
    const encoded = encodeConversationToken(fields);

    expect(decodeConversationToken(encoded)).toEqual(fields);
  });

  it('produces an opaque (non-JSON-looking) string', () => {
    const encoded = encodeConversationToken(fields);

    expect(() => JSON.parse(encoded)).toThrow();
  });

  it('throws a clear error when the token is not valid base64 JSON', () => {
    expect(() => decodeConversationToken('not-valid-base64-json')).toThrow(
      /conversationToken.*invalid|corrupt/i,
    );
  });

  it.each([
    ['does not match the expected shape', { foo: 'bar' }],
    ['is missing the conversationId', { ...fields, conversationId: undefined }],
  ])('throws a clear error when the decoded JSON %s', (_, value) => {
    const token = Buffer.from(JSON.stringify(value), 'utf8').toString('base64');

    expect(() => decodeConversationToken(token)).toThrow(/conversationToken.*invalid|corrupt/i);
  });
});
