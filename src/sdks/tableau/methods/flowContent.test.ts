import { MAX_FLOW_FILE_BYTES } from './flowPackage.js';
import FlowsMethods from './flowsMethods.js';

const mock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../routeSafety/zodios.js', () => ({
  createGuardedZodios: () => ({ axios: { get: mock.get } }),
  installRouteGuards: vi.fn(),
}));
const flowId = '11111111-1111-4111-8111-111111111111';
describe('bounded native Flow content download', () => {
  beforeEach(() => vi.clearAllMocks());
  it('uses the guarded read route, cancellation, body cap and no redirects', async () => {
    const methods = new FlowsMethods(
      'https://example.invalid/api/3.30',
      { type: 'Bearer', token: 'test' },
      {},
    );
    mock.get.mockResolvedValue({ data: Buffer.from('PK') });
    const signal = new AbortController().signal;
    expect(await methods.downloadFlowContent({ siteId: 'site', flowId, signal })).toEqual(
      Buffer.from('PK'),
    );
    expect(mock.get).toHaveBeenCalledWith(
      '/sites/site/flows/' + flowId + '/content',
      expect.objectContaining({
        responseType: 'arraybuffer',
        maxContentLength: MAX_FLOW_FILE_BYTES,
        maxBodyLength: MAX_FLOW_FILE_BYTES,
        maxRedirects: 0,
        signal,
      }),
    );
  });
  it('refuses traversal before any request and rejects oversized returned bytes', async () => {
    const methods = new FlowsMethods(
      'https://example.invalid',
      { type: 'Bearer', token: 'test' },
      {},
    );
    await expect(
      methods.downloadFlowContent({ siteId: 'site', flowId: '../other' }),
    ).rejects.toThrow();
    expect(mock.get).not.toHaveBeenCalled();
    mock.get.mockResolvedValue({ data: Buffer.alloc(MAX_FLOW_FILE_BYTES + 1) });
    await expect(methods.downloadFlowContent({ siteId: 'site', flowId })).rejects.toThrow(
      'byte limit',
    );
  });
});
