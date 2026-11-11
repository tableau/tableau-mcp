import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { delimiter, join } from 'path';

import { getConfiguredExpertiseDir, listExpertiseSlugs, readExpertiseBySlug } from './assets.js';

function writeMd(root: string, relSlug: string, content: string): void {
  const path = join(root, ...relSlug.split('/')) + '.md';
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

describe('external expertise root (TABLEAU_EXPERTISE_DIR)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(process.cwd(), '.tmp-expertise-root-'));
    vi.stubEnv('TABLEAU_EXPERTISE_DIR', root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reports the external root from getConfiguredExpertiseDir', () => {
    expect(getConfiguredExpertiseDir()).toBe(root);
  });

  it('lists nested markdown slugs under the configured dir', () => {
    writeMd(root, 'tactics/viz/filters', '# filters');
    writeMd(root, 'strategy/viz-design/chart-selection', '# charts');
    writeMd(root, 'my-notes/onboarding', '# notes');

    expect(listExpertiseSlugs()).toEqual([
      'my-notes/onboarding',
      'strategy/viz-design/chart-selection',
      'tactics/viz/filters',
    ]);
  });

  it('skips hidden files and directories', () => {
    writeMd(root, 'tactics/a', '# visible');
    writeMd(join(root, '.vendored', 'protected'), 'hidden', '# hidden');
    writeFileSync(join(root, '.DS_Store'), 'skip');

    expect(listExpertiseSlugs()).toEqual(['tactics/a']);
  });

  it('reads a slug from the configured dir', () => {
    writeMd(root, 'strategy/x', '# only this');

    expect(readExpertiseBySlug('strategy/x')).toBe('# only this');
  });

  it('returns null for a missing slug', () => {
    expect(readExpertiseBySlug('nope/nothing-here')).toBeNull();
  });

  it('rejects slugs that point at hidden paths or escape the root', () => {
    writeMd(join(root, '.hidden'), 'secret', '# should not leak');

    expect(readExpertiseBySlug('.hidden/secret')).toBeNull();
    expect(readExpertiseBySlug('../escape')).toBeNull();
  });
});

describe('external expertise roots, multi-root precedence', () => {
  let protectedRoot: string;
  let userRoot: string;
  let overridableRoot: string;

  beforeEach(() => {
    protectedRoot = mkdtempSync(join(process.cwd(), '.tmp-expertise-protected-'));
    userRoot = mkdtempSync(join(process.cwd(), '.tmp-expertise-user-'));
    overridableRoot = mkdtempSync(join(process.cwd(), '.tmp-expertise-overridable-'));
    vi.stubEnv('TABLEAU_EXPERTISE_DIR', [protectedRoot, userRoot, overridableRoot].join(delimiter));
  });

  afterEach(() => {
    for (const root of [protectedRoot, userRoot, overridableRoot]) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports every root joined by the platform delimiter', () => {
    expect(getConfiguredExpertiseDir()).toBe(
      [protectedRoot, userRoot, overridableRoot].join(delimiter),
    );
  });

  it('earlier roots win when the same slug exists in more than one root', () => {
    writeMd(protectedRoot, 'strategy/layout', '# protected copy');
    writeMd(overridableRoot, 'strategy/layout', '# overridable default');

    expect(readExpertiseBySlug('strategy/layout')).toBe('# protected copy');
  });

  it('a user-content copy shadows an overridable default at the same slug without touching it', () => {
    writeMd(userRoot, 'strategy/layout', '# operator override');
    writeMd(overridableRoot, 'strategy/layout', '# overridable default');

    expect(readExpertiseBySlug('strategy/layout')).toBe('# operator override');
    expect(readFileSync(join(overridableRoot, 'strategy', 'layout.md'), 'utf-8')).toBe(
      '# overridable default',
    );
  });

  it('unions and dedups slugs across all roots when listing', () => {
    writeMd(protectedRoot, 'tactics/a', '# a');
    writeMd(userRoot, 'strategy/layout', '# operator');
    writeMd(overridableRoot, 'strategy/layout', '# default');
    writeMd(overridableRoot, 'personalization/tone', '# tone');

    expect(listExpertiseSlugs()).toEqual(['personalization/tone', 'strategy/layout', 'tactics/a']);
  });

  it('skips hidden files and directories within each root', () => {
    writeMd(protectedRoot, 'tactics/a', '# visible');
    writeMd(join(userRoot, '.vendored', 'protected'), 'hidden', '# hidden');
    writeFileSync(join(overridableRoot, '.DS_Store'), 'skip');

    expect(listExpertiseSlugs()).toEqual(['tactics/a']);
  });

  it('falls through to the next root when an earlier root is missing the slug', () => {
    writeMd(overridableRoot, 'strategy/only-here', '# default only');

    expect(readExpertiseBySlug('strategy/only-here')).toBe('# default only');
  });
});
