import { readFileSync } from 'fs';

import { listKnowledgeSlugs, readKnowledgeBySlug } from '../assets.js';
import { getKnowledgeDir } from './index.js';

/**
 * Corpus-wide integrity gates over the REAL shipped knowledge tree
 * (resources/desktop/knowledge), not a fixture. The bundle serves these files
 * to the agent verbatim, so a broken cross-reference or a duplicated topic is a
 * wrong instruction to every user.
 */

const URI_PREFIX = 'expertise://tableau/';

interface Reference {
  slug: string;
  target: string;
  lineNumber: number;
  line: string;
}

/**
 * Strip the trailing markdown/prose punctuation a URI picks up when it is
 * written inline — backtick, closing paren/bracket, comma, period, semicolon.
 * Also drops any `#section` / `?query` suffix so section-scoped reads still
 * resolve against the file slug.
 */
function normalizeTarget(raw: string): string {
  return raw
    .replace(/[#?].*$/, '')
    .replace(/[`)\]>,.;:!'"]+$/, '')
    .replace(/\/+$/, '');
}

function collectReferences(): Reference[] {
  const knowledgeDir = getKnowledgeDir();
  const references: Reference[] = [];

  for (const slug of listKnowledgeSlugs()) {
    const content = readFileSync(`${knowledgeDir}/${slug}.md`, 'utf-8');
    content.split('\n').forEach((line, index) => {
      for (const match of line.matchAll(/expertise:\/\/tableau\/[^\s]+/g)) {
        const target = normalizeTarget(match[0].slice(URI_PREFIX.length));
        // `expertise://tableau/<slug>` and friends are documentation placeholders,
        // not references to a real module.
        if (!target || /[<>{}*]/.test(target)) continue;
        references.push({ slug, target, lineNumber: index + 1, line: line.trim() });
      }
    });
  }

  return references;
}

describe('knowledge corpus integrity', () => {
  it('has no dangling expertise://tableau/ reference', () => {
    const known = new Set(listKnowledgeSlugs());

    const dangling = collectReferences()
      .filter((reference) => !known.has(reference.target))
      .map(({ slug, target, lineNumber, line }) => ({
        file: `${slug}.md`,
        missingTarget: `${URI_PREFIX}${target}`,
        line: `${lineNumber}: ${line}`,
      }));

    expect(dangling).toEqual([]);
  });

  it('serves each topic slug from exactly one directory', () => {
    const byTopic = new Map<string, string[]>();

    for (const slug of listKnowledgeSlugs()) {
      const topic = slug.split('/').pop() ?? slug;
      byTopic.set(topic, [...(byTopic.get(topic) ?? []), slug]);
    }

    const duplicates = [...byTopic.entries()]
      .filter(([, slugs]) => slugs.length > 1)
      .map(([topic, slugs]) => ({
        topic,
        servedFrom: slugs.map((slug) => `${URI_PREFIX}${slug}`),
        bytes: slugs.map((slug) => readKnowledgeBySlug(slug)?.length ?? 0),
      }));

    expect(duplicates).toEqual([]);
  });
});
