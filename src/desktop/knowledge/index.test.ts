import { join, sep } from 'path';

vi.mock('fs');
vi.mock('../../utils/getDirname.js');

import { Dirent, existsSync, readdirSync, readFileSync } from 'fs';

import { getDirname } from '../../utils/getDirname.js';
import {
  _resetKnowledgeSearchCache,
  clearKnowledgeCache,
  getKnowledgeDir,
  listKnowledgeResources,
  readKnowledgeResource,
  searchKnowledge,
  searchKnowledgeWithFallback,
} from './index.js';

const MOCK_ROOT = join('/', 'mock');
const KNOWLEDGE_DIR = join(MOCK_ROOT, 'resources', 'desktop', 'knowledge');

function makeDirent(name: string, isDir: boolean): Dirent {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
  } as unknown as Dirent;
}

function setupFsMock(files: Record<string, string>): void {
  vi.mocked(getDirname).mockReturnValue(MOCK_ROOT);
  vi.mocked(existsSync).mockImplementation((p) => String(p) === KNOWLEDGE_DIR);
  vi.mocked(readdirSync).mockImplementation(((dir: unknown) => {
    const prefix = String(dir);
    const children = new Set<string>();
    for (const absPath of Object.keys(files)) {
      if (absPath.startsWith(prefix + sep)) {
        const first = absPath.slice(prefix.length + 1).split(sep)[0];
        children.add(first);
      }
    }
    return Array.from(children)
      .sort()
      .map((name) => {
        const fullPath = join(prefix, name);
        const isDir = Object.keys(files).some((k) => k.startsWith(fullPath + sep));
        return makeDirent(name, isDir);
      });
  }) as any);
  vi.mocked(readFileSync).mockImplementation((p) => {
    const content = files[String(p)];
    if (content === undefined) throw new Error(`ENOENT: ${p}`);
    return content;
  });
}

describe('knowledge/index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearKnowledgeCache();
    _resetKnowledgeSearchCache();
  });

  describe('getKnowledgeDir', () => {
    it('returns the first candidate that exists', () => {
      vi.mocked(getDirname).mockReturnValue(MOCK_ROOT);
      vi.mocked(existsSync).mockImplementation((p) => String(p) === KNOWLEDGE_DIR);
      expect(getKnowledgeDir()).toBe(KNOWLEDGE_DIR);
    });
  });

  describe('listKnowledgeResources', () => {
    it('returns resources with correct URIs', () => {
      setupFsMock({
        [join(KNOWLEDGE_DIR, 'strategy', 'viz-design', 'chart-selection.md')]:
          '# Chart Selection\nPick the right chart.',
        [join(KNOWLEDGE_DIR, 'tactics', 'viz', 'filters.md')]: '# Filters\nHow to use filters.',
      });

      const resources = listKnowledgeResources();

      expect(resources).toHaveLength(2);
      expect(resources.map((r) => r.uri)).toEqual([
        'expertise://tableau/strategy/viz-design/chart-selection',
        'expertise://tableau/tactics/viz/filters',
      ]);
    });

    it('throws an explicit asset-root error when the corpus is empty', () => {
      setupFsMock({});

      expect(() => listKnowledgeResources()).toThrow(
        `Knowledge corpus is empty; expected assets under ${KNOWLEDGE_DIR}`,
      );
    });

    it('extracts name from h1 heading', () => {
      setupFsMock({
        [join(KNOWLEDGE_DIR, 'test.md')]: '# My Resource\nDescription here.',
      });

      const [resource] = listKnowledgeResources();
      expect(resource.name).toBe('My Resource');
    });

    it('extracts description from first non-heading text line', () => {
      setupFsMock({
        [join(KNOWLEDGE_DIR, 'test.md')]: '# Title\n\nFirst paragraph.',
      });

      const [resource] = listKnowledgeResources();
      expect(resource.description).toBe('First paragraph.');
    });

    it('caches results across calls', () => {
      setupFsMock({ [join(KNOWLEDGE_DIR, 'test.md')]: '# Test\nContent.' });

      listKnowledgeResources();
      listKnowledgeResources();

      expect(readdirSync).toHaveBeenCalledTimes(1);
    });
  });

  describe('readKnowledgeResource', () => {
    it('returns content for a valid URI', () => {
      setupFsMock({
        [join(KNOWLEDGE_DIR, 'strategy', 'viz-design', 'chart-selection.md')]:
          '# Chart Selection\nContent.',
      });

      const result = readKnowledgeResource(
        'expertise://tableau/strategy/viz-design/chart-selection',
      );
      expect(result).toBe('# Chart Selection\nContent.');
    });

    it('returns null for unknown slug', () => {
      setupFsMock({});
      expect(readKnowledgeResource('expertise://tableau/nonexistent')).toBeNull();
    });

    it('returns null for wrong URI scheme', () => {
      setupFsMock({});
      expect(
        readKnowledgeResource('http://tableau/strategy/viz-design/chart-selection'),
      ).toBeNull();
    });

    it('returns null for path traversal attempt', () => {
      setupFsMock({});
      expect(readKnowledgeResource('expertise://tableau/../../../etc/passwd')).toBeNull();
    });

    it('returns null for slug with backslash', () => {
      setupFsMock({});
      expect(readKnowledgeResource('expertise://tableau/viz\\chart')).toBeNull();
    });
  });

  describe('searchKnowledgeWithFallback', () => {
    it('throws an explicit asset-root error when the search index is empty', () => {
      setupFsMock({});

      expect(() => searchKnowledgeWithFallback('chart choice', 3)).toThrow(
        `Knowledge corpus is empty; expected assets under ${KNOWLEDGE_DIR}`,
      );
    });

    it('singularizes known-safe plural endings before keyword ranking', () => {
      setupFsMock({
        [join(KNOWLEDGE_DIR, 'country.md')]:
          '# Country\n- Relevant user prompts/search terms: country\n\n## When to Use\nCountry maps.',
        [join(KNOWLEDGE_DIR, 'category.md')]:
          '# Category\n- Relevant user prompts/search terms: category\n\n## When to Use\nCategory bars.',
        [join(KNOWLEDGE_DIR, 'class.md')]:
          '# Class\n- Relevant user prompts/search terms: class\n\n## When to Use\nClass attributes.',
        [join(KNOWLEDGE_DIR, 'box.md')]:
          '# Box\n- Relevant user prompts/search terms: box\n\n## When to Use\nBox plots.',
      });

      expect(searchKnowledge('countries', 1)[0]?.slug).toBe('country');
      expect(searchKnowledge('categories', 1)[0]?.slug).toBe('category');
      expect(searchKnowledge('classes', 1)[0]?.slug).toBe('class');
      expect(searchKnowledge('boxes', 1)[0]?.slug).toBe('box');
    });

    it('does not singularize exception words that look like plural endings', () => {
      setupFsMock({
        [join(KNOWLEDGE_DIR, 'series.md')]:
          '# Series\n- Relevant user prompts/search terms: series\n\n## When to Use\nTime series.',
        [join(KNOWLEDGE_DIR, 'sery.md')]:
          '# Sery\n- Relevant user prompts/search terms: sery\n\n## When to Use\nSynthetic stem.',
        [join(KNOWLEDGE_DIR, 'species.md')]:
          '# Species\n- Relevant user prompts/search terms: species\n\n## When to Use\nSpecies dimension.',
        [join(KNOWLEDGE_DIR, 'specy.md')]:
          '# Specy\n- Relevant user prompts/search terms: specy\n\n## When to Use\nSynthetic stem.',
      });

      expect(searchKnowledge('series', 1)[0]?.slug).toBe('series');
      expect(searchKnowledge('species', 1)[0]?.slug).toBe('species');
    });

    it('does not turn stopword-only queries into whole-string hits', () => {
      setupFsMock({
        [join(KNOWLEDGE_DIR, 'stopwords.md')]:
          '# The And With\n- Relevant user prompts/search terms: the and with\n\n## When to Use\nStopword phrase.',
      });

      const result = searchKnowledgeWithFallback('the and with', 3);

      expect(result.hits).toEqual([]);
    });
  });
});
