import { Err, Ok } from 'ts-results-es';

import { stubDefaultEnvVars } from '../../testShared.js';
import { OAUTH_AUTH_CHALLENGE_GUIDANCE } from '../../utils/authErrorMessage.js';
import { AccessTokenValidator } from './accessTokenValidator.js';
import { authMiddleware } from './authMiddleware.js';
import { AuthenticatedRequest } from './types.js';

// Minimal Express response double capturing status / headers / json body.
function makeRes(): any {
  const res: any = {
    statusCode: undefined as number | undefined,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    headersSent: false,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    header(key: string, value: string) {
      res.headers[key] = value;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
    writeHead: vi.fn(() => res),
    write: vi.fn(),
    end: vi.fn(),
  };
  return res;
}

function makeValidator(result: Ok<any> | Err<string>): AccessTokenValidator {
  return { validate: vi.fn().mockResolvedValue(result) } as unknown as AccessTokenValidator;
}

describe('authMiddleware auth-error wording (W-23757363)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('carries the shared guidance in error_description while keeping the WWW-Authenticate challenge when no token is present', async () => {
    const middleware = authMiddleware(makeValidator(new Err('unused')));
    const req = { headers: {}, method: 'POST', body: {} } as unknown as AuthenticatedRequest;
    const res = makeRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    // The re-auth challenge must remain intact so the OAuth flow still works.
    expect(res.headers['WWW-Authenticate']).toContain('Bearer realm="MCP"');
    expect(res.body.error).toBe('unauthorized');
    expect(res.body.error_description).toContain('Use the OAuth 2.1 flow');
    expect(res.body.error_description).toContain(OAUTH_AUTH_CHALLENGE_GUIDANCE);
  });

  it('carries the shared guidance in error_description for an invalid/expired token', async () => {
    const middleware = authMiddleware(makeValidator(new Err('token expired')));
    const req = {
      headers: { authorization: 'Bearer bad-token' },
      method: 'POST',
      body: {},
    } as unknown as AuthenticatedRequest;
    const res = makeRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('invalid_token');
    // Underlying validation detail is preserved, followed by the shared guidance.
    expect(res.body.error_description).toContain('token expired');
    expect(res.body.error_description).toContain(OAUTH_AUTH_CHALLENGE_GUIDANCE);
  });
});
