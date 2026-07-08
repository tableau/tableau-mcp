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
});
