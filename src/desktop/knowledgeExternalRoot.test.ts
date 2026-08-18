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
