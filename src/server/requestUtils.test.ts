import { getToolNameFromRequestBody } from './requestUtils.js';

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

  it('should return empty array for non-tool requests', () => {
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

  it('should return empty array for undefined body', () => {
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
