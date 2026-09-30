import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mockFeatureGate: {
    isFeatureEnabled: vi.fn(async (_featureName: string) => false),
  },
  mockGetSkillRegistry: vi.fn(),
  mockReadFile: vi.fn(),
  mockLog: vi.fn(),
}));

vi.mock('../features/init.js', () => ({
  getFeatureGate: vi.fn(() => mocks.mockFeatureGate),
}));

vi.mock('./registry.js', () => ({
  getSkillRegistry: mocks.mockGetSkillRegistry,
}));

vi.mock('../logging/logger.js', () => ({
  log: mocks.mockLog,
}));

vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mocks.mockReadFile(...args),
}));

import { registerSkills } from './index.js';

type SkillFile = { uri: string; path: string; mimeType: string };
type ServerArg = Parameters<typeof registerSkills>[0];

// Create minimal mock server for registerSkills to use
function makeServer(): { server: ServerArg; registerResource: ReturnType<typeof vi.fn> } {
  const registerResource = vi.fn();
  return {
    server: { mcpServer: { registerResource } } as unknown as ServerArg,
    registerResource,
  };
}

// Set up mock registry files
function setRegistryFiles(files: SkillFile[]): void {
  mocks.mockGetSkillRegistry.mockResolvedValue({
    files: () => files,
    list: () => ({ skills: [] }),
    get: () => undefined,
  });
}

const MARKDOWN_FILE: SkillFile = {
  uri: 'skill://test-skill/SKILL.md',
  path: '/abs/test-skill/SKILL.md',
  mimeType: 'text/markdown',
};

describe('registerSkills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockFeatureGate.isFeatureEnabled.mockResolvedValue(false);
    mocks.mockReadFile.mockResolvedValue(Buffer.from(''));
    setRegistryFiles([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when the skills-over-mcp flag is disabled', async () => {
    mocks.mockFeatureGate.isFeatureEnabled.mockResolvedValue(false);
    setRegistryFiles([MARKDOWN_FILE]);
    const { server, registerResource } = makeServer();

    await registerSkills(server);

    expect(mocks.mockFeatureGate.isFeatureEnabled).toHaveBeenCalledWith('skills-over-mcp');
    // Returns before ever touching the registry or registering resources.
    expect(mocks.mockGetSkillRegistry).not.toHaveBeenCalled();
    expect(registerResource).not.toHaveBeenCalled();
  });

  it('registers one resource per skill file when enabled', async () => {
    mocks.mockFeatureGate.isFeatureEnabled.mockResolvedValue(true);
    const files: SkillFile[] = [
      MARKDOWN_FILE,
      {
        uri: 'skill://test-skill/skill-expertise/list-workbooks.md',
        path: '/abs/test-skill/skill-expertise/list-workbooks.md',
        mimeType: 'text/markdown',
      },
    ];
    setRegistryFiles(files);
    const { server, registerResource } = makeServer();

    await registerSkills(server);

    expect(registerResource).toHaveBeenCalledTimes(2);
    // The URI is passed as both the registration name and the resource URI.
    expect(registerResource).toHaveBeenNthCalledWith(
      1,
      files[0].uri,
      files[0].uri,
      { mimeType: 'text/markdown' },
      expect.any(Function),
    );
    expect(registerResource).toHaveBeenNthCalledWith(
      2,
      files[1].uri,
      files[1].uri,
      { mimeType: 'text/markdown' },
      expect.any(Function),
    );
  });

  it('logs the number of registered resources', async () => {
    mocks.mockFeatureGate.isFeatureEnabled.mockResolvedValue(true);
    setRegistryFiles([MARKDOWN_FILE, { ...MARKDOWN_FILE, uri: 'skill://test-skill/README.md' }]);
    const { server } = makeServer();

    await registerSkills(server);

    expect(mocks.mockLog).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Registered 2 skill resource(s).' }),
    );
  });

  it('registers only once when called repeatedly on the same server', async () => {
    mocks.mockFeatureGate.isFeatureEnabled.mockResolvedValue(true);
    setRegistryFiles([MARKDOWN_FILE]);
    const { server, registerResource } = makeServer();

    await registerSkills(server);
    await registerSkills(server);

    expect(registerResource).toHaveBeenCalledTimes(1);
  });

  it('registers again for a different server instance', async () => {
    mocks.mockFeatureGate.isFeatureEnabled.mockResolvedValue(true);
    setRegistryFiles([MARKDOWN_FILE]);
    const first = makeServer();
    const second = makeServer();

    await registerSkills(first.server);
    await registerSkills(second.server);

    expect(first.registerResource).toHaveBeenCalledTimes(1);
    expect(second.registerResource).toHaveBeenCalledTimes(1);
  });

  it('logs and registers nothing when there are no skill files', async () => {
    mocks.mockFeatureGate.isFeatureEnabled.mockResolvedValue(true);
    setRegistryFiles([]);
    const { server, registerResource } = makeServer();

    await registerSkills(server);

    expect(registerResource).not.toHaveBeenCalled();
    expect(mocks.mockLog).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('No skills to register') }),
    );
  });

  describe('resource read callback', () => {
    // Registers a single file, then invokes the read callback the registry handed to registerResource.
    async function readSingleFile(file: SkillFile, bytes: Buffer): Promise<unknown> {
      mocks.mockFeatureGate.isFeatureEnabled.mockResolvedValue(true);
      setRegistryFiles([file]);
      mocks.mockReadFile.mockResolvedValue(bytes);
      const { server, registerResource } = makeServer();

      await registerSkills(server);

      const readCallback = registerResource.mock.calls[0][3] as () => Promise<unknown>;
      return readCallback();
    }

    it('serves a textual file as UTF-8 text', async () => {
      const result = await readSingleFile(MARKDOWN_FILE, Buffer.from('# hello'));

      expect(mocks.mockReadFile).toHaveBeenCalledWith(MARKDOWN_FILE.path);
      expect(result).toEqual({
        contents: [{ uri: MARKDOWN_FILE.uri, mimeType: 'text/markdown', text: '# hello' }],
      });
    });

    it('serves a binary file as a base64 blob', async () => {
      const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      const pngFile: SkillFile = {
        uri: 'skill://test-skill/logo.png',
        path: '/abs/test-skill/logo.png',
        mimeType: 'image/png',
      };

      const result = await readSingleFile(pngFile, pngBytes);

      expect(result).toEqual({
        contents: [{ uri: pngFile.uri, mimeType: 'image/png', blob: pngBytes.toString('base64') }],
      });
    });
  });
});
