import { isRequestOverridableVariable } from '../overridableConfig.js';
import { getRequestOverridesFromHeader, getToolNameFromRequestBody } from './requestUtils.js';

vi.mock('../overridableConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../overridableConfig')>();
  return {
    ...actual,
    isRequestOverridableVariable: vi.fn(actual.isRequestOverridableVariable),
  };
});

describe('getRequestOverridesFromHeader', () => {
  beforeEach(() => {
    vi.mocked(isRequestOverridableVariable).mockReset();
  });

  it('should return empty object when header is an empty string', () => {
    expect(getRequestOverridesFromHeader('')).toEqual({});
  });

  it('should parse a single override', () => {
    vi.mocked(isRequestOverridableVariable).mockReturnValue(true);

    expect(getRequestOverridesFromHeader('INCLUDE_PROJECT_IDS=abc')).toEqual({
      INCLUDE_PROJECT_IDS: 'abc',
    });
  });

  it('should parse multiple overrides separated by &', () => {
    vi.mocked(isRequestOverridableVariable).mockReturnValue(true);

    expect(getRequestOverridesFromHeader('INCLUDE_PROJECT_IDS=abc&INCLUDE_TAGS=tag1')).toEqual({
      INCLUDE_PROJECT_IDS: 'abc',
      INCLUDE_TAGS: 'tag1',
    });
  });

  it('should accept an empty string value for a valid key', () => {
    vi.mocked(isRequestOverridableVariable).mockReturnValue(true);

    expect(getRequestOverridesFromHeader('INCLUDE_PROJECT_IDS=')).toEqual({
      INCLUDE_PROJECT_IDS: '',
    });
  });

  it('should throw when a key is not a request-overridable variable', () => {
    vi.mocked(isRequestOverridableVariable).mockReturnValue(false);

    expect(() => getRequestOverridesFromHeader('INVALID_KEY=value')).toThrow(
      "'x-tableau-mcp-config' header is invalid",
    );
  });

  it('should throw when a valid key has no value', () => {
    vi.mocked(isRequestOverridableVariable).mockReturnValue(true);

    expect(() => getRequestOverridesFromHeader('INCLUDE_PROJECT_IDS')).toThrow(
      "'x-tableau-mcp-config' header does not provide a value for 'INCLUDE_PROJECT_IDS'",
    );
  });

  it('should throw on the first invalid key in a multi-override header', () => {
    vi.mocked(isRequestOverridableVariable).mockImplementation(
      (key) => key === 'INCLUDE_PROJECT_IDS',
    );

    expect(() => getRequestOverridesFromHeader('INCLUDE_PROJECT_IDS=abc&BAD_KEY=val')).toThrow(
      "'x-tableau-mcp-config' header is invalid",
    );
  });
});

describe('getToolNamesFromRequestBody', () => {
  it('should extract tool name from a valid CallToolRequest', () => {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get-datasource-metadata', arguments: {} },
    };

    const result = getToolNameFromRequestBody(body);
    expect(result).toEqual('get-datasource-metadata');
  });

  it('should return undefined for non-tool requests', () => {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      },
    };

    const result = getToolNameFromRequestBody(body);
    expect(result).toEqual(undefined);
  });

  it('should return undefined for undefined body', () => {
    const result = getToolNameFromRequestBody(undefined);
    expect(result).toEqual(undefined);
  });

  it('should ignore requests with unrecognized tool names', () => {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'not-a-real-tool', arguments: {} },
    };

    const result = getToolNameFromRequestBody(body);
    expect(result).toEqual(undefined);
  });
});
