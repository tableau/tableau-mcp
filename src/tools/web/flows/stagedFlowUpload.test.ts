import { requestStagedFlowUpload, resolveStagedFlowUpload } from './stagedFlowUpload.js';

const mocks = vi.hoisted(() => ({ request: vi.fn(), resolve: vi.fn() }));
vi.mock('../stagedUpload.js', async (original) => ({
  ...(await original<typeof import('../stagedUpload.js')>()),
  requestStagedUpload: mocks.request,
  resolveStagedUpload: mocks.resolve,
}));
const config = { bucket: 'bucket', region: 'region', keyPrefix: 'tenant/', presignTtlSeconds: 60 };
describe('flow staging contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.request.mockResolvedValue({ uploadId: 'id', maxSizeBytes: 5000000000 });
    mocks.resolve.mockResolvedValue({ fileName: 'flow.tfl', bytes: Buffer.from('{}') });
  });
  it('uses an independent namespace and binary content type for TFL', async () => {
    expect(await requestStagedFlowUpload({ fileName: 'Example.tfl', config })).toEqual({
      flowUploadId: 'id',
      maxSizeBytes: 256 * 1024 * 1024,
    });
    expect(mocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: expect.objectContaining({
          prefixSegment: 'flow-uploads',
          fileTypes: ['tfl', 'tflx'],
          contentTypes: { tfl: 'application/octet-stream' },
        }),
      }),
    );
  });
  it('enforces the flow-specific maximum even if a caller supplies a higher limit', async () => {
    await resolveStagedFlowUpload({ flowUploadId: 'id', config, maxBytes: 5000000000 });
    expect(mocks.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ maxBytes: 256 * 1024 * 1024 }),
    );
  });
});
