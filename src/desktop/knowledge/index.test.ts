import { join, sep } from 'path';

vi.mock('fs');

import { Dirent, readdirSync, readFileSync } from 'fs';

import {
  _resetKnowledgeSearchCache,
  clearKnowledgeCache,
  listKnowledgeResources,
  readKnowledgeResource,
  readKnowledgeSections,
  searchKnowledgeWithFallback,
  ZERO_HIT_NEAREST_MATCHES_NOTE,
} from './index.js';

// Knowledge is served only from external roots (TABLEAU_KNOWLEDGE_DIR). The fs mock below
// stands in for one such root; each test declares the files it contains by absolute path.
const KNOWLEDGE_ROOT = join('/', 'mock', 'knowledge');
const ORIGINAL_KNOWLEDGE_DIR = process.env.TABLEAU_KNOWLEDGE_DIR;

function makeDirent(name: string, isDir: boolean): Dirent {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
  } as unknown as Dirent;
}

function setupFsMock(files: Record<string, string>): void {
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
    process.env.TABLEAU_KNOWLEDGE_DIR = KNOWLEDGE_ROOT;
  });

  afterEach(() => {
    if (ORIGINAL_KNOWLEDGE_DIR === undefined) {
      delete process.env.TABLEAU_KNOWLEDGE_DIR;
    } else {
      process.env.TABLEAU_KNOWLEDGE_DIR = ORIGINAL_KNOWLEDGE_DIR;
    }
  });

  describe('listKnowledgeResources', () => {
    it('returns resources with correct URIs', () => {
      setupFsMock({
        [join(KNOWLEDGE_ROOT, 'strategy', 'viz-design', 'chart-selection.md')]:
          '# Chart Selection\nPick the right chart.',
        [join(KNOWLEDGE_ROOT, 'tactics', 'viz', 'filters.md')]: '# Filters\nHow to use filters.',
      });

      const resources = listKnowledgeResources();

      expect(resources).toHaveLength(2);
      expect(resources.map((r) => r.uri)).toEqual([
        'expertise://tableau/strategy/viz-design/chart-selection',
        'expertise://tableau/tactics/viz/filters',
      ]);
    });

    it('returns [] when no knowledge root is configured', () => {
      // No external root -> empty corpus, not an error.
      delete process.env.TABLEAU_KNOWLEDGE_DIR;
      setupFsMock({});

      expect(listKnowledgeResources()).toEqual([]);
    });

    it('returns [] when the configured root has no modules', () => {
      setupFsMock({});

      expect(listKnowledgeResources()).toEqual([]);
    });

    it('extracts name from h1 heading', () => {
      setupFsMock({
        [join(KNOWLEDGE_ROOT, 'test.md')]: '# My Resource\nDescription here.',
      });

      const [resource] = listKnowledgeResources();
      expect(resource.name).toBe('My Resource');
    });

    it('extracts description from first non-heading text line', () => {
      setupFsMock({
        [join(KNOWLEDGE_ROOT, 'test.md')]: '# Title\n\nFirst paragraph.',
      });

      const [resource] = listKnowledgeResources();
      expect(resource.description).toBe('First paragraph.');
    });

    it('caches results across calls', () => {
      setupFsMock({ [join(KNOWLEDGE_ROOT, 'test.md')]: '# Test\nContent.' });

      listKnowledgeResources();
      listKnowledgeResources();

      expect(readdirSync).toHaveBeenCalledTimes(1);
    });
  });

  describe('readKnowledgeResource', () => {
    it('returns content for a valid URI', () => {
      setupFsMock({
        [join(KNOWLEDGE_ROOT, 'strategy', 'viz-design', 'chart-selection.md')]:
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
    it('returns no hits when the corpus is empty', () => {
      setupFsMock({});

      const result = searchKnowledgeWithFallback('chart choice', 3);

      expect(result.hits).toEqual([]);
      expect(result).not.toHaveProperty('topHitBody');
    });

    it('includes the only matching module body within the payload cap', () => {
      const body = [
        '# Margin Calculation',
        '- Relevant user prompts/search terms: margin calculation',
        '',
        '## When to Use',
        'Use this for margin calculations.',
      ].join('\n');
      setupFsMock({ [join(KNOWLEDGE_ROOT, 'margin-calculation.md')]: body });

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
        [join(KNOWLEDGE_ROOT, 'alpha.md')]: `# Alpha\n${sharedMetadata}`,
        [join(KNOWLEDGE_ROOT, 'beta.md')]: `# Beta\n${sharedMetadata}`,
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
        [join(KNOWLEDGE_ROOT, 'margin-calculation.md')]: topBody,
        [join(KNOWLEDGE_ROOT, 'margin-overview.md')]:
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
      setupFsMock({ [join(KNOWLEDGE_ROOT, 'margin-calculation.md')]: body });

      const result = searchKnowledgeWithFallback('margin calculation', 5);

      expect(result.topHitBody).toContain('[TRUNCATED: body exceeds 6144-byte cap]');
      expect(Buffer.byteLength(result.topHitBody ?? '', 'utf8')).toBeLessThanOrEqual(6_144);
    });

    it('routes a token-free query through the whole-string fuse', () => {
      setupFsMock({
        [join(KNOWLEDGE_ROOT, 'greeting.md')]: [
          '# Greeting Guide',
          '- Relevant user prompts/search terms: use the greeting',
          '',
          '## When to Use',
          'Say hello.',
        ].join('\n'),
      });

      // "use"/"the" are stopwords, so queryTokens() is empty and the search must
      // fall back to a whole-string fuse match rather than keyword intersection.
      const result = searchKnowledgeWithFallback('use the', 5);

      expect(result.hits.length).toBeGreaterThan(0);
      expect(result.hits[0].match).toBe('whole-string');
    });

    it('broadens to nearest matches when nothing scores as a hit', () => {
      setupFsMock({
        [join(KNOWLEDGE_ROOT, 'margin-calculation.md')]: [
          '# Margin Calculation',
          '- Relevant user prompts/search terms: margin calculation',
          '',
          '## When to Use',
          'Use this for margin calculations.',
        ].join('\n'),
      });

      const result = searchKnowledgeWithFallback('zzzznotfound', 5);

      expect(result.hits).toEqual([]);
      expect(result.nearestMatches?.length).toBeGreaterThan(0);
      expect(result.note).toBe(ZERO_HIT_NEAREST_MATCHES_NOTE);
    });
  });

  describe('readKnowledgeResource section fragments (extractSection)', () => {
    const doc = [
      '# Guide',
      'intro line',
      '## First',
      'first body',
      '### Nested',
      'nested body',
      '## Second',
      'second body',
    ].join('\n');

    it('returns a section from its heading through the next same-or-higher heading', () => {
      setupFsMock({ [join(KNOWLEDGE_ROOT, 'guide.md')]: doc });

      const section = readKnowledgeResource('expertise://tableau/guide#first');

      expect(section).toContain('## First');
      expect(section).toContain('first body');
      expect(section).toContain('### Nested'); // a deeper heading stays inside the section
      expect(section).toContain('nested body');
      expect(section).not.toContain('second body'); // stops at the next H2
      expect(section).not.toContain('intro line');
    });

    it('matches a fragment against the literal heading text', () => {
      setupFsMock({
        [join(KNOWLEDGE_ROOT, 'guide.md')]: '# Guide\n\n## When To Use\nuse it here',
      });

      const section = readKnowledgeResource('expertise://tableau/guide#When%20To%20Use');

      expect(section).toContain('## When To Use');
      expect(section).toContain('use it here');
    });

    it('falls back to the raw fragment when the percent-escape is malformed', () => {
      setupFsMock({ [join(KNOWLEDGE_ROOT, 'guide.md')]: '# Guide\n\n## ab\nab body' });

      // "a%b" is not a valid percent-escape; decodeURIComponent throws and the raw
      // fragment is slugged instead (-> "ab"). This must not crash.
      const section = readKnowledgeResource('expertise://tableau/guide#a%b');

      expect(section).toContain('## ab');
      expect(section).toContain('ab body');
    });

    it('returns null when the fragment names no section', () => {
      setupFsMock({ [join(KNOWLEDGE_ROOT, 'guide.md')]: doc });

      expect(readKnowledgeResource('expertise://tableau/guide#missing')).toBeNull();
    });
  });

  describe('readKnowledgeSections', () => {
    it('lists H1/H2 slugs and omits deeper headings', () => {
      setupFsMock({
        [join(KNOWLEDGE_ROOT, 'guide.md')]: ['# Guide', '## First', '### Nested', '## Second'].join(
          '\n',
        ),
      });

      expect(readKnowledgeSections('guide')).toEqual(['guide', 'first', 'second']);
    });
  });
});
