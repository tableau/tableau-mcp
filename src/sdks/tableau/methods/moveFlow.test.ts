import FlowsMethods from './flowsMethods.js';

describe('Update Flow project SDK method', () => {
  it('sends a project-only payload with no owner or content change', async () => {
    const methods = new FlowsMethods(
      'https://tableau.example',
      { type: 'Bearer', token: 'test' },
      {},
    );
    const flow = {
      id: 'flow',
      name: 'Example',
      project: { id: 'project' },
      owner: { id: 'owner' },
    };
    const updateFlow = vi.fn().mockResolvedValue({ flow });
    Object.defineProperty(methods, '_apiClient', { value: { updateFlow } });
    expect(
      await methods.updateFlow({ siteId: 'site', flowId: 'flow', projectId: 'project' }),
    ).toEqual(flow);
    expect(updateFlow).toHaveBeenCalledExactlyOnceWith(
      { flow: { project: { id: 'project' } } },
      { params: { siteId: 'site', flowId: 'flow' }, headers: { Authorization: 'Bearer test' } },
    );
  });
  it('propagates rejection with no second write', async () => {
    const methods = new FlowsMethods(
      'https://tableau.example',
      { type: 'Bearer', token: 'test' },
      {},
    );
    const updateFlow = vi.fn().mockRejectedValue(new Error('Conflict'));
    Object.defineProperty(methods, '_apiClient', { value: { updateFlow } });
    await expect(
      methods.updateFlow({ siteId: 'site', flowId: 'flow', projectId: 'project' }),
    ).rejects.toThrow('Conflict');
    expect(updateFlow).toHaveBeenCalledTimes(1);
  });
});
