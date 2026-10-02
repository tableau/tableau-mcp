import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const WORKFLOW_PATH = path.join(REPO_ROOT, '.github', 'workflows', 'upload-binaries.yml');
const CLEANUP_WORKFLOW_PATH = path.join(REPO_ROOT, '.github', 'workflows', 'cleanup-releases.yml');

describe('SEA release workflow', () => {
  it('uses the asset-generating SEA builder instead of the static asset-less config', () => {
    const workflow = fs.readFileSync(WORKFLOW_PATH, 'utf8');

    expect(workflow).not.toMatch(/node --experimental-sea-config sea-config\.json/);
    expect(workflow).toMatch(/npm run build:sea/);
  });

  it('smokes both SEA binaries and requires the desktop tool surface', () => {
    const workflow = fs.readFileSync(WORKFLOW_PATH, 'utf8');

    expect(workflow).toMatch(/npx tsx src\/scripts\/seaSmoke\.ts \.\/tableau-mcp\s/);
    expect(workflow).toMatch(
      /npx tsx src\/scripts\/seaSmoke\.ts \.\/tableau-mcp-desktop --require-tool bind-template/,
    );
    expect(workflow).toMatch(/npx tsx src\/scripts\/seaSmoke\.ts \.\\tableau-mcp\.exe\s/);
    expect(workflow).toMatch(
      /npx tsx src\/scripts\/seaSmoke\.ts \.\\tableau-mcp-desktop\.exe --require-tool bind-template/,
    );
  });

  it('builds native macOS archives and preserves each platform archive contract', () => {
    const workflow = fs.readFileSync(WORKFLOW_PATH, 'utf8');

    expect(workflow).toMatch(/runner:\s*macos-15\s+platform:\s*macos-arm64/);
    expect(workflow).toMatch(/runner:\s*macos-15-intel\s+platform:\s*macos-x64/);
    expect(workflow).toContain('tar -czf tableau-mcp.tar.gz tableau-mcp tableau-mcp-desktop');
    expect(workflow).toContain(
      'Compress-Archive -Path tableau-mcp.exe, tableau-mcp-desktop.exe -DestinationPath tableau-mcp.zip',
    );
    expect(workflow).toContain('tar -czf "${{ matrix.archive }}" tableau-mcp tableau-mcp-desktop');
    expect(workflow).toContain('archive: tableau-mcp-macos-arm64.tar.gz');
    expect(workflow).toContain('archive: tableau-mcp-macos-x64.tar.gz');
  });

  it('builds pull request artifacts without publishing or running live-auth smokes', () => {
    const workflow = fs.readFileSync(WORKFLOW_PATH, 'utf8');

    expect(workflow).toMatch(/\bpull_request:\s/);
    expect(workflow).toMatch(/release:\s+types:\s*\[published\]/);
    expect(workflow.match(/uses:\s*actions\/upload-artifact@v7/g)).toHaveLength(3);
    expect(workflow).toContain(
      "if: github.event_name == 'release' && github.event.action == 'published'",
    );
    expect(workflow.match(/if:\s*github\.event_name == 'release'/g)).toHaveLength(4);
    expect(workflow.match(/name:\s*Smoke Desktop SEA/g)).toHaveLength(3);
    expect(workflow).not.toMatch(/run:[^\n]*github\.event\.release\.tag_name/);
    expect(workflow).toContain('GH_REPO: ${{ github.repository }}');
    expect(workflow).toContain('gh release upload "$RELEASE_TAG"');
  });
});

describe('release asset cleanup workflow', () => {
  it('retains TAS-consumed archives while deleting only other old-release assets', async () => {
    const workflow = fs.readFileSync(CLEANUP_WORKFLOW_PATH, 'utf8');
    const scriptMarker = '          script: |\n';
    const scriptStart = workflow.indexOf(scriptMarker);
    expect(scriptStart).toBeGreaterThan(-1);
    const script = workflow
      .slice(scriptStart + scriptMarker.length)
      .split('\n')
      .map((line) => (line.startsWith('            ') ? line.slice(12) : line))
      .join('\n');
    const preservedNames = [
      'tableau-mcp.zip',
      'tableau-mcp-macos-arm64.tar.gz',
      'tableau-mcp-macos-x64.tar.gz',
    ];
    const releases = Array.from({ length: 13 }, (_, index) => ({
      created_at: new Date(Date.UTC(2026, 0, 13 - index)).toISOString(),
      tag_name: `v${13 - index}`,
      assets: [
        { id: index * 10 + 1, name: `other-${index}.tgz` },
        ...preservedNames.map((name, assetIndex) => ({
          id: index * 10 + assetIndex + 2,
          name,
        })),
      ],
    })).reverse();
    const deletedAssetIds: number[] = [];
    const github = {
      paginate: vi.fn().mockResolvedValue(releases),
      rest: {
        repos: {
          listReleases: vi.fn(),
          deleteReleaseAsset: vi.fn(({ asset_id }: { asset_id: number }) => {
            deletedAssetIds.push(asset_id);
          }),
        },
      },
    };
    const context = { repo: { owner: 'tableau', repo: 'tableau-mcp' } };
    const workflowConsole = { log: vi.fn() };
    const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (
      ...args: string[]
    ) => (...values: unknown[]) => Promise<void>;

    await new AsyncFunction('github', 'context', 'console', script)(
      github,
      context,
      workflowConsole,
    );

    expect(deletedAssetIds).toEqual([101, 111, 121]);
    expect(github.rest.repos.deleteReleaseAsset).toHaveBeenCalledTimes(3);
  });
});
