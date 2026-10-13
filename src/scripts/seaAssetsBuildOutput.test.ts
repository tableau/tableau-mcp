import { existsSync } from 'fs';
import { join } from 'path';

import { ALWAYS_EMBEDDED_FILES } from './seaAssets.js';

const buildDir = process.env.SEA_BUILD_DIR_FOR_TEST ?? join(process.cwd(), 'build');

// Needs `npm run build` first. CI builds before vitest, so there a missing build/ fails loudly;
// locally (and in agent-check, which does not build) it only runs once build/index.js exists.
describe.runIf(process.env.GITHUB_ACTIONS === 'true' || existsSync(join(buildDir, 'index.js')))(
  'SEA embedded files in build output',
  () => {
    it.each(ALWAYS_EMBEDDED_FILES)('build/%s exists', (relPath) => {
      expect(existsSync(join(buildDir, ...relPath.split('/')))).toBe(true);
    });
  },
);
