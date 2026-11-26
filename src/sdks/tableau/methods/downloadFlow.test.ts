import FlowsMethods from './flowsMethods.js';

const flowId = '96a43833-27db-40b6-aa80-751efc776b9a';
const setup = (): { methods: FlowsMethods; get: ReturnType<typeof vi.fn> } => {
  const methods = new FlowsMethods(
    'https://tableau.example',
    { type: 'Bearer', token: 'test' },
    {},
  );
  const get = vi.fn().mockResolvedValue({
    data: Buffer.from('{"flow":{}}'),
    headers: {
      'content-type': 'application/json',
      'content-disposition': "attachment; filename*=UTF-8''Example%20Flow.tfl",
    },
  });
  Object.defineProperty(methods, '_apiClient', { value: { axios: { get } } });
  return { methods, get };
};
describe('Download Flow REST method', () => {
  it('preserves content bytes and decodes a UTF-8 filename', async () => {
    const { methods, get } = setup();
    expect(await methods.downloadFlow({ siteId: 'site', flowId })).toEqual({
      content: Buffer.from('{"flow":{}}'),
      contentType: 'application/json',
      filename: 'Example Flow.tfl',
    });
    expect(get).toHaveBeenCalledWith(`/sites/site/flows/${flowId}/content`, {
      headers: { Authorization: 'Bearer test' },
      responseType: 'arraybuffer',
      maxContentLength: 256 * 1024 * 1024,
    });
  });
  it('keeps packaged flow binary bytes unchanged', async () => {
    const { methods, get } = setup();
    const bytes = Buffer.from([0x50, 0x4b, 3, 4, 0, 255]);
    get.mockResolvedValue({ data: bytes, headers: {} });
    expect((await methods.downloadFlow({ siteId: 'site', flowId })).content).toEqual(bytes);
  });
  it('refuses route traversal before a request', async () => {
    const { methods, get } = setup();
    await expect(methods.downloadFlow({ siteId: 'site', flowId: '../other' })).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
  });
  it('does not retry a failed download', async () => {
    const { methods, get } = setup();
    get.mockRejectedValue(new Error('Forbidden'));
    await expect(methods.downloadFlow({ siteId: 'site', flowId })).rejects.toThrow('Forbidden');
    expect(get).toHaveBeenCalledTimes(1);
  });
});
