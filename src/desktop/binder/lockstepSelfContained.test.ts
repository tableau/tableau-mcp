import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

// The lockstep core set is copied byte-for-byte into consumer repos, so it only works
// if it is CLOSED: every relative import from a core file must land on another core
// file. A core file that reaches outside the set copies over as a broken module, and
// the manifest can no longer be regenerated honestly. This ran red through eight
// merged PRs because nothing checked it; scripts/check-lockstep.mjs only compares
// hashes and cannot see an import.
const REPO_ROOT = resolve(__dirname, '../../..');
const MANIFEST_REL = 'lockstep.hashes.json';

function manifestFiles(): string[] {
  return Object.keys(JSON.parse(readFileSync(join(REPO_ROOT, MANIFEST_REL), 'utf8')));
}

/** Every static `import ... from '<spec>'` / `export ... from '<spec>'`, multiline-safe. */
function importSpecifiers(fileRel: string): string[] {
  const source = readFileSync(join(REPO_ROOT, fileRel), 'utf8');
  const specs: string[] = [];
  for (const m of source.matchAll(
    /(?:^|\n)\s*(?:import|export)\b[\s\S]*?from\s*['"]([^'"]+)['"]/g,
  )) {
    specs.push(m[1]);
  }
  for (const m of source.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)) {
    specs.push(m[1]);
  }
  return specs;
}

/** Resolve a relative specifier to a repo-relative .ts path; null for package imports. */
function resolveToRepoRelative(fromRel: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(join(REPO_ROOT, fromRel)), spec).replace(/\.js$/, '');
  for (const candidate of [`${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(candidate)) return relative(REPO_ROOT, candidate);
  }
  return `<unresolved:${spec}>`;
}

describe('lockstep core set is self-contained', () => {
  it('lists at least one file', () => {
    expect(manifestFiles().length).toBeGreaterThan(0);
  });

  it('every relative import from a lockstep-core file resolves to another lockstep-core file', () => {
    const files = manifestFiles();
    const inSet = new Set(files);
    const escapes: string[] = [];

    for (const fileRel of files) {
      for (const spec of importSpecifiers(fileRel)) {
        const target = resolveToRepoRelative(fileRel, spec);
        if (target === null) continue;
        if (!inSet.has(target)) escapes.push(`${fileRel} imports '${spec}' -> ${target}`);
      }
    }

    // Named so the failure says what to do: promote the target into the manifest, or
    // sever the edge (inline the shape the core file actually reads).
    expect(escapes).toEqual([]);
  });

  it('every file the manifest lists exists on disk', () => {
    const missing = manifestFiles().filter((rel) => !existsSync(join(REPO_ROOT, rel)));
    expect(missing).toEqual([]);
  });
});
