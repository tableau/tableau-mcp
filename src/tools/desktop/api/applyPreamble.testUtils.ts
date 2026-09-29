import { existsSync, readFileSync } from 'fs';

import * as cachePathModule from '../../../desktop/cachePath.js';

/** Keep legacy apply-tool unit fixtures focused on tool behavior while the preamble suite owns
 * real descriptor/containment coverage. The fs calls remain observable to existing assertions. */
export function mockContainedCacheReadFromFs(): void {
  vi.mocked(cachePathModule.readContainedCacheTextFile).mockImplementation((path) => {
    if (path.endsWith('.meta.json')) {
      return { ok: false, issue: cachePathModule.CONTAINED_CACHE_READ_ISSUE.missing };
    }
    if (!existsSync(path)) {
      return { ok: false, issue: cachePathModule.CONTAINED_CACHE_READ_ISSUE.missing };
    }
    try {
      const contents = readFileSync(path, 'utf-8');
      return { ok: true, path, text: contents.toString() };
    } catch (error) {
      return { ok: false, issue: cachePathModule.CONTAINED_CACHE_READ_ISSUE.readError, error };
    }
  });
}
