import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const WORKFLOW_PATH = path.join(REPO_ROOT, '.github', 'workflows', 'upload-binaries.yml');

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
    expect(workflow).toMatch(
      /npx tsx src\/scripts\/seaSmoke\.ts \.\/tableau-mcp-desktop --require-tool search-knowledge --min-knowledge-resources 100 --search-knowledge "pie chart of countries"/,
    );
    expect(workflow).toMatch(/npx tsx src\/scripts\/seaSmoke\.ts \.\\tableau-mcp\.exe\s/);
    expect(workflow).toMatch(
      /npx tsx src\/scripts\/seaSmoke\.ts \.\\tableau-mcp-desktop\.exe --require-tool bind-template/,
    );
    expect(workflow).toMatch(
      /npx tsx src\/scripts\/seaSmoke\.ts \.\\tableau-mcp-desktop\.exe --require-tool search-knowledge --min-knowledge-resources 100 --search-knowledge "pie chart of countries"/,
    );
  });
});
