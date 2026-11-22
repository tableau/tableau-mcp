import FlowsMethods from './flowsMethods.js';

describe('authoring native flow download', () => {
  const luid = '11111111-1111-4111-8111-111111111111';
  function client(data: Buffer): { methods: FlowsMethods; get: ReturnType<typeof vi.fn> } {
    const methods = new FlowsMethods(
      'https://tableau.invalid/api/3.30',
      { type: 'Bearer', token: 'DUMMY' },
      {},
    );
    const get = vi.fn().mockResolvedValue({ data });
    Object.defineProperty(methods, '_apiClient', { value: { axios: { get } } });
    return { methods, get };
  }
  it('uses only the validated content endpoint with byte/redirect/cancellation guards', async () => {
    const { methods, get } = client(Buffer.from('native'));
    const signal = new AbortController().signal;
    expect(await methods.downloadFlowContent({ siteId: luid, flowId: luid, signal })).toEqual(
      Buffer.from('native'),
    );
    expect(get).toHaveBeenCalledWith(
      `/sites/${luid}/flows/${luid}/content`,
      expect.objectContaining({
        responseType: 'arraybuffer',
        maxContentLength: 32 * 1024 * 1024,
        maxRedirects: 0,
        signal,
      }),
    );
  });
  it.each(['../auth', 'x?query=1', 'not-a-luid'])(
    'rejects unsafe flow identity %s before a request',
    async (flowId) => {
      const { methods, get } = client(Buffer.from('native'));
      await expect(methods.downloadFlowContent({ siteId: luid, flowId })).rejects.toThrow();
      expect(get).not.toHaveBeenCalled();
    },
  );
  it.each([0, 32 * 1024 * 1024 + 1])(
    'rejects an empty/oversized %s-byte result',
    async (length) => {
      const { methods } = client(Buffer.alloc(length));
      await expect(methods.downloadFlowContent({ siteId: luid, flowId: luid })).rejects.toThrow();
    },
  );
});
