import { mcpTokenSchema } from './schemas.js';

// schemas.js -> passthroughAuthMiddleware.js -> restApi.js pulls in axios only for its type.
vi.mock('../../sdks/tableau/restApi.js', () => ({ RestApi: class {} }));

describe('mcpTokenSchema', () => {
  it.each([
    [{ grant_type: 'password' }, 'password'],
    [{}, 'undefined'],
  ])('names the allowed grant types when grant_type is %j', (body, received) => {
    const result = mcpTokenSchema.safeParse(body);

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe(
      `grant_type must be 'authorization_code' | 'refresh_token' | 'client_credentials', got '${received}'.`,
    );
  });
});
