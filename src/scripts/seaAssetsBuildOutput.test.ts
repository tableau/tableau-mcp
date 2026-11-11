import { existsSync } from 'fs';
import { join } from 'path';

import { ALWAYS_EMBEDDED_FILES } from './seaAssets.js';

// Runs only in CI because CI builds fresh before vitest; a stale local build/ would mislead.
describe.runIf(process.env.GITHUB_ACTIONS === 'true')('SEA embedded files in build output', () => {
  it.each(ALWAYS_EMBEDDED_FILES)('build/%s exists', (relPath) => {
    expect(existsSync(join(process.cwd(), 'build', ...relPath.split('/')))).toBe(true);
  });
});
