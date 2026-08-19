import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { delimiter, join } from 'path';

import { getConfiguredKnowledgeDir, listKnowledgeSlugs, readKnowledgeBySlug } from './assets.js';

function writeMd(root: string, relSlug: string, content: string): void {
  const path = join(root, ...relSlug.split('/')) + '.md';
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

describe('external knowledge root (TABLEAU_KNOWLEDGE_DIR)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(process.cwd(), '.tmp-knowledge-root-'));
    process.env['TABLEAU_KNOWLEDGE_DIR'] = root;
  });

  afterEach(() => {
    delete process.env['TABLEAU_KNOWLEDGE_DIR'];
    rmSync(root, { recursive: true, force: true });
  });

  it('reports the external root from getConfiguredKnowledgeDir', () => {
    expect(getConfiguredKnowledgeDir()).toBe(root);
  });

  it('lists nested markdown slugs under the configured dir', () => {
    writeMd(root, 'tactics/viz/filters', '# filters');
    writeMd(root, 'strategy/viz-design/chart-selection', '# charts');
    writeMd(root, 'my-notes/onboarding', '# notes');

    expect(listKnowledgeSlugs()).toEqual([
      'my-notes/onboarding',
      'strategy/viz-design/chart-selection',
      'tactics/viz/filters',
    ]);
  });

  it('skips hidden files and directories', () => {
    writeMd(root, 'tactics/a', '# visible');
    writeMd(join(root, '.vendored', 'protected'), 'hidden', '# hidden');
    writeFileSync(join(root, '.DS_Store'), 'skip');

    expect(listKnowledgeSlugs()).toEqual(['tactics/a']);
  });

  it('reads a slug from the configured dir', () => {
    writeMd(root, 'strategy/x', '# only this');

    expect(readKnowledgeBySlug('strategy/x')).toBe('# only this');
  });

  it('returns null for a missing slug', () => {
    expect(readKnowledgeBySlug('nope/nothing-here')).toBeNull();
  });

  it('rejects slugs that point at hidden paths or escape the root', () => {
    writeMd(join(root, '.hidden'), 'secret', '# should not leak');

    expect(readKnowledgeBySlug('.hidden/secret')).toBeNull();
    expect(readKnowledgeBySlug('../escape')).toBeNull();
  });
});

describe('external knowledge roots, multi-root precedence', () => {
  let protectedRoot: string;
  let userRoot: string;
  let overridableRoot: string;

  beforeEach(() => {
    protectedRoot = mkdtempSync(join(process.cwd(), '.tmp-knowledge-protected-'));
    userRoot = mkdtempSync(join(process.cwd(), '.tmp-knowledge-user-'));
    overridableRoot = mkdtempSync(join(process.cwd(), '.tmp-knowledge-overridable-'));
    process.env['TABLEAU_KNOWLEDGE_DIR'] = [protectedRoot, userRoot, overridableRoot].join(
      delimiter,
    );
  });

  afterEach(() => {
    delete process.env['TABLEAU_KNOWLEDGE_DIR'];
    for (const root of [protectedRoot, userRoot, overridableRoot]) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports every root joined by the platform delimiter', () => {
    expect(getConfiguredKnowledgeDir()).toBe(
      [protectedRoot, userRoot, overridableRoot].join(delimiter),
    );
  });

  it('earlier roots win when the same slug exists in more than one root', () => {
    writeMd(protectedRoot, 'strategy/layout', '# protected copy');
    writeMd(overridableRoot, 'strategy/layout', '# overridable default');

    expect(readKnowledgeBySlug('strategy/layout')).toBe('# protected copy');
  });

  it('a user-content copy shadows an overridable default at the same slug without touching it', () => {
    writeMd(userRoot, 'strategy/layout', '# operator override');
    writeMd(overridableRoot, 'strategy/layout', '# overridable default');

    expect(readKnowledgeBySlug('strategy/layout')).toBe('# operator override');
    expect(readFileSync(join(overridableRoot, 'strategy', 'layout.md'), 'utf-8')).toBe(
      '# overridable default',
    );
  });

  it('unions and dedups slugs across all roots when listing', () => {
    writeMd(protectedRoot, 'tactics/a', '# a');
    writeMd(userRoot, 'strategy/layout', '# operator');
    writeMd(overridableRoot, 'strategy/layout', '# default');
    writeMd(overridableRoot, 'personalization/tone', '# tone');

    expect(listKnowledgeSlugs()).toEqual(['personalization/tone', 'strategy/layout', 'tactics/a']);
  });

  it('skips hidden files and directories within each root', () => {
    writeMd(protectedRoot, 'tactics/a', '# visible');
    writeMd(join(userRoot, '.vendored', 'protected'), 'hidden', '# hidden');
    writeFileSync(join(overridableRoot, '.DS_Store'), 'skip');

    expect(listKnowledgeSlugs()).toEqual(['tactics/a']);
  });

  it('falls through to the next root when an earlier root is missing the slug', () => {
    writeMd(overridableRoot, 'strategy/only-here', '# default only');

    expect(readKnowledgeBySlug('strategy/only-here')).toBe('# default only');
  });
});
