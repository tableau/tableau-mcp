import FlowsMethods from './flowsMethods.js';

const projectId = '1f13d4b2-7e91-4680-a5a0-96e65e8b1234';
describe('Publish Flow SDK method', () => {
  it.each(['tfl', 'tflx'] as const)(
    'commits a %s upload using escaped XML and explicit overwrite semantics',
    async (flowType) => {
      const methods = new FlowsMethods(
        'https://tableau.example',
        { type: 'Bearer', token: 'test' },
        {},
      );
      const flow = { id: 'flow', name: 'Example', project: { id: projectId, name: 'Default' } };
      const post = vi.fn().mockResolvedValue({ data: { flow } });
      Object.defineProperty(methods, '_apiClient', { value: { axios: { post } } });
      expect(
        await methods.publishFlow({
          siteId: 'site',
          uploadSessionId: 'upload',
          flowType,
          projectId,
          name: 'A & "B" <flow>',
        }),
      ).toEqual(flow);
      const [path, body, config] = post.mock.calls[0];
      expect(path).toBe('/sites/site/flows');
      expect(body.toString()).toContain('A &amp; &quot;B&quot; &lt;flow&gt;');
      expect(config.params).toEqual({ uploadSessionId: 'upload', flowType, overwrite: false });
      expect(config.headers.Authorization).toBe('Bearer test');
    },
  );
  it('refuses an invalid destination before a request', async () => {
    const methods = new FlowsMethods(
      'https://tableau.example',
      { type: 'Bearer', token: 'test' },
      {},
    );
    const post = vi.fn();
    Object.defineProperty(methods, '_apiClient', { value: { axios: { post } } });
    await expect(
      methods.publishFlow({
        siteId: 'site',
        uploadSessionId: 'upload',
        flowType: 'tfl',
        projectId: '../other',
        name: 'Example',
      }),
    ).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });
  it('does not surface undocumented fields from a publish response', async () => {
    const methods = new FlowsMethods(
      'https://tableau.example',
      { type: 'Bearer', token: 'test' },
      {},
    );
    const post = vi.fn().mockResolvedValue({
      data: { flow: { id: 'flow', name: 'Example', password: 'private-sentinel' } },
    });
    Object.defineProperty(methods, '_apiClient', { value: { axios: { post } } });
    expect(
      await methods.publishFlow({
        siteId: 'site',
        uploadSessionId: 'upload',
        flowType: 'tfl',
        projectId,
        name: 'Example',
      }),
    ).toEqual({ id: 'flow', name: 'Example' });
  });
});
