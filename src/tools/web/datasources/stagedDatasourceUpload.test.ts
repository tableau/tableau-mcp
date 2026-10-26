import {
  buildDatasourceUploadKey,
  getDatasourceFileType,
  MAX_STAGED_DATASOURCE_BYTES,
  requestStagedDatasourceUpload,
  resolveStagedDatasourceUpload,
} from './stagedDatasourceUpload.js';

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

async function* streamOf(...pieces: Array<string | Buffer>): AsyncGenerator<Uint8Array> {
  for (const piece of pieces) {
    yield Buffer.from(piece);
  }
}

describe('requestStagedDatasourceUpload', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it.each([
    ['Sales.tds', 'tds', 'application/xml'],
    ['Sales.TDSX', 'tdsx', 'application/octet-stream'],
  ])(
    'presigns %s with the matching key and content type, and bounded size',
    async (fileName, fileType, contentType) => {
      mocks.getPresignedUploadUrl.mockResolvedValue({
        uploadUrl: 'https://blob.example.com/signed-put',
        requiredHeaders: { 'Content-Type': contentType },
        expiresAt: '2026-10-14T18:05:00.000Z',
      });

      const result = await requestStagedDatasourceUpload({ fileName });

      expect(result.datasourceUploadId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(MAX_STAGED_DATASOURCE_BYTES).toBe(5 * 1000 * 1000 * 1000);
      expect(result).toEqual({
        datasourceUploadId: result.datasourceUploadId,
        uploadUrl: 'https://blob.example.com/signed-put',
        expiresAt: '2026-10-14T18:05:00.000Z',
        maxSizeBytes: 5 * 1000 * 1000 * 1000,
        requiredHeaders: { 'Content-Type': contentType },
      });
      expect(mocks.getPresignedUploadUrl).toHaveBeenCalledExactlyOnceWith({
        key: `datasource-uploads/${result.datasourceUploadId}/datasource.${fileType}`,
        contentType,
        maxBytes: MAX_STAGED_DATASOURCE_BYTES,
      });
    },
  );

  it.each(['Sales.xml', 'Sales.tds.exe', 'Sales', ''])(
    'rejects unsupported filename %j before presigning',
    async (fileName) => {
      await expect(requestStagedDatasourceUpload({ fileName })).rejects.toThrow(
        'Data source upload filename must end in .tds or .tdsx.',
      );
      expect(mocks.getPresignedUploadUrl).not.toHaveBeenCalled();
    },
  );

  it('propagates presign errors', async () => {
    const error = new Error('Unable to presign');
    mocks.getPresignedUploadUrl.mockRejectedValue(error);

    await expect(requestStagedDatasourceUpload({ fileName: 'Sales.tds' })).rejects.toBe(error);
  });
});

describe('resolveStagedDatasourceUpload', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.download.mockImplementation(async () => ({ data: streamOf('<data', 'source />') }));
  });

  function expectedDownload(
    fileType: 'tds' | 'tdsx',
    maxBytes = 5 * 1000 * 1000 * 1000,
  ): { key: string; maxBytes: number } {
    return {
      key: `datasource-uploads/${uploadId}/datasource.${fileType}`,
      maxBytes,
    };
  }

  it('returns TDS bytes and applies the default download limit without looking up TDSX', async () => {
    await expect(resolveStagedDatasourceUpload({ datasourceUploadId: uploadId })).resolves.toEqual({
      fileName: `${uploadId}.tds`,
      bytes: Buffer.from('<datasource />'),
    });

    expect(mocks.download).toHaveBeenCalledExactlyOnceWith(expectedDownload('tds'));
  });

  it('falls back to TDSX only when the TDS object is absent, preserving the byte limit', async () => {
    const bytes = Buffer.from('PK\x03\x04');
    mocks.download
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ data: streamOf(bytes) });

    await expect(
      resolveStagedDatasourceUpload({ datasourceUploadId: uploadId, maxBytes: 4096 }),
    ).resolves.toEqual({ fileName: `${uploadId}.tdsx`, bytes });

    expect(mocks.download).toHaveBeenCalledTimes(2);
    expect(mocks.download).toHaveBeenNthCalledWith(1, expectedDownload('tds', 4096));
    expect(mocks.download).toHaveBeenNthCalledWith(2, expectedDownload('tdsx', 4096));
  });

  it('passes a caller-supplied byte limit to the provider download', async () => {
    await resolveStagedDatasourceUpload({
      datasourceUploadId: uploadId,
      maxBytes: 200 * 1024 * 1024,
    });

    expect(mocks.download).toHaveBeenCalledExactlyOnceWith(
      expectedDownload('tds', 200 * 1024 * 1024),
    );
  });

  it('rejects a stream that exceeds maxBytes', async () => {
    mocks.download.mockResolvedValue({ data: streamOf('1234', '5678') });

    await expect(
      resolveStagedDatasourceUpload({ datasourceUploadId: uploadId, maxBytes: 6 }),
    ).rejects.toThrow('Data source upload exceeds the maximum allowed size of 6 bytes.');
  });

  it('throws after both file types are absent', async () => {
    mocks.download.mockResolvedValue(undefined);

    await expect(resolveStagedDatasourceUpload({ datasourceUploadId: uploadId })).rejects.toThrow(
      'Data source upload not found. Upload the data source bytes before publishing.',
    );
    expect(mocks.download).toHaveBeenCalledTimes(2);
  });

  it.each(['../not-safe', '', 'not-a-uuid'])(
    'rejects invalid upload id %j before provider lookup',
    async (datasourceUploadId) => {
      await expect(resolveStagedDatasourceUpload({ datasourceUploadId })).rejects.toThrow(
        'Data source upload id is invalid.',
      );
      expect(mocks.download).not.toHaveBeenCalled();
    },
  );

  it('rejects an empty TDS without falling back to another object', async () => {
    mocks.download.mockResolvedValue({ data: streamOf() });

    await expect(resolveStagedDatasourceUpload({ datasourceUploadId: uploadId })).rejects.toThrow(
      'Data source upload bytes must not be empty.',
    );
    expect(mocks.download).toHaveBeenCalledTimes(1);
  });

  it('rejects empty TDSX bytes after fallback', async () => {
    mocks.download.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ data: streamOf() });

    await expect(resolveStagedDatasourceUpload({ datasourceUploadId: uploadId })).rejects.toThrow(
      'Data source upload bytes must not be empty.',
    );
  });

  it('propagates provider errors without treating a failed download as a missing object', async () => {
    const error = new Error('Object exceeds byte limit');
    mocks.download.mockRejectedValue(error);

    await expect(resolveStagedDatasourceUpload({ datasourceUploadId: uploadId })).rejects.toBe(
      error,
    );
    expect(mocks.download).toHaveBeenCalledTimes(1);
  });
});

describe('buildDatasourceUploadKey', () => {
  it.each(['tds', 'tdsx'] as const)('includes the %s extension', (fileType) => {
    expect(buildDatasourceUploadKey(uploadId, fileType)).toBe(
      `datasource-uploads/${uploadId}/datasource.${fileType}`,
    );
  });

  it('rejects an invalid upload id', () => {
    expect(() => buildDatasourceUploadKey('../other', 'tds')).toThrow(
      'Data source upload id is invalid.',
    );
  });
});

describe('getDatasourceFileType', () => {
  it.each([
    ['Sales.tds', 'tds'],
    ['Sales.TDSX', 'tdsx'],
    ['Sales.xml', undefined],
    ['Sales.tds.exe', undefined],
  ])('identifies %s as %s', (fileName, fileType) => {
    expect(getDatasourceFileType(fileName)).toBe(fileType);
  });
});
