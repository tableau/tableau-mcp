/**
 * TABLEAU_KNOWLEDGE_DIR points at the tree tab-agent-south materializes to
 * <agent-data-dir>/knowledge: `.vendored/protected`, `.vendored/overridable`,
 * and top-level user content. These tests cover the precedence walk
 * (protected > user > overridable) and slug normalization independent of that
 * materialization — they build the tree by hand.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

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

  it('merges slugs from all three tiers, normalized (tier prefix stripped)', () => {
    writeMd(join(root, '.vendored', 'protected'), 'tactics/viz/filters', '# protected');
    writeMd(root, 'my-notes/onboarding', '# user');
    writeMd(
      join(root, '.vendored', 'overridable'),
      'strategy/viz-design/chart-selection',
      '# overridable',
    );

    expect(listKnowledgeSlugs()).toEqual([
      'my-notes/onboarding',
      'strategy/viz-design/chart-selection',
      'tactics/viz/filters',
    ]);
  });

  it('excludes .vendored itself from the user-content walk', () => {
    writeMd(join(root, '.vendored', 'protected'), 'a', '# protected a');
    writeMd(join(root, '.vendored', 'overridable'), 'b', '# overridable b');

    expect(listKnowledgeSlugs()).toEqual(['a', 'b']);
  });

  it('resolves a slug present in only one tier', () => {
    writeMd(join(root, '.vendored', 'overridable'), 'strategy/x', '# only overridable');

    expect(readKnowledgeBySlug('strategy/x')).toBe('# only overridable');
  });

  it('protected wins over a same-slug user file', () => {
    writeMd(join(root, '.vendored', 'protected'), 'shared/topic', '# protected wins');
    writeMd(root, 'shared/topic', '# user loses');

    expect(readKnowledgeBySlug('shared/topic')).toBe('# protected wins');
    expect(listKnowledgeSlugs()).toEqual(['shared/topic']);
  });

  it('a user file shadows the same-slug overridable default', () => {
    writeMd(root, 'shared/topic', '# user wins');
    writeMd(join(root, '.vendored', 'overridable'), 'shared/topic', '# overridable loses');

    expect(readKnowledgeBySlug('shared/topic')).toBe('# user wins');
  });

  it('returns null for a slug that names no file in any tier', () => {
    expect(readKnowledgeBySlug('nope/nothing-here')).toBeNull();
  });

  it('never resolves a caller-supplied slug into .vendored via the user-content root', () => {
    // Only reachable through the literal .vendored/overridable/secret path — not a
    // slug listKnowledgeSlugs would ever normalize to and produce.
    writeMd(join(root, '.vendored', 'overridable'), 'secret', '# should not leak');

    expect(readKnowledgeBySlug('.vendored/overridable/secret')).toBeNull();
  });
});
