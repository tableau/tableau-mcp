import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';

import { buildPrepAuthoringWorker } from './prepAuthoringAssets.js';

describe('Prep authoring Node worker packaging', () => {
  it('bundles one self-contained Node runtime without Python assets', async () => {
    const root = mkdtempSync(join(tmpdir(), 'prep-assets-'));
    const rel = relative(resolve(tmpdir()), resolve(root));
    if (!rel.startsWith('prep-assets-') || rel.includes(sep))
      throw new Error('Unexpected temporary directory.');
    try {
      const output = join(root, 'prep-authoring-worker.cjs');
      await buildPrepAuthoringWorker(output);
      expect(readdirSync(root)).toEqual(['prep-authoring-worker.cjs']);
      const text = readFileSync(output, 'utf8');
      expect(text).toContain('tableau-prep-flow/v1');
      expect(text).not.toContain('runner.py');
      expect(text).not.toContain('child_process');
      expect(text).not.toContain('PREP_AUTHORING_PYTHON');
    } finally {
      rmSync(root, { recursive: true });
    }
  });
});
