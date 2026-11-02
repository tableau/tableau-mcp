import { readdir, readFile, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, dirname } from 'path';

import { getConfig } from '../../../config.js';
import { TEMPLATE_ZIP_FILENAME } from '../../../scripts/buildTemplateZip.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import { _setSeaApiForTest } from '../../../utils/sea.js';
import { exportedForTesting as s3ForTesting } from '../s3Client.js';
import { createDataAppWorkspace, exportedForTesting } from './dataAppWorkspaceStore.js';

const mocks = vi.hoisted(() => ({
  hideDiskZip: false,
  forceDiskZip: false,
  send: vi.fn(),
  getSignedUrl: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: (path: string) => {
      if (String(path).endsWith('data-app-template.zip')) {
        if (mocks.hideDiskZip) return false;
        if (mocks.forceDiskZip) return true;
      }
      return actual.existsSync(path);
    },
  };
});

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    writeFile: (...args: Parameters<typeof actual.writeFile>) =>
      mocks.writeFile(actual.writeFile, ...args),
  };
});

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: mocks.send })),
  PutObjectCommand: vi.fn().mockImplementation((input) => ({ __command: 'put', input })),
  GetObjectCommand: vi.fn().mockImplementation((input) => ({ __command: 'get', input })),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: mocks.getSignedUrl }));

const ASSET_KEY = `templates/${TEMPLATE_ZIP_FILENAME}`;
const ASSET_BYTES = Buffer.from('PK-fake-template-zip-bytes');

function installSea(assets: Record<string, Buffer>): void {
  _setSeaApiForTest({
    isSea: () => true,
    getAsset: (key: string) => {
      const asset = assets[key];
      if (!asset) {
        throw new Error(`no asset ${key}`);
      }
      return new Uint8Array(asset).buffer;
    },
  });
}

async function create(): ReturnType<typeof createDataAppWorkspace> {
  return createDataAppWorkspace({
    datappName: 'Sales Demo',
    productVersion: { value: '2026.3.2', build: '20263.26.1027.1340' },
    allowedOrigins: [],
    config: getConfig(),
  });
}

describe('createDataAppWorkspace inside a SEA', () => {
  const createdDirs = new Set<string>();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    s3ForTesting.resetS3Bundle();
    exportedForTesting.resetSeaTemplatePath();
    mocks.hideDiskZip = true;
    mocks.send.mockResolvedValue(undefined);
    mocks.getSignedUrl.mockResolvedValue('https://s3.example.com/signed-template-url');
    mocks.writeFile.mockImplementation((actual: (...a: unknown[]) => unknown, ...args: unknown[]) =>
      actual(...args),
    );
    installSea({ [ASSET_KEY]: ASSET_BYTES });
  });

  afterEach(async () => {
    _setSeaApiForTest(null);
    mocks.hideDiskZip = false;
    mocks.forceDiskZip = false;
    vi.unstubAllEnvs();
    for (const dir of createdDirs) {
      if (basename(dir).startsWith('tableau-mcp-template-')) {
        await rm(dir, { recursive: true, force: true });
      }
    }
    createdDirs.clear();
  });

  it('local mode writes the asset to a temp file and returns its path', async () => {
    const result = await create();

    expect(result.isOk()).toBe(true);
    const { filePath } = result.unwrap();
    expect(filePath).toBeDefined();
    createdDirs.add(dirname(filePath!));
    expect(filePath!.startsWith(tmpdir())).toBe(true);
    expect(dirname(filePath!)).toContain('tableau-mcp-template-');
    expect(await readFile(filePath!)).toEqual(ASSET_BYTES);
  });

  it.skipIf(process.platform === 'win32')(
    'creates a private dir (0700) and file (0600)',
    async () => {
      const { filePath } = (await create()).unwrap();
      createdDirs.add(dirname(filePath!));

      expect((await stat(dirname(filePath!))).mode & 0o777).toBe(0o700);
      expect((await stat(filePath!)).mode & 0o777).toBe(0o600);
    },
  );

  it('prefers the embedded asset over a zip on disk', async () => {
    mocks.hideDiskZip = false;
    mocks.forceDiskZip = true;

    const { filePath } = (await create()).unwrap();
    createdDirs.add(dirname(filePath!));

    expect(await readFile(filePath!)).toEqual(ASSET_BYTES);
  });

  it('writes a fresh copy when the cached file has been deleted', async () => {
    const first = (await create()).unwrap();
    createdDirs.add(dirname(first.filePath!));
    expect(basename(dirname(first.filePath!))).toMatch(/^tableau-mcp-template-/);
    await rm(first.filePath!);

    const second = (await create()).unwrap();
    createdDirs.add(dirname(second.filePath!));

    expect(second.filePath).not.toBe(first.filePath);
    expect(await readFile(second.filePath!)).toEqual(ASSET_BYTES);
    expect(mocks.writeFile).toHaveBeenCalledTimes(2);
  });

  it('writes a fresh copy when the cached directory has been deleted', async () => {
    const first = (await create()).unwrap();
    expect(basename(dirname(first.filePath!))).toMatch(/^tableau-mcp-template-/);
    await rm(dirname(first.filePath!), { recursive: true });

    const second = (await create()).unwrap();
    createdDirs.add(dirname(second.filePath!));

    expect(second.filePath).not.toBe(first.filePath);
    expect(await readFile(second.filePath!)).toEqual(ASSET_BYTES);
  });

  it('concurrent first calls share one write', async () => {
    const [a, b] = await Promise.all([create(), create()]);
    createdDirs.add(dirname(a.unwrap().filePath!));

    expect(b.unwrap().filePath).toBe(a.unwrap().filePath);
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
  });

  it('local mode reuses one path and writes once per process', async () => {
    const first = (await create()).unwrap();
    const second = (await create()).unwrap();
    createdDirs.add(dirname(first.filePath!));

    expect(second.filePath).toBe(first.filePath);
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
  });

  it('S3 mode uploads the asset bytes', async () => {
    vi.stubEnv('MCP_S3_BUCKET', 'tmpl-bucket');
    vi.stubEnv('AWS_DEFAULT_REGION', 'us-west-2');

    const result = await create();

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().s3URL).toBe('https://s3.example.com/signed-template-url');
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0][0].input.Body).toEqual(ASSET_BYTES);
  });

  it('returns the unavailable error with a reason when the temp write fails', async () => {
    mocks.writeFile.mockRejectedValue(new Error('ENOSPC: no space left'));
    const templateDirs = async (): Promise<string[]> =>
      (await readdir(tmpdir())).filter((name) => name.startsWith('tableau-mcp-template-'));
    const before = await templateDirs();

    const result = await create();

    expect(await templateDirs()).toEqual(before);

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().message).toContain('ENOSPC: no space left');
    expect(result.unwrapErr().message).toContain('data app template');
  });

  it('returns the unavailable error when the SEA lacks the asset', async () => {
    installSea({});

    const result = await create();

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().message).toBe(
      'The data app template is not available in this deployment.',
    );
  });
});

describe('createDataAppWorkspace outside a SEA with no zip on disk', () => {
  beforeEach(() => {
    stubDefaultEnvVars();
    exportedForTesting.resetSeaTemplatePath();
    mocks.hideDiskZip = true;
    _setSeaApiForTest(null);
  });

  afterEach(() => {
    mocks.hideDiskZip = false;
    vi.unstubAllEnvs();
  });

  it('keeps the unavailable error', async () => {
    const result = await create();

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().message).toBe(
      'The data app template is not available in this deployment.',
    );
  });
});
