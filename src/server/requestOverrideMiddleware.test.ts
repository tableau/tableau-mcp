import { isRequestOverridableVariable } from '../overridableConfig';
import { AuthenticatedRequest } from './oauth/types';
import {
  requestOverrideMiddleware,
  X_TABLEAU_MCP_CONFIG_HEADER,
} from './requestOverrideMiddleware';
import { getHeader } from './requestUtils';

vi.mock('../overridableConfig', () => ({
  isRequestOverridableVariable: vi.fn(),
}));

vi.mock('./requestUtils', () => ({
  getHeader: vi.fn(),
}));

describe('requestOverrideMiddleware', () => {
  const next = vi.fn();
  const res = {} as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call next without setting overrides when header is absent', async () => {
    vi.mocked(getHeader).mockReturnValue('');
    const req = {} as AuthenticatedRequest;

    await requestOverrideMiddleware()(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.overrides).toBeUndefined();
  });

  it('should pass the correct header name to getHeader', async () => {
    vi.mocked(getHeader).mockReturnValue('');
    const req = {} as AuthenticatedRequest;

    await requestOverrideMiddleware()(req, res, next);

    expect(getHeader).toHaveBeenCalledWith(req, X_TABLEAU_MCP_CONFIG_HEADER);
  });

  it('should parse a single override and set it on the request', async () => {
    vi.mocked(getHeader).mockReturnValue('INCLUDE_PROJECT_IDS=abc');
    vi.mocked(isRequestOverridableVariable).mockReturnValue(true);
    const req = {} as AuthenticatedRequest;

    await requestOverrideMiddleware()(req, res, next);

    expect(req.overrides).toEqual({ INCLUDE_PROJECT_IDS: 'abc' });
    expect(next).toHaveBeenCalled();
  });

  it('should parse multiple overrides separated by &', async () => {
    vi.mocked(getHeader).mockReturnValue('INCLUDE_PROJECT_IDS=abc&INCLUDE_TAGS=tag1');
    vi.mocked(isRequestOverridableVariable).mockReturnValue(true);
    const req = {} as AuthenticatedRequest;

    await requestOverrideMiddleware()(req, res, next);

    expect(req.overrides).toEqual({ INCLUDE_PROJECT_IDS: 'abc', INCLUDE_TAGS: 'tag1' });
    expect(next).toHaveBeenCalled();
  });

  it('should accept an empty string value for a valid key', async () => {
    vi.mocked(getHeader).mockReturnValue('INCLUDE_PROJECT_IDS=');
    vi.mocked(isRequestOverridableVariable).mockReturnValue(true);
    const req = {} as AuthenticatedRequest;

    await requestOverrideMiddleware()(req, res, next);

    expect(req.overrides).toEqual({ INCLUDE_PROJECT_IDS: '' });
    expect(next).toHaveBeenCalled();
  });

  it('should throw when a key is not a request-overridable variable', async () => {
    vi.mocked(getHeader).mockReturnValue('INVALID_KEY=value');
    vi.mocked(isRequestOverridableVariable).mockReturnValue(false);
    const req = {} as AuthenticatedRequest;

    await expect(requestOverrideMiddleware()(req, res, next)).rejects.toThrow(
      `'${X_TABLEAU_MCP_CONFIG_HEADER}' header is invalid`,
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('should throw when a valid key has no value', async () => {
    vi.mocked(getHeader).mockReturnValue('INCLUDE_PROJECT_IDS');
    vi.mocked(isRequestOverridableVariable).mockReturnValue(true);
    const req = {} as AuthenticatedRequest;

    await expect(requestOverrideMiddleware()(req, res, next)).rejects.toThrow(
      `'${X_TABLEAU_MCP_CONFIG_HEADER}' header does not provide a value for 'INCLUDE_PROJECT_IDS'`,
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('should throw on the first invalid key in a multi-override header', async () => {
    vi.mocked(getHeader).mockReturnValue('INCLUDE_PROJECT_IDS=abc&BAD_KEY=val');
    vi.mocked(isRequestOverridableVariable).mockImplementation(
      (key) => key === 'INCLUDE_PROJECT_IDS',
    );
    const req = {} as AuthenticatedRequest;

    await expect(requestOverrideMiddleware()(req, res, next)).rejects.toThrow(
      `'${X_TABLEAU_MCP_CONFIG_HEADER}' header is invalid`,
    );
    expect(next).not.toHaveBeenCalled();
  });
});
