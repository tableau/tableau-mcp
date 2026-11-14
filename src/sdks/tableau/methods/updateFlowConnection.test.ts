import FlowsMethods from './flowsMethods.js';

describe('Update Flow Connection SDK method', () => {
  it('sends only the requested non-secret fields', async () => {
    const methods = new FlowsMethods(
      'https://tableau.example',
      { type: 'Bearer', token: 'test' },
      {},
    );
    const connection = { id: 'connection', serverAddress: 'new.example' };
    const updateFlowConnection = vi.fn().mockResolvedValue({ connection });
    Object.defineProperty(methods, '_apiClient', { value: { updateFlowConnection } });
    expect(
      await methods.updateFlowConnection({
        siteId: 'site',
        flowId: 'flow',
        connectionId: 'connection',
        updates: { serverAddress: 'new.example' },
      }),
    ).toEqual(connection);
    expect(updateFlowConnection).toHaveBeenCalledExactlyOnceWith(
      { connection: { serverAddress: 'new.example' } },
      {
        params: { siteId: 'site', flowId: 'flow', connectionId: 'connection' },
        headers: { Authorization: 'Bearer test' },
      },
    );
  });
  it.each([{}, { serverPort: 0 }])('refuses an invalid update before a write', async (updates) => {
    const methods = new FlowsMethods(
      'https://tableau.example',
      { type: 'Bearer', token: 'test' },
      {},
    );
    const updateFlowConnection = vi.fn();
    Object.defineProperty(methods, '_apiClient', { value: { updateFlowConnection } });
    await expect(
      methods.updateFlowConnection({
        siteId: 'site',
        flowId: 'flow',
        connectionId: 'connection',
        updates,
      }),
    ).rejects.toThrow();
    expect(updateFlowConnection).not.toHaveBeenCalled();
  });
});
