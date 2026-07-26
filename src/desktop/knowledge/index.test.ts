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

    it('includes the only matching module body within the payload cap', () => {
      const body = [
        '# Margin Calculation',
        '- Relevant user prompts/search terms: margin calculation',
        '',
        '## When to Use',
        'Use this for margin calculations.',
      ].join('\n');
      setupFsMock({ [join(KNOWLEDGE_DIR, 'margin-calculation.md')]: body });

      const result = searchKnowledgeWithFallback('margin calculation', 5);

      expect(result.hits).toHaveLength(1);
      expect(result.topHitBody).toBe(body);
      expect(Buffer.byteLength(result.topHitBody ?? '', 'utf8')).toBeLessThanOrEqual(6_144);
    });

    it('omits the module body when the top two scores are close', () => {
      const sharedMetadata = [
        '- Relevant user prompts/search terms: margin calculation',
        '',
        '## When to Use',
        'Use this for margin calculations.',
      ].join('\n');
      setupFsMock({
        [join(KNOWLEDGE_DIR, 'alpha.md')]: `# Alpha\n${sharedMetadata}`,
        [join(KNOWLEDGE_DIR, 'beta.md')]: `# Beta\n${sharedMetadata}`,
      });

      const result = searchKnowledgeWithFallback('margin calculation', 5);

      expect(result.hits).toHaveLength(2);
      expect(result.hits[0].score - result.hits[1].score).toBeLessThan(0.15);
      expect(result).not.toHaveProperty('topHitBody');
    });

    it('includes the top module body when its score clears the runner-up by 0.15', () => {
      const topBody = [
        '# Margin Calculation',
        '- Relevant user prompts/search terms: margin calculation',
        '',
        '## When to Use',
        'Use this for margin calculations.',
      ].join('\n');
      setupFsMock({
        [join(KNOWLEDGE_DIR, 'margin-calculation.md')]: topBody,
        [join(KNOWLEDGE_DIR, 'margin-overview.md')]:
          '# Margin Overview\n- Relevant user prompts/search terms: margin',
      });

      const result = searchKnowledgeWithFallback('margin calculation', 5);

      expect(result.hits).toHaveLength(2);
      expect(result.hits[0].score - result.hits[1].score).toBeGreaterThanOrEqual(0.15);
      expect(result.topHitBody).toBe(topBody);
    });

    it('truncates an oversized module body with a marker inside the payload cap', () => {
      const body = [
        '# Margin Calculation',
        '- Relevant user prompts/search terms: margin calculation',
        '',
        '## When to Use',
        'Use this for margin calculations.',
        '',
        'x'.repeat(7_000),
      ].join('\n');
      setupFsMock({ [join(KNOWLEDGE_DIR, 'margin-calculation.md')]: body });

      const result = searchKnowledgeWithFallback('margin calculation', 5);

      expect(result.topHitBody).toContain('[TRUNCATED: body exceeds 6144-byte cap]');
      expect(Buffer.byteLength(result.topHitBody ?? '', 'utf8')).toBeLessThanOrEqual(6_144);
    });
  });
});
