import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';

import { prepAuthoringAssets, stagePrepAuthoringAssets } from './prepAuthoringAssets.js';

function cleanOwnedDirectory(root: string): void {
  const rel = relative(resolve(tmpdir()), resolve(root));
  if (!rel.startsWith('prep-assets-') || rel.includes(sep))
    throw new Error('Unexpected temporary directory.');
  rmSync(root, { recursive: true });
}

describe('Prep authoring runtime asset staging', () => {
  it('ships the matching compiler/model/schema closure without caches or native binaries', () => {
    const root = mkdtempSync(join(tmpdir(), 'prep-assets-'));
    try {
      const source = join(root, 'source'),
        target = join(root, 'target');
      cpSync(resolve('src/tools/web/prepAuthoring/engine'), source, { recursive: true });
      writeFileSync(join(source, 'unexpected.jar'), 'not a shipped asset');
      writeFileSync(join(source, 'cached.pyc'), 'not a shipped asset');
      stagePrepAuthoringAssets(source, target);
      expect(existsSync(join(target, 'unexpected.jar'))).toBe(false);
      expect(existsSync(join(target, 'cached.pyc'))).toBe(false);
      for (const path of prepAuthoringAssets)
        expect(readFileSync(join(target, path))).toEqual(readFileSync(join(source, path)));
      expect(readdirSync(target).sort()).toEqual([
        'MIGRATION.json',
        'prep_engine',
        'requirements.txt',
        'runner.py',
      ]);
    } finally {
      cleanOwnedDirectory(root);
    }
  });
});
