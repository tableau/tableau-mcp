import { readFileSync } from 'fs';

import { getConfiguredKnowledgeDir, listKnowledgeSlugs, readKnowledgeBySlug } from '../assets.js';

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
  const knowledgeDir = getConfiguredKnowledgeDir();
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
        chars: slugs.map((slug) => readKnowledgeBySlug(slug)?.length ?? 0),
      }));

    expect(duplicates).toEqual([]);
  });

  it('teaches safe dialog-tool recovery instead of obsolete human-only guidance', () => {
    const knowledgeDir = getConfiguredKnowledgeDir();
    const documents = [
      {
        name: '_index.md',
        content: readFileSync(`${knowledgeDir}/_index.md`, 'utf-8'),
      },
      {
        name: 'tactics/workflow/errors-as-modals.md',
        content: readKnowledgeBySlug('tactics/workflow/errors-as-modals'),
      },
      {
        name: 'tactics/workflow/recovery.md',
        content: readKnowledgeBySlug('tactics/workflow/recovery'),
      },
      {
        name: 'tactics/viz/building-viz-extensions.md',
        content: readKnowledgeBySlug('tactics/viz/building-viz-extensions'),
      },
      {
        name: 'tactics/viz/extension-vibe-coding-workflow.md',
        content: readKnowledgeBySlug('tactics/viz/extension-vibe-coding-workflow'),
      },
      {
        name: 'personalization/choosing-a-custom-viz-solution.md',
        content: readKnowledgeBySlug('personalization/choosing-a-custom-viz-solution'),
      },
    ];

    for (const document of documents) {
      expect(document.content, `${document.name} should be shipped`).not.toBeNull();
      expect(document.content, `${document.name} should name the inspection tool`).toContain(
        'get-active-dialogs',
      );
      expect(document.content, `${document.name} should name the action tool`).toContain(
        'invoke-dialog-action',
      );
      expect(
        document.content,
        `${document.name} should retain a conservative human fallback`,
      ).toMatch(/human fallback|human handoff|ask the user/i);
    }

    const allGuidance = documents.map(({ content }) => content ?? '').join('\n');
    const obsoleteClaims = [
      'There is no command that dismisses a dialog',
      'prevention is the only recovery',
      'lost the session until a human intervenes',
      'no headless dismissal',
      'a human must dismiss the modal first',
      'the first-trust click is a human gate by design',
      'this is a human gate by design',
      'the only human step for a never-trusted local extension is a one-time trust approval',
    ];

    for (const obsoleteClaim of obsoleteClaims) {
      expect(allGuidance).not.toContain(obsoleteClaim);
    }
  });
});
