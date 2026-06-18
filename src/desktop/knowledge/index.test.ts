import { join, sep } from 'path';

vi.mock('fs');
vi.mock('../../utils/getDirname.js');

import { Dirent, existsSync, readdirSync, readFileSync } from 'fs';

import { getDirname } from '../../utils/getDirname.js';
import {
  clearKnowledgeCache,
  getKnowledgeDir,
  listKnowledgeResources,
  readKnowledgeResource,
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

function setupFsMock(files: Record<string, string>) {
  vi.mocked(getDirname).mockReturnValue(MOCK_ROOT);
  vi.mocked(existsSync).mockImplementation((p) => String(p) === KNOWLEDGE_DIR);
  vi.mocked(readdirSync).mockImplementation((dir) => {
    const prefix = String(dir);
    const children = new Set<string>();
    for (const absPath of Object.keys(files)) {
      if (absPath.startsWith(prefix + sep)) {
        const first = absPath.slice(prefix.length + 1).split(sep)[0];
        children.add(first);
      }
    }
    return Array.from(children).sort().map((name) => {
      const fullPath = join(prefix, name);
      const isDir = Object.keys(files).some((k) => k.startsWith(fullPath + sep));
      return makeDirent(name, isDir);
    });
  });
  vi.mocked(readFileSync).mockImplementation((p) => {
    const content = files[String(p)];
    if (content === undefined) throw new Error(`ENOENT: ${p}`);
    return content as unknown as Buffer;
  });
}

describe('knowledge/index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearKnowledgeCache();
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
        [join(KNOWLEDGE_DIR, 'viz-design', 'chart-selection.md')]:
          '# Chart Selection\nPick the right chart.',
        [join(KNOWLEDGE_DIR, 'tableau-tactics', 'viz', 'filters.md')]:
          '# Filters\nHow to use filters.',
      });

      const resources = listKnowledgeResources();

      expect(resources).toHaveLength(2);
      expect(resources.map((r) => r.uri)).toEqual([
        'expertise://tableau/tableau-tactics/viz/filters',
        'expertise://tableau/viz-design/chart-selection',
      ]);
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
        [join(KNOWLEDGE_DIR, 'viz-design', 'chart-selection.md')]:
          '# Chart Selection\nContent.',
      });

      const result = readKnowledgeResource('expertise://tableau/viz-design/chart-selection');
      expect(result).toBe('# Chart Selection\nContent.');
    });

    it('returns null for unknown slug', () => {
      setupFsMock({});
      expect(readKnowledgeResource('expertise://tableau/nonexistent')).toBeNull();
    });

    it('returns null for wrong URI scheme', () => {
      setupFsMock({});
      expect(readKnowledgeResource('http://tableau/viz-design/chart-selection')).toBeNull();
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
});
