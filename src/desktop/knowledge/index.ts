import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, relative, resolve, sep } from 'path';

import { getDirname } from '../../utils/getDirname.js';

export interface KnowledgeResource {
  uri: string;
  name: string;
  description: string;
  mimeType: 'text/markdown';
}

interface FileEntry {
  slug: string;
  absPath: string;
}

export function getKnowledgeDir(): string {
  const candidates = [
    join(getDirname(), 'resources', 'desktop', 'knowledge'),
    join(getDirname(), '..', 'resources', 'desktop', 'knowledge'),
  ];
  return candidates.find(existsSync) ?? candidates[0];
}

function walkDir(rootDir: string): FileEntry[] {
  const results: FileEntry[] = [];

  function walk(dir: string): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const rel = relative(rootDir, full);
        const slug = rel.replace(/\.md$/, '').split(sep).join('/');
        results.push({ slug, absPath: full });
      }
    }
  }

  walk(rootDir);
  results.sort((a, b) => a.slug.localeCompare(b.slug));
  return results;
}

function extractMeta(absPath: string): { name: string; description: string } {
  try {
    const lines = readFileSync(absPath, 'utf-8').split('\n');
    const titleLine = lines.find((l) => l.startsWith('# '));
    const name = titleLine ? titleLine.replace(/^#\s+/, '') : absPath;
    const titleIdx = titleLine ? lines.indexOf(titleLine) : -1;
    for (let i = titleIdx + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line && !line.startsWith('#') && !line.startsWith('```')) {
        const description = line.length > 200 ? line.slice(0, 200) + '...' : line;
        return { name, description };
      }
    }
    return { name, description: '' };
  } catch {
    return { name: absPath, description: '' };
  }
}

let _cache: KnowledgeResource[] | null = null;

export function listKnowledgeResources(): KnowledgeResource[] {
  if (_cache) return _cache;
  const files = walkDir(getKnowledgeDir());
  _cache = files.map(({ slug, absPath }) => {
    const { name, description } = extractMeta(absPath);
    return { uri: `expertise://tableau/${slug}`, name, description, mimeType: 'text/markdown' };
  });
  return _cache;
}

export function readKnowledgeResource(uri: string): string | null {
  const PREFIX = 'expertise://tableau/';
  if (!uri.startsWith(PREFIX)) return null;
  const slug = uri.slice(PREFIX.length);
  if (!slug || slug.includes('..') || slug.includes('\\') || slug.startsWith('/')) return null;

  const knowledgeDir = getKnowledgeDir();
  const filePath = join(knowledgeDir, slug + '.md');
  const resolved = resolve(filePath);
  const rootResolved = resolve(knowledgeDir);
  if (!resolved.startsWith(rootResolved + sep) && resolved !== rootResolved) return null;

  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

export function clearKnowledgeCache(): void {
  _cache = null;
}
