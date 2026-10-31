import { Readable } from 'stream';

import type { TenantLuids } from '../../blobStorage/tenantKey.js';
import { ArgsValidationError } from '../../errors/mcpToolError.js';
import {
  getDatasourceFileType,
  resolveStagedDatasourceUpload,
} from './datasources/stagedDatasourceUpload.js';
import {
  buildStagedUploadKey,
  getAvailableUploadFileTypes,
  getSupportedUploadFileTypes,
  MAX_STAGED_UPLOAD_BYTES,
  requestStagedUpload,
} from './stagedUpload.js';
import {
  getWorkbookFileType,
  resolveStagedWorkbookUpload,
} from './workbooks/stagedWorkbookUpload.js';

const mocks = vi.hoisted(() => ({
  getPresignedUploadUrl: vi.fn(),
  download: vi.fn(),
  isFeatureEnabled: vi.fn(),
}));

vi.mock('../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: mocks.isFeatureEnabled })),
}));

vi.mock('../../blobStorage/init.js', () => ({
  getBlobStorageProvider: vi.fn(() => ({
    getPresignedUploadUrl: mocks.getPresignedUploadUrl,
    download: mocks.download,
  })),
}));

const uploadId = '123e4567-e89b-42d3-a456-426614174000';
const MOCK_SITE_LUID = '0a1b2c3d-1111-4222-8333-444455556666';
const MOCK_USER_LUID = '9f8e7d6c-aaaa-4bbb-8ccc-ddddeeeeffff';
const tenant: TenantLuids = { siteLuid: MOCK_SITE_LUID, userLuid: MOCK_USER_LUID };
const tenantPrefix = `${MOCK_SITE_LUID}/${MOCK_USER_LUID}`;

async function collect(stream: AsyncIterable<Uint8Array>): Promise<string> {
  const pieces: Uint8Array[] = [];
  for await (const piece of stream) pieces.push(piece);
  return Buffer.concat(pieces).toString();
}

async function* streamOf(...pieces: Array<string | Buffer>): AsyncGenerator<Uint8Array> {
  for (const piece of pieces) {
    yield Buffer.from(piece);
  }
}

describe('requestStagedUpload', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.isFeatureEnabled.mockResolvedValue(true);
  });

  it('allows exactly the extensions declared by the consuming tools', () => {
    expect(getSupportedUploadFileTypes().sort()).toEqual(['tds', 'tdsx', 'twb', 'twbx']);
  });

  it.each([
    ['Sales.tds', 'datasource-uploads', 'datasource.tds', 'application/xml'],
    ['Sales.TDSX', 'datasource-uploads', 'datasource.tdsx', 'application/octet-stream'],
    ['Book.twb', 'workbook-uploads', 'workbook.twb', 'application/xml'],
    ['Book 1.TWBX', 'workbook-uploads', 'workbook.twbx', 'application/octet-stream'],
  ])(
    'presigns %s under the %s tenant-scoped kind with a bounded size',
    async (fileName, kind, object, contentType) => {
      mocks.getPresignedUploadUrl.mockResolvedValue({
        uploadUrl: 'https://blob.example.com/signed-put',
        requiredHeaders: { 'Content-Type': contentType },
        expiresAt: '2026-10-14T18:05:00.000Z',
      });

      const result = await requestStagedUpload({ fileName, tenant });

      expect(result.uploadId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(MAX_STAGED_UPLOAD_BYTES).toBe(5 * 1000 * 1000 * 1000);
      expect(result).toEqual({
        uploadId: result.uploadId,
        uploadUrl: 'https://blob.example.com/signed-put',
        expiresAt: '2026-10-14T18:05:00.000Z',
        maxSizeBytes: MAX_STAGED_UPLOAD_BYTES,
        requiredHeaders: { 'Content-Type': contentType },
      });
      expect(mocks.getPresignedUploadUrl).toHaveBeenCalledExactlyOnceWith({
        key: `${kind}/${tenantPrefix}/${result.uploadId}/${object}`,
        contentType,
        maxBytes: MAX_STAGED_UPLOAD_BYTES,
      });
    },
  );

  it.each(['Sales.xml', 'Sales.tds.exe', 'Sales.hyper', 'Sales', ''])(
    'rejects unsupported filename %j before presigning',
    async (fileName) => {
      const error = await requestStagedUpload({ fileName, tenant }).catch((e) => e);
      expect(error).toBeInstanceOf(ArgsValidationError);
      expect(error.statusCode).toBe(400);
      expect(error.message).toMatch(/^Upload filename must end in one of: (\.\w+, ){3}\.\w+\.$/);
      expect(mocks.getPresignedUploadUrl).not.toHaveBeenCalled();
    },
  );

  it.each(['Sales.tds', 'Sales.tdsx'])(
    'rejects %s when datasource-authoring is off, listing only workbook types',
    async (fileName) => {
      mocks.isFeatureEnabled.mockImplementation(async (flag) => flag !== 'datasource-authoring');

      const error = await requestStagedUpload({ fileName, tenant }).catch((e) => e);
      expect(error).toBeInstanceOf(ArgsValidationError);
      expect(error.message).toBe('Upload filename must end in one of: .twb, .twbx.');
      expect(mocks.getPresignedUploadUrl).not.toHaveBeenCalled();
    },
  );

  it('lists only available types for the client', async () => {
    mocks.isFeatureEnabled.mockImplementation(async (flag) => flag !== 'datasource-authoring');
    expect((await getAvailableUploadFileTypes()).sort()).toEqual(['twb', 'twbx']);
  });

  it('rejects an invalid tenant without presigning anything', async () => {
    await expect(
      requestStagedUpload({
        fileName: 'Sales.tds',
        tenant: { siteLuid: '../other-site', userLuid: MOCK_USER_LUID },
      }),
    ).rejects.toThrow('Invalid tenant LUIDs for blob storage key.');
    expect(mocks.getPresignedUploadUrl).not.toHaveBeenCalled();
  });

  it('propagates presign errors', async () => {
    const error = new Error('Unable to presign');
    mocks.getPresignedUploadUrl.mockRejectedValue(error);

    await expect(requestStagedUpload({ fileName: 'Sales.tds', tenant })).rejects.toBe(error);
  });
});

describe('resolveStagedUploadStream (data source consumer)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.download.mockImplementation(async () => ({ data: streamOf('<data', 'source />') }));
  });

  function expectedDownload(
    fileType: 'tds' | 'tdsx',
    maxBytes = 5 * 1000 * 1000 * 1000,
  ): { key: string; maxBytes: number } {
    return {
      key: `datasource-uploads/${tenantPrefix}/${uploadId}/datasource.${fileType}`,
      maxBytes,
    };
  }

  it('streams TDS bytes and applies the default download limit without looking up TDSX', async () => {
    const resolved = await resolveStagedDatasourceUpload({ uploadId, tenant });

    expect(resolved.fileName).toBe(`${uploadId}.tds`);
    expect(resolved.fileType).toBe('tds');
    expect(await collect(resolved.fileStream)).toBe('<datasource />');
    expect(mocks.download).toHaveBeenCalledExactlyOnceWith(expectedDownload('tds'));
  });

  it('falls back to TDSX only when the TDS object is absent, preserving the byte limit', async () => {
    mocks.download
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ data: streamOf('PK\x03\x04') });

    const resolved = await resolveStagedDatasourceUpload({ uploadId, tenant, maxBytes: 4096 });

    expect(resolved.fileName).toBe(`${uploadId}.tdsx`);
    expect(resolved.fileType).toBe('tdsx');
    expect(await collect(resolved.fileStream)).toBe('PK\x03\x04');
    expect(mocks.download).toHaveBeenCalledTimes(2);
    expect(mocks.download).toHaveBeenNthCalledWith(1, expectedDownload('tds', 4096));
    expect(mocks.download).toHaveBeenNthCalledWith(2, expectedDownload('tdsx', 4096));
  });

  it('rejects and destroys the stream when the provider reports a length over the limit', async () => {
    const data = Readable.from([Buffer.from('PK\x03\x04')]);
    mocks.download.mockResolvedValue({ data, contentLength: 7 });

    const error = await resolveStagedDatasourceUpload({ uploadId, tenant, maxBytes: 6 }).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(ArgsValidationError);
    expect(error.message).toBe('Upload exceeds the maximum allowed size of 6 bytes.');
    expect(data.destroyed).toBe(true);
  });

  it('does not buffer or reject empty content at resolve time', async () => {
    mocks.download.mockResolvedValue({ data: streamOf() });

    const resolved = await resolveStagedDatasourceUpload({ uploadId, tenant });
    expect(await collect(resolved.fileStream)).toBe('');
  });

  it('rejects a stream that yields a non-byte chunk when consumed', async () => {
    async function* stringChunks(): AsyncGenerator<unknown> {
      yield '1234';
    }
    mocks.download.mockResolvedValue({ data: stringChunks() });

    const resolved = await resolveStagedDatasourceUpload({ uploadId, tenant });
    await expect(collect(resolved.fileStream)).rejects.toThrow(
      'Blob storage provider yielded a non-byte chunk.',
    );
  });

  it('throws after every supported file type is absent', async () => {
    mocks.download.mockResolvedValue(undefined);

    const error = await resolveStagedDatasourceUpload({ uploadId, tenant }).catch((e) => e);
    expect(error).toBeInstanceOf(ArgsValidationError);
    expect(error.message).toBe(
      'Upload not found. Call request-upload and upload the data source bytes before publishing.',
    );
    expect(mocks.download).toHaveBeenCalledTimes(4);
  });

  it.each(['../not-safe', '', 'not-a-uuid'])(
    'rejects invalid upload id %j before provider lookup',
    async (badId) => {
      const error = await resolveStagedDatasourceUpload({ uploadId: badId, tenant }).catch(
        (e) => e,
      );
      expect(error).toBeInstanceOf(ArgsValidationError);
      expect(error.message).toBe('Upload id is invalid.');
      expect(mocks.download).not.toHaveBeenCalled();
    },
  );

  it('rejects an empty tenant without downloading', async () => {
    await expect(
      resolveStagedDatasourceUpload({
        uploadId,
        tenant: { siteLuid: MOCK_SITE_LUID, userLuid: '' },
      }),
    ).rejects.toThrow('Invalid tenant LUIDs for blob storage key.');
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("does not resolve an upload staged by another tenant, since the key is rebuilt from the caller's identity", async () => {
    const otherTenant = {
      siteLuid: '11111111-2222-4333-8444-555555555555',
      userLuid: MOCK_USER_LUID,
    };
    const stagedKey = expectedDownload('tds').key;
    mocks.download.mockImplementation(async ({ key }: { key: string }) =>
      key === stagedKey ? { data: streamOf('<datasource />') } : undefined,
    );

    await expect(resolveStagedDatasourceUpload({ uploadId, tenant: otherTenant })).rejects.toThrow(
      'Upload not found',
    );
    for (const [{ key }] of mocks.download.mock.calls) {
      expect(key).toContain(`${otherTenant.siteLuid}/${otherTenant.userLuid}/`);
    }
  });

  it('propagates provider errors without treating a failed download as a missing object', async () => {
    const error = new Error('Object exceeds byte limit');
    mocks.download.mockRejectedValue(error);

    await expect(resolveStagedDatasourceUpload({ uploadId, tenant })).rejects.toBe(error);
    expect(mocks.download).toHaveBeenCalledTimes(1);
  });

  it("probes the other consumers' kinds and rejects an upload of another type", async () => {
    const data = Readable.from([Buffer.from('PK\x03\x04')]);
    mocks.download.mockImplementation(async ({ key }: { key: string }) =>
      key === `workbook-uploads/${tenantPrefix}/${uploadId}/workbook.twbx` ? { data } : undefined,
    );

    const error = await resolveStagedDatasourceUpload({ uploadId, tenant }).catch((e) => e);
    expect(error).toBeInstanceOf(ArgsValidationError);
    expect(error.statusCode).toBe(400);
    expect(error.message).toBe(
      'Upload is a .twbx file, but data source publishing accepts .tds or .tdsx.',
    );
    expect(data.destroyed).toBe(true);
  });
});

describe('resolveStagedUploadStream (workbook consumer)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('falls back from .twb to .twbx under the workbook kind', async () => {
    mocks.download.mockResolvedValueOnce(undefined);
    mocks.download.mockResolvedValueOnce({ data: streamOf('PK\x03\x04') });

    const resolved = await resolveStagedWorkbookUpload({ uploadId, tenant });
    expect(resolved.fileName).toBe(`${uploadId}.twbx`);
    expect(resolved.fileType).toBe('twbx');
    expect(await collect(resolved.fileStream)).toBe('PK\x03\x04');
    expect(mocks.download).toHaveBeenNthCalledWith(1, {
      key: `workbook-uploads/${tenantPrefix}/${uploadId}/workbook.twb`,
      maxBytes: MAX_STAGED_UPLOAD_BYTES,
    });
    expect(mocks.download).toHaveBeenNthCalledWith(2, {
      key: `workbook-uploads/${tenantPrefix}/${uploadId}/workbook.twbx`,
      maxBytes: MAX_STAGED_UPLOAD_BYTES,
    });
  });

  it('rejects an upload staged as a data source', async () => {
    mocks.download.mockImplementation(async ({ key }: { key: string }) =>
      key === `datasource-uploads/${tenantPrefix}/${uploadId}/datasource.tds`
        ? { data: streamOf('<datasource />') }
        : undefined,
    );

    const error = await resolveStagedWorkbookUpload({ uploadId, tenant }).catch((e) => e);
    expect(error).toBeInstanceOf(ArgsValidationError);
    expect(error.message).toBe(
      'Upload is a .tds file, but workbook publishing accepts .twb or .twbx.',
    );
  });

  it('throws when nothing was uploaded', async () => {
    mocks.download.mockResolvedValue(undefined);

    await expect(resolveStagedWorkbookUpload({ uploadId, tenant })).rejects.toBeInstanceOf(
      ArgsValidationError,
    );
  });
});

describe('buildStagedUploadKey', () => {
  const workbook = { kind: 'workbook-uploads', objectStem: 'workbook' };
  const datasource = { kind: 'datasource-uploads', objectStem: 'datasource' };

  it.each(['twb', 'twbx'])('builds the tenant-scoped workbook key for %s', (fileType) => {
    expect(buildStagedUploadKey(workbook, tenant, uploadId, fileType)).toBe(
      `workbook-uploads/${tenantPrefix}/${uploadId}/workbook.${fileType}`,
    );
  });

  it.each(['tds', 'tdsx'])('builds the tenant-scoped data source key for %s', (fileType) => {
    expect(buildStagedUploadKey(datasource, tenant, uploadId, fileType)).toBe(
      `datasource-uploads/${tenantPrefix}/${uploadId}/datasource.${fileType}`,
    );
  });

  it('rejects an invalid upload id', () => {
    expect(() => buildStagedUploadKey(datasource, tenant, '../other', 'tds')).toThrow(
      'Upload id is invalid.',
    );
  });
});

describe('file type helpers', () => {
  it.each([
    ['Sales.tds', 'tds'],
    ['Sales.TDSX', 'tdsx'],
    ['Sales.xml', undefined],
    ['Sales.twb', undefined],
  ])('getDatasourceFileType identifies %s as %s', (fileName, fileType) => {
    expect(getDatasourceFileType(fileName)).toBe(fileType);
  });

  it.each([
    ['Book.twb', 'twb'],
    ['Book.TWBX', 'twbx'],
    ['Book.xml', undefined],
    ['Book.tds', undefined],
  ])('getWorkbookFileType identifies %s as %s', (fileName, fileType) => {
    expect(getWorkbookFileType(fileName)).toBe(fileType);
  });
});
