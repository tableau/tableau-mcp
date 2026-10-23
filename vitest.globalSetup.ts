import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Without this, every `new DesktopCache()` creates (and tests may fill) <repo>/src/cache.
export default function setup(): () => void {
  const dir = mkdtempSync(join(tmpdir(), 'tmcp-vitest-cache-'));
  process.env.TABLEAU_MCP_CACHE_DIR = dir;
  return () => rmSync(dir, { recursive: true, force: true });
}
