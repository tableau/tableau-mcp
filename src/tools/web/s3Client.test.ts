import { Readable } from 'stream';

import {
  downloadObjectFromS3,
  downloadObjectFromS3IfExists,
  exportedForTesting,
} from './s3Client.js';

const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: mocks.send })),
  PutObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn().mockImplementation((input) => ({ input })),
}));
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: vi.fn() }));

const options = { key: 'file', bucket: 'bucket', region: 'us-east-1', maxBytes: 5 };

describe('downloadObjectFromS3', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.send.mockReset();
    exportedForTesting.resetS3Bundle();
  });

  it('bounds a streamed body and releases it after success without a required signal', async () => {
    const body = Readable.from([Buffer.from('abc'), Buffer.from('de')]);
    mocks.send.mockResolvedValue({ Body: body });
    await expect(downloadObjectFromS3(options)).resolves.toEqual(Buffer.from('abcde'));
    expect(body.destroyed).toBe(true);
    expect(mocks.send).toHaveBeenCalledWith({ input: { Bucket: 'bucket', Key: 'file' } });
  });

  it.each([6, -1, 'invalid'])(
    'rejects ContentLength %s before reading and destroys the body',
    async (ContentLength) => {
      const read = vi.fn();
      const body = new Readable({ read });
      mocks.send.mockResolvedValue({ Body: body, ContentLength });
      await expect(downloadObjectFromS3(options)).rejects.toThrow(
        ContentLength === 6 ? '5-byte limit' : 'invalid byte length',
      );
      expect(read).not.toHaveBeenCalled();
      expect(body.destroyed).toBe(true);
    },
  );

  it('rejects streamed overflow even when ContentLength is smaller and destroys the body', async () => {
    const body = Readable.from([Buffer.from('abc'), Buffer.from('def')]);
    mocks.send.mockResolvedValue({ Body: body, ContentLength: 1 });
    await expect(downloadObjectFromS3(options)).rejects.toThrow('5-byte limit');
    expect(body.destroyed).toBe(true);
  });

  it('passes cancellation to GetObject and destroys a body while awaiting its next chunk', async () => {
    const controller = new AbortController();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const body = new Readable({ read: () => markStarted() });
    mocks.send.mockResolvedValue({ Body: body });
    const download = downloadObjectFromS3({ ...options, abortSignal: controller.signal });
    const rejected = expect(download).rejects.toMatchObject({ name: 'AbortError' });
    await started;
    controller.abort();
    await rejected;
    expect(body.destroyed).toBe(true);
    expect(mocks.send).toHaveBeenCalledWith(expect.anything(), {
      abortSignal: controller.signal,
    });
  });

  it('does not send a pre-cancelled request', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      downloadObjectFromS3({ ...options, abortSignal: controller.signal }),
    ).rejects.toThrow('aborted');
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('destroys a body returned after cancellation while GetObject is pending', async () => {
    const controller = new AbortController();
    const body = new Readable({ read() {} });
    mocks.send.mockImplementation(() => {
      controller.abort();
      return { Body: body };
    });
    await expect(
      downloadObjectFromS3({ ...options, abortSignal: controller.signal }),
    ).rejects.toThrow('aborted');
    expect(body.destroyed).toBe(true);
  });

  it('preserves non-Node transform bodies and checks the resulting size', async () => {
    const transformToByteArray = vi.fn().mockResolvedValue(Buffer.from('abc'));
    mocks.send.mockResolvedValue({ Body: { transformToByteArray } });
    await expect(downloadObjectFromS3(options)).resolves.toEqual(Buffer.from('abc'));
    transformToByteArray.mockResolvedValue(Buffer.from('abcdef'));
    await expect(downloadObjectFromS3(options)).rejects.toThrow('5-byte limit');
  });

  it('bounds an already buffered body', async () => {
    mocks.send.mockResolvedValue({ Body: Buffer.from('abcdef') });
    await expect(downloadObjectFromS3(options)).rejects.toThrow('5-byte limit');
  });

  it('keeps not-found probes compatible and propagates the supplied signal', async () => {
    const controller = new AbortController();
    mocks.send.mockRejectedValueOnce(Object.assign(new Error('missing'), { name: 'NoSuchKey' }));
    await expect(
      downloadObjectFromS3IfExists({ ...options, abortSignal: controller.signal }),
    ).resolves.toBeUndefined();
    expect(mocks.send).toHaveBeenCalledWith(expect.anything(), {
      abortSignal: controller.signal,
    });
  });

  it('does not turn other S3 failures into a missing upload', async () => {
    mocks.send.mockRejectedValueOnce(new Error('access denied'));
    await expect(downloadObjectFromS3IfExists(options)).rejects.toThrow('access denied');
  });
});
