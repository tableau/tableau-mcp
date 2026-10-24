import {
  buildWorkbookUploadKey,
  getWorkbookFileType,
  MAX_STAGED_WORKBOOK_BYTES,
  requestStagedWorkbookUpload,
  resolveStagedWorkbookUpload,
} from './stagedWorkbookUpload.js';

const mocks = vi.hoisted(() => ({
  getPresignedUploadUrl: vi.fn(),
  download: vi.fn(),
}));

vi.mock('../../../blobStorage/init.js', () => ({
  getBlobStorageProvider: vi.fn(() => ({
    getPresignedUploadUrl: mocks.getPresignedUploadUrl,
    download: mocks.download,
  })),
}));

const uploadId = '123e4567-e89b-42d3-a456-426614174000';

async function* streamOf(...pieces: string[]): AsyncGenerator<Uint8Array> {
  for (const piece of pieces) {
    yield Buffer.from(piece);
  }
}

describe('requestStagedWorkbookUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPresignedUploadUrl.mockResolvedValue({
      uploadUrl: 'https://blob.example.com/signed-put',
      requiredHeaders: { 'Content-Type': 'application/xml' },
      expiresAt: '2026-08-12T18:05:00.000Z',
    });
  });

  it('returns a presigned upload URL and workbook upload id', async () => {
    const result = await requestStagedWorkbookUpload({
      fileName: 'BoltBikes Workbook.twb',
    });

    expect(result).toMatchObject({
      uploadUrl: 'https://blob.example.com/signed-put',
      expiresAt: '2026-08-12T18:05:00.000Z',
      maxSizeBytes: MAX_STAGED_WORKBOOK_BYTES,
      requiredHeaders: { 'Content-Type': 'application/xml' },
    });
    expect(result.workbookUploadId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(mocks.getPresignedUploadUrl).toHaveBeenCalledWith({
      key: `workbook-uploads/${result.workbookUploadId}/workbook.twb`,
      contentType: 'application/xml',
      maxBytes: MAX_STAGED_WORKBOOK_BYTES,
    });
  });

  it('returns an octet-stream content type for TWBX filenames', async () => {
    mocks.getPresignedUploadUrl.mockResolvedValue({
      uploadUrl: 'https://blob.example.com/signed-put',
      requiredHeaders: { 'Content-Type': 'application/octet-stream' },
      expiresAt: '2026-08-12T18:05:00.000Z',
    });

    const result = await requestStagedWorkbookUpload({
      fileName: 'BoltBikes Workbook.twbx',
    });

    expect(result).toMatchObject({
      requiredHeaders: { 'Content-Type': 'application/octet-stream' },
    });
    expect(mocks.getPresignedUploadUrl).toHaveBeenCalledWith({
      key: `workbook-uploads/${result.workbookUploadId}/workbook.twbx`,
      contentType: 'application/octet-stream',
      maxBytes: MAX_STAGED_WORKBOOK_BYTES,
    });
  });

  it('uses the requiredHeaders and expiresAt returned by the blob storage provider', async () => {
    mocks.getPresignedUploadUrl.mockResolvedValue({
      uploadUrl: 'https://blob.example.com/signed-put',
      requiredHeaders: { 'Content-Type': 'application/xml', 'x-custom-header': 'value' },
      expiresAt: '2099-01-01T00:00:00.000Z',
    });

    const result = await requestStagedWorkbookUpload({
      fileName: 'BoltBikes Workbook.twb',
    });

    expect(result.requiredHeaders).toEqual({
      'Content-Type': 'application/xml',
      'x-custom-header': 'value',
    });
    expect(result.expiresAt).toBe('2099-01-01T00:00:00.000Z');
  });

  it('rejects filenames that are neither TWB nor TWBX', async () => {
    await expect(
      requestStagedWorkbookUpload({
        fileName: 'workbook.xml',
      }),
    ).rejects.toThrow('filename must end in .twb or .twbx');
  });
});

describe('resolveStagedWorkbookUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the staged workbook stream from the .twb key when it exists', async () => {
    mocks.download.mockResolvedValue({ data: streamOf('<work', 'book />'), contentLength: 12 });

    await expect(resolveStagedWorkbookUpload({ workbookUploadId: uploadId })).resolves.toEqual({
      fileName: `${uploadId}.twb`,
      bytes: Buffer.from('<workbook />'),
    });
    expect(mocks.download).toHaveBeenCalledWith({
      key: `workbook-uploads/${uploadId}/workbook.twb`,
      maxBytes: MAX_STAGED_WORKBOOK_BYTES,
    });
    expect(mocks.download).toHaveBeenCalledTimes(1);
  });

  it('falls back to the .twbx key when the .twb key does not exist', async () => {
    mocks.download.mockResolvedValueOnce(undefined);
    mocks.download.mockResolvedValueOnce({ data: streamOf('PK\x03\x04') });

    await expect(resolveStagedWorkbookUpload({ workbookUploadId: uploadId })).resolves.toEqual({
      fileName: `${uploadId}.twbx`,
      bytes: Buffer.from('PK\x03\x04'),
    });
    expect(mocks.download).toHaveBeenNthCalledWith(1, {
      key: `workbook-uploads/${uploadId}/workbook.twb`,
      maxBytes: MAX_STAGED_WORKBOOK_BYTES,
    });
    expect(mocks.download).toHaveBeenNthCalledWith(2, {
      key: `workbook-uploads/${uploadId}/workbook.twbx`,
      maxBytes: MAX_STAGED_WORKBOOK_BYTES,
    });
  });

  it('throws when neither the .twb nor .twbx key exists', async () => {
    mocks.download.mockResolvedValue(undefined);

    await expect(resolveStagedWorkbookUpload({ workbookUploadId: uploadId })).rejects.toThrow(
      'Workbook upload not found',
    );
  });

  it('rejects invalid workbook upload ids', async () => {
    await expect(resolveStagedWorkbookUpload({ workbookUploadId: '../not-safe' })).rejects.toThrow(
      'upload id is invalid',
    );
  });
});

describe('resolveStagedWorkbookUpload limits', () => {
  it('rejects empty uploaded workbook bytes', async () => {
    mocks.download.mockResolvedValue({ data: streamOf() });

    await expect(resolveStagedWorkbookUpload({ workbookUploadId: uploadId })).rejects.toThrow(
      'must not be empty',
    );
  });

  it('rejects a stream that exceeds maxBytes', async () => {
    mocks.download.mockResolvedValue({ data: streamOf('1234', '5678') });

    await expect(
      resolveStagedWorkbookUpload({ workbookUploadId: uploadId, maxBytes: 6 }),
    ).rejects.toThrow('exceeds the maximum allowed size of 6 bytes');
  });

  it('rejects a stream that yields a non-byte chunk', async () => {
    async function* stringChunks(): AsyncGenerator<unknown> {
      yield '1234';
    }
    mocks.download.mockResolvedValue({ data: stringChunks() });

    await expect(
      resolveStagedWorkbookUpload({ workbookUploadId: uploadId, maxBytes: 2 }),
    ).rejects.toThrow('Blob storage provider yielded a non-byte chunk.');
  });
});

describe('buildWorkbookUploadKey', () => {
  it('builds a key without any prefix', () => {
    expect(buildWorkbookUploadKey(uploadId, 'twb')).toBe(
      `workbook-uploads/${uploadId}/workbook.twb`,
    );
  });

  it('includes the file type extension', () => {
    expect(buildWorkbookUploadKey(uploadId, 'twbx')).toBe(
      `workbook-uploads/${uploadId}/workbook.twbx`,
    );
  });
});

describe('getWorkbookFileType', () => {
  it('returns twb for .twb filenames', () => {
    expect(getWorkbookFileType('workbook.twb')).toBe('twb');
  });

  it('returns twbx for .twbx filenames', () => {
    expect(getWorkbookFileType('workbook.twbx')).toBe('twbx');
  });

  it('returns undefined for other extensions', () => {
    expect(getWorkbookFileType('workbook.xml')).toBeUndefined();
  });
});
