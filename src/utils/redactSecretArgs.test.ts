import { REDACTED_VALUE, redactSecretArgs } from './redactSecretArgs.js';

describe('redactSecretArgs', () => {
  it('redacts confirmation and approval tokens, case-insensitively and at depth', () => {
    const args = {
      workbookId: 'wb-1',
      confirmationToken: 'v1.123.abc.def.mac',
      ApprovalToken: 'v1.456.ghi.jkl.mac',
      nested: { items: [{ secret: 's3cr3t', name: 'keep' }], password: 'pw' },
    };
    expect(redactSecretArgs(args)).toEqual({
      workbookId: 'wb-1',
      confirmationToken: REDACTED_VALUE,
      ApprovalToken: REDACTED_VALUE,
      nested: { items: [{ secret: REDACTED_VALUE, name: 'keep' }], password: REDACTED_VALUE },
    });
  });

  it('redacts every listed key (case-insensitive)', () => {
    const keys = [
      'confirmationToken',
      'approvalToken',
      'token',
      'secret',
      'password',
      'accessToken',
      'refreshToken',
      'ACCESSTOKEN',
    ];
    const out = redactSecretArgs(Object.fromEntries(keys.map((k) => [k, 'value']))) as Record<
      string,
      unknown
    >;
    for (const key of keys) {
      expect(out[key]).toBe(REDACTED_VALUE);
    }
  });

  it('does NOT redact pagination cursors or other token-suffixed non-secret args', () => {
    const args = {
      pageToken: 'cursor-1',
      nextPageToken: 'cursor-2',
      next_page_token: 'cursor-3',
      progressToken: 7,
      hasToken: true,
      tokenId: 'id-1',
    };
    expect(redactSecretArgs(args)).toEqual(args);
  });

  it('leaves empty / absent secret values as they are (so logs still show "not supplied")', () => {
    expect(redactSecretArgs({ confirmationToken: '', approvalToken: undefined })).toEqual({
      confirmationToken: '',
      approvalToken: undefined,
    });
  });

  it('does not mutate the input and passes non-object values through', () => {
    const args = { confirmationToken: 'v1.x', other: 1 };
    const out = redactSecretArgs(args);
    expect(args.confirmationToken).toBe('v1.x');
    expect(out).not.toBe(args);
    expect(redactSecretArgs('plain')).toBe('plain');
    expect(redactSecretArgs(undefined)).toBeUndefined();
    expect(redactSecretArgs(null)).toBeNull();
  });
});
