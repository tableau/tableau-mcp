import { tmpdir } from 'os';
import { join } from 'path';
import { addAbortSignal, Readable } from 'stream';

import { MAX_PUBLISH_FILE_BYTES, readPublishingFile } from './readPublishingFile.js';

const mocks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('fs/promises', () => ({ open: mocks.open }));

describe('readPublishingFile', () => {
  let body: Readable;
  const file = {
    stat: vi.fn(),
    createReadStream: vi.fn(),
    close: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    body = Readable.from([Buffer.from('abc'), Buffer.from('def')]);
    file.stat.mockResolvedValue({ size: 6 });
    file.createReadStream.mockImplementation(({ signal }: { signal?: AbortSignal }) =>
      signal ? addAbortSignal(signal, body) : body,
    );
    file.close.mockResolvedValue(undefined);
    mocks.open.mockResolvedValue(file);
  });

  it('uses a 100 MiB default and closes the stream and file after success', async () => {
    expect(MAX_PUBLISH_FILE_BYTES).toBe(100 * 1024 * 1024);
    await expect(readPublishingFile('/tmp/file.tds')).resolves.toEqual(Buffer.from('abcdef'));
    expect(mocks.open).toHaveBeenCalledWith('/tmp/file.tds', 'r');
    expect(body.destroyed).toBe(true);
    expect(file.close).toHaveBeenCalledOnce();
  });

  it('rejects an oversized stat before creating a stream and closes the file', async () => {
    file.stat.mockResolvedValue({ size: MAX_PUBLISH_FILE_BYTES + 1 });
    await expect(readPublishingFile('/tmp/file.tds')).rejects.toThrow('104857600-byte limit');
    expect(file.createReadStream).not.toHaveBeenCalled();
    expect(file.close).toHaveBeenCalledOnce();
  });

  it('rejects a file that grows past the limit after stat and releases both resources', async () => {
    file.stat.mockResolvedValue({ size: 1 });
    await expect(readPublishingFile('/tmp/file.tds', { maxBytes: 5 })).rejects.toThrow(
      '5-byte limit',
    );
    expect(body.destroyed).toBe(true);
    expect(file.close).toHaveBeenCalledOnce();
  });

  it('rejects cancellation before opening a file', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      readPublishingFile('/tmp/file.tds', { abortSignal: controller.signal }),
    ).rejects.toThrow('aborted');
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it('cancels an in-progress read and closes the stream and file', async () => {
    const controller = new AbortController();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    body = new Readable({ read: () => markStarted() });
    const reading = readPublishingFile('/tmp/file.tds', { abortSignal: controller.signal });
    const rejected = expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    await started;
    controller.abort();
    await rejected;
    expect(body.destroyed).toBe(true);
    expect(file.close).toHaveBeenCalledOnce();
    expect(file.createReadStream).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal, autoClose: false }),
    );
  });

  it('closes the file if stat fails', async () => {
    file.stat.mockRejectedValueOnce(new Error('stat failed'));
    await expect(readPublishingFile('/tmp/file.tds')).rejects.toThrow('stat failed');
    expect(file.close).toHaveBeenCalledOnce();
  });

  it('closes both resources if the stream fails', async () => {
    body = new Readable({
      read() {
        this.destroy(new Error('read failed'));
      },
    });
    await expect(readPublishingFile('/tmp/file.tds')).rejects.toThrow('read failed');
    expect(body.destroyed).toBe(true);
    expect(file.close).toHaveBeenCalledOnce();
  });
});

describe('readPublishingFile with real filesystem handles', () => {
  let directory: string;
  let filePath: string;
  let file: Awaited<ReturnType<typeof import('fs/promises').open>>;
  let fs: typeof import('fs/promises');

  beforeEach(async () => {
    fs = await vi.importActual<typeof import('fs/promises')>('fs/promises');
    directory = await fs.mkdtemp(join(tmpdir(), 'publishing-file-'));
    filePath = join(directory, 'source.tds');
    await fs.writeFile(filePath, 'abc');
    file = await fs.open(filePath, 'r');
    mocks.open.mockResolvedValue(file);
  });

  afterEach(async () => {
    await file.close();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('reads a real file and closes its handle', async () => {
    await expect(readPublishingFile(filePath, { maxBytes: 3 })).resolves.toEqual(
      Buffer.from('abc'),
    );
    expect(file.fd).toBe(-1);
  });

  it('rejects an oversized real file before reading and closes its handle', async () => {
    const createReadStream = vi.spyOn(file, 'createReadStream');
    await expect(readPublishingFile(filePath, { maxBytes: 2 })).rejects.toThrow('2-byte limit');
    expect(createReadStream).not.toHaveBeenCalled();
    expect(file.fd).toBe(-1);
  });

  it('detects real file growth after stat and closes its handle', async () => {
    const stat = file.stat.bind(file);
    vi.spyOn(file, 'stat').mockImplementationOnce(async () => {
      const initial = await stat();
      await fs.appendFile(filePath, 'def');
      return initial;
    });
    await expect(readPublishingFile(filePath, { maxBytes: 5 })).rejects.toThrow('5-byte limit');
    expect(file.fd).toBe(-1);
  });

  it('cancels a real file stream during reading and closes its handle', async () => {
    const controller = new AbortController();
    const createReadStream = file.createReadStream.bind(file);
    vi.spyOn(file, 'createReadStream').mockImplementationOnce((options) => {
      const stream = createReadStream({ ...options, highWaterMark: 1 });
      stream.once('data', () => controller.abort());
      return stream;
    });
    await expect(readPublishingFile(filePath, { abortSignal: controller.signal })).rejects.toThrow(
      'aborted',
    );
    expect(file.fd).toBe(-1);
  });
});
