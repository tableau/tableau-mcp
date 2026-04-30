import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import fs, { existsSync, readFileSync } from 'fs';
import path, { join, relative } from 'path';

import { getDirname } from '../utils/getDirname';

const RESOURCE_ROOTS = [
  join(getDirname(), 'resources', 'desktop'),
  join(getDirname(), '..', 'src', 'resources', 'desktop'),
];

const RESOURCES_ROOT = RESOURCE_ROOTS.find(existsSync) ?? RESOURCE_ROOTS[0];
const KNOWLEDGE_DIR = join(RESOURCES_ROOT, 'knowledge');

export type KnowledgeResource = {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
};

let _cache: KnowledgeResource[] | null = null;

type FileEntry = {
  slug: string;
  absPath: string;
};

/**
 * Walk a directory recursively and return all `.md` files as slugs
 * (paths relative to `rootDir`, forward-slashed, without `.md`).
 */
function walkKnowledgeDir(rootDir: string): FileEntry[] {
  const results: FileEntry[] = [];

  function walk(currentDir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const full = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const rel = relative(rootDir, full);
        const slug = rel.replace(/\.md$/, '').split(path.sep).join('/');
        results.push({ slug, absPath: full });
      }
    }
  }

  walk(rootDir);
  results.sort((a, b) => a.slug.localeCompare(b.slug));
  return results;
}

/**
 * Scan data/knowledge/ recursively and return an array of MCP resource
 * descriptors. Results are cached after the first call (restart server
 * to pick up new files).
 */
export function listKnowledgeResources(): KnowledgeResource[] {
  if (_cache) return _cache;

  const files = walkKnowledgeDir(KNOWLEDGE_DIR);

  _cache = files.map(({ slug, absPath }) => {
    let name: string = slug;
    let description = '';
    try {
      const content = readFileSync(absPath, 'utf-8');
      const lines = content.split('\n');
      const titleLine = lines.find((l) => l.startsWith('# '));
      if (titleLine) {
        name = titleLine.replace(/^#\s+/, '');
      }

      const titleIdx = titleLine ? lines.indexOf(titleLine) : -1;

      for (let i = titleIdx + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line && !line.startsWith('#') && !line.startsWith('```')) {
          description = line.length > 200 ? line.slice(0, 200) + '...' : line;
          break;
        }
      }
    } catch {
      /* ignore read errors */
    }

    return {
      uri: `expertise://tableau/${slug}`,
      name,
      description,
      mimeType: 'text/markdown',
    };
  });

  return _cache;
}

/**
 * Read a knowledge module by URI. Returns the markdown content or null.
 * Accepts slugs with `/` (hierarchical), but rejects path traversal
 * and absolute paths.
 */
export function readKnowledgeResource(uri: string): string | null {
  const prefix = 'expertise://tableau/';
  if (!uri.startsWith(prefix)) {
    throw new McpError(ErrorCode.InvalidParams, `Invalid expertise URI: ${uri}`);
  }

  const slug = uri.slice(prefix.length);
  if (!slug) {
    throw new McpError(ErrorCode.InvalidParams, `Invalid expertise slug: ${slug}`);
  }

  // Reject path traversal and Windows-style separators
  if (slug.includes('..') || slug.includes('\\')) {
    throw new McpError(ErrorCode.InvalidParams, `Invalid expertise slug: ${slug}`);
  }

  // Disallow leading slash
  if (slug.startsWith('/')) {
    throw new McpError(ErrorCode.InvalidParams, `Invalid expertise slug: ${slug}`);
  }

  const filePath = join(KNOWLEDGE_DIR, `${slug}.md`);

  // Ensure resolved path stays inside KNOWLEDGE_DIR
  const resolved = path.resolve(filePath);
  const rootResolved = path.resolve(KNOWLEDGE_DIR);
  if (!resolved.startsWith(rootResolved + path.sep) && resolved !== rootResolved) {
    throw new McpError(ErrorCode.InvalidParams, `Invalid expertise slug: ${slug}`);
  }

  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    throw new McpError(ErrorCode.InternalError, `Failed to read knowledge resource: ${filePath}`);
  }
}
