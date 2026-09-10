import { getTelemetryProvider } from '../../telemetry/init.js';
import { downloadObjectFromS3, exportedForTesting, uploadBufferToS3 } from './s3Client.js';

const mockSend = vi.hoisted(() => vi.fn());
const mockGetSignedUrl = vi.hoisted(() =>
  vi.fn().mockResolvedValue('https://signed-url.example.com'),
);

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: mockSend })),
  PutObjectCommand: vi.fn().mockImplementation((input) => ({ input })),
  GetObjectCommand: vi.fn().mockImplementation((input) => ({ input })),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}));

vi.mock('../../telemetry/init.js', () => ({
  getTelemetryProvider: vi.fn(),
}));

describe('s3Client span tracing', () => {
  const bucket = 'test-bucket';
  const region = 'us-east-1';
  const key = 'test-key';

  beforeEach(() => {
    vi.clearAllMocks();
    exportedForTesting.resetS3Bundle();
    mockGetSignedUrl.mockResolvedValue('https://signed-url.example.com');
  });

  describe('uploadBufferToS3', () => {
    it('starts and ends a span around the S3 PutObjectCommand on success', async () => {
      mockSend.mockResolvedValue({});
      const mockSpan = { end: vi.fn() };
      const mockProvider = {
        initialize: vi.fn(),
        recordMetric: vi.fn(),
        recordHistogram: vi.fn(),
        startSpan: vi.fn().mockReturnValue(mockSpan),
      };
      vi.mocked(getTelemetryProvider).mockReturnValue(mockProvider);

      await uploadBufferToS3(Buffer.from('hello'), {
        key,
        contentType: 'text/plain',
        bucket,
        region,
        presignTtlSeconds: 60,
      });

      expect(mockProvider.startSpan).toHaveBeenCalledWith('tableau.s3.upload', { bucket, key });
      expect(mockSpan.end).toHaveBeenCalledWith(undefined);
    });

    it('ends the span with the error and rethrows when the upload fails', async () => {
      const uploadError = new Error('upload failed');
      mockSend.mockRejectedValue(uploadError);
      const mockSpan = { end: vi.fn() };
      const mockProvider = {
        initialize: vi.fn(),
        recordMetric: vi.fn(),
        recordHistogram: vi.fn(),
        startSpan: vi.fn().mockReturnValue(mockSpan),
      };
      vi.mocked(getTelemetryProvider).mockReturnValue(mockProvider);

      await expect(
        uploadBufferToS3(Buffer.from('hello'), {
          key,
          contentType: 'text/plain',
          bucket,
          region,
          presignTtlSeconds: 60,
        }),
      ).rejects.toBe(uploadError);

      expect(mockSpan.end).toHaveBeenCalledWith(uploadError);
    });
  });

  describe('downloadObjectFromS3', () => {
    it('starts and ends a span around the S3 GetObjectCommand on success', async () => {
      mockSend.mockResolvedValue({ Body: Buffer.from('hello') });
      const mockSpan = { end: vi.fn() };
      const mockProvider = {
        initialize: vi.fn(),
        recordMetric: vi.fn(),
        recordHistogram: vi.fn(),
        startSpan: vi.fn().mockReturnValue(mockSpan),
      };
      vi.mocked(getTelemetryProvider).mockReturnValue(mockProvider);

      const result = await downloadObjectFromS3({ key, bucket, region, maxBytes: 1024 });

      expect(mockProvider.startSpan).toHaveBeenCalledWith('tableau.s3.download', { bucket, key });
      expect(mockSpan.end).toHaveBeenCalledWith(undefined);
      expect(result.toString()).toBe('hello');
    });

    it('ends the span with the error and rethrows when the download fails', async () => {
      const downloadError = new Error('download failed');
      mockSend.mockRejectedValue(downloadError);
      const mockSpan = { end: vi.fn() };
      const mockProvider = {
        initialize: vi.fn(),
        recordMetric: vi.fn(),
        recordHistogram: vi.fn(),
        startSpan: vi.fn().mockReturnValue(mockSpan),
      };
      vi.mocked(getTelemetryProvider).mockReturnValue(mockProvider);

      await expect(downloadObjectFromS3({ key, bucket, region, maxBytes: 1024 })).rejects.toBe(
        downloadError,
      );

      expect(mockSpan.end).toHaveBeenCalledWith(downloadError);
    });
  });
});
