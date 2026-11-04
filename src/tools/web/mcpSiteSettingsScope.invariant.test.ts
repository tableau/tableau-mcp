/**
 * Every tool that can read MCP site settings must declare `tableau:mcp_site_settings:read`, and no
 * other tool may declare it. The read happens through `extra.getConfigWithOverrides()`, called
 * directly or via the resource access checker, so this walks each tool file's static runtime
 * imports (type-only imports skipped) and checks whether any reachable file calls it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';

import {
  getRequiredApiScopesForTool,
  MCP_SITE_SETTINGS_READ_SCOPE,
} from '../../server/oauth/scopes.js';
import { isWebToolName, webToolNames } from './toolName.js';

const webToolsDir = __dirname;
const srcDir = normalize(join(webToolsDir, '..', '..'));
// Importing the server pulls in every tool; following it would make every tool reach every fetch.
const stopFiles = new Set(['server.web.ts', 'server.ts'].map((f) => join(srcDir, f)));

const RUNTIME_IMPORT = /^\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+'(\.[^']+)'/gms;
const READS_SITE_SETTINGS = /getConfigWithOverrides\(/;

const sourceCache = new Map<string, string>();
function source(file: string): string {
  let text = sourceCache.get(file);
  if (text === undefined) {
    text = readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '');
    sourceCache.set(file, text);
  }
  return text;
}

function runtimeImports(file: string): string[] {
  const imports: string[] = [];
  for (const [, specifier] of source(file).matchAll(RUNTIME_IMPORT)) {
    const resolved = normalize(join(dirname(file), specifier)).replace(/\.js$/, '.ts');
    if (resolved.endsWith('.ts') && existsSync(resolved)) imports.push(resolved);
  }
  return imports;
}

function canReadSiteSettings(entry: string): boolean {
  const seen = new Set([entry]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (stopFiles.has(file)) continue;
    if (READS_SITE_SETTINGS.test(source(file))) return true;
    for (const dep of runtimeImports(file)) {
      if (!seen.has(dep)) {
        seen.add(dep);
        queue.push(dep);
      }
    }
  }
  return false;
}

// tools.ts imports each tool's factory from the file that defines it.
const toolFiles = new Map<string, string>();
for (const file of runtimeImports(join(webToolsDir, 'tools.ts'))) {
  const name = source(file).match(/(?:\bname:\s*|\btoolName\s*=\s*)'([a-z-]+)'/)?.[1];
  if (name && isWebToolName(name)) toolFiles.set(name, file);
}

describe('tableau:mcp_site_settings:read in the tool scope map', () => {
  it('locates a source file for every web tool', () => {
    expect([...toolFiles.keys()].sort()).toEqual([...webToolNames].sort());
  });

  it.each([...webToolNames])(
    '%s declares the scope exactly when it can read site settings',
    (toolName) => {
      const file = toolFiles.get(toolName)!;
      const declared = getRequiredApiScopesForTool(toolName).includes(MCP_SITE_SETTINGS_READ_SCOPE);
      expect({ file: relative(srcDir, file), declared }).toEqual({
        file: relative(srcDir, file),
        declared: canReadSiteSettings(file),
      });
    },
  );
});
