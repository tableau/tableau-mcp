import { getToolNamesFromRequestBody } from './requestUtils.js';

describe('getToolNamesFromRequestBody', () => {
  it('should extract tool name from a valid CallToolRequest', () => {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get-datasource-metadata', arguments: {} },
    };

    const result = getToolNamesFromRequestBody(body);
    expect(result).toEqual(['get-datasource-metadata']);
  });

  it('should extract multiple tool names from a batched request', () => {
    const body = [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get-datasource-metadata', arguments: {} },
      },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'list-datasources', arguments: {} },
      },
    ];

    const result = getToolNamesFromRequestBody(body);
    expect(result).toEqual(['get-datasource-metadata', 'list-datasources']);
  });

  it('should return empty array for non-tool requests', () => {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
    };

    const result = getToolNamesFromRequestBody(body);
    expect(result).toEqual([]);
  });

  it('should return empty array for undefined body', () => {
    const result = getToolNamesFromRequestBody(undefined);
    expect(result).toEqual([]);
  });

  it('should deduplicate tool names', () => {
    const body = [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get-datasource-metadata', arguments: {} },
      },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'get-datasource-metadata', arguments: {} },
      },
    ];

    const result = getToolNamesFromRequestBody(body);
    expect(result).toEqual(['get-datasource-metadata']);
  });

  it('should ignore requests with unrecognized tool names', () => {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'not-a-real-tool', arguments: {} },
    };

    const result = getToolNamesFromRequestBody(body);
    expect(result).toEqual([]);
  });
});
