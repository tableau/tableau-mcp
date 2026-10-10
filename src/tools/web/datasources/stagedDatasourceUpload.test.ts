import { BucketS3Config } from '../s3Client.js';
import { MAX_STAGED_UPLOAD_BYTES } from '../stagedUpload.js';
import {
  getDatasourceFileType,
  requestStagedDatasourceUpload,
  streamStagedDatasourceUpload,
} from './stagedDatasourceUpload.js';

const mocks = vi.hoisted(() => ({
  createPresignedPutUrlToS3: vi.fn(),
  openObjectStreamFromS3IfExists: vi.fn(),
}));

vi.mock('../s3Client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../s3Client.js')>()),
  createPresignedPutUrlToS3: mocks.createPresignedPutUrlToS3,
  openObjectStreamFromS3IfExists: mocks.openObjectStreamFromS3IfExists,
}));

const config: BucketS3Config = {
  bucket: 'tableau-datasources',
  region: 'us-east-1',
  keyPrefix: 'mcp/',
  presignTtlSeconds: 300,
};

const uploadId = '123e4567-e89b-42d3-a456-426614174000';

describe('requestStagedDatasourceUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-09T18:00:00.000Z'));
    mocks.createPresignedPutUrlToS3.mockResolvedValue('https://s3.example.com/signed-put');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(['tdsx', 'hyper'])('returns a presigned PUT URL for a .%s file', async (fileType) => {
    const result = await requestStagedDatasourceUpload({ fileName: `WAM.${fileType}`, config });

    expect(result).toMatchObject({
      uploadUrl: 'https://s3.example.com/signed-put',
      expiresAt: '2026-10-09T18:05:00.000Z',
      maxSizeBytes: MAX_STAGED_UPLOAD_BYTES,
      requiredHeaders: { 'Content-Type': 'application/octet-stream' },
    });
    expect(mocks.createPresignedPutUrlToS3).toHaveBeenCalledWith({
      key: `mcp/datasource-uploads/${result.datasourceUploadId}/datasource.${fileType}`,
      contentType: 'application/octet-stream',
      bucket: 'tableau-datasources',
      region: 'us-east-1',
      presignTtlSeconds: 300,
    });
  });

  it('rejects filenames that are neither TDSX nor HYPER', async () => {
    await expect(requestStagedDatasourceUpload({ fileName: 'WAM.tds', config })).rejects.toThrow(
      'Data source upload filename must end in .tdsx or .hyper.',
    );
    expect(mocks.createPresignedPutUrlToS3).not.toHaveBeenCalled();
  });
});

describe('streamStagedDatasourceUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens the .tdsx key when it exists', async () => {
    const stream = [Buffer.from('bytes')];
    mocks.openObjectStreamFromS3IfExists.mockResolvedValueOnce({ stream, contentLength: 5 });

    const result = await streamStagedDatasourceUpload({ datasourceUploadId: uploadId, config });

    expect(result).toEqual({ fileName: `${uploadId}.tdsx`, fileType: 'tdsx', stream });
    expect(mocks.openObjectStreamFromS3IfExists).toHaveBeenCalledWith({
      key: `mcp/datasource-uploads/${uploadId}/datasource.tdsx`,
      bucket: 'tableau-datasources',
      region: 'us-east-1',
      maxBytes: MAX_STAGED_UPLOAD_BYTES,
    });
  });

  it('falls back to the .hyper key when the .tdsx key does not exist', async () => {
    mocks.openObjectStreamFromS3IfExists
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ stream: [], contentLength: 5 });

    const result = await streamStagedDatasourceUpload({ datasourceUploadId: uploadId, config });

    expect(result.fileType).toBe('hyper');
    expect(mocks.openObjectStreamFromS3IfExists).toHaveBeenLastCalledWith(
      expect.objectContaining({ key: `mcp/datasource-uploads/${uploadId}/datasource.hyper` }),
    );
  });

  it('throws when neither key exists', async () => {
    mocks.openObjectStreamFromS3IfExists.mockResolvedValue(undefined);

    await expect(
      streamStagedDatasourceUpload({ datasourceUploadId: uploadId, config }),
    ).rejects.toThrow('Data source upload not found.');
  });

  it('rejects an empty staged object', async () => {
    mocks.openObjectStreamFromS3IfExists.mockResolvedValueOnce({ stream: [], contentLength: 0 });

    await expect(
      streamStagedDatasourceUpload({ datasourceUploadId: uploadId, config }),
    ).rejects.toThrow('Data source upload bytes must not be empty.');
  });

  it('rejects invalid upload ids before touching S3', async () => {
    await expect(
      streamStagedDatasourceUpload({ datasourceUploadId: '../other-key', config }),
    ).rejects.toThrow('Data source upload id is invalid.');
    expect(mocks.openObjectStreamFromS3IfExists).not.toHaveBeenCalled();
  });
});

describe('getDatasourceFileType', () => {
  it.each([
    ['WAM.tdsx', 'tdsx'],
    ['orders.HYPER', 'hyper'],
    ['live.tds', undefined],
    ['book.twbx', undefined],
  ])('maps %s to %s', (fileName, expected) => {
    expect(getDatasourceFileType(fileName)).toBe(expected);
  });
});
