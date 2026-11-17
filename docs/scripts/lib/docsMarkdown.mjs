// Shared markdown cleaning for derived docs artifacts (tool catalog, llms.txt).
//
// Moved out of generateToolCatalog.mjs so both generators substitute the same
// variables, skip the same availability caption, and produce the same first
// sentence. Public-side: lives under docs/ so the public mirror can run it.
//
// Dependency-free ESM. Node >= 18.

import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { VARIABLES, substituteVariables } from '../../src/remark/variables.mjs';

import { NONPUBLISH_RE } from './nonpublishable.mjs';

const EXT_JSON = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../src/data/ext.json'), 'utf8'),
);

export { VARIABLES, substituteVariables };

export const PAGE_ROOTS = ['web-tools', 'desktop-tools'];
export const TOOL_TYPE_BY_ROOT = {
  'web-tools': 'Web Tools',
  'desktop-tools': 'Desktop Tools',
};
export const TOOL_TYPE_ORDER = ['Web Tools', 'Desktop Tools'];
export const SKIP_BASENAMES = new Set(['overview.md']);
export const INDEX_BASENAMES = new Set(['README.md', 'index.md', 'README.mdx', 'index.mdx']);

export const toolTypeForRel = (rel) => TOOL_TYPE_BY_ROOT[rel.split('/')[0]] ?? null;

export const substituteVars = (s) => substituteVariables(String(s));

export function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

// The inline ship-availability note (see format-tool-doc STRUCTURE.md). Current
// canon is a classed <span>; the italic line is the leftover form still skipped
// so a half-migrated page cannot leak it into a summary.
//   {/* availability */}
//   <span className="toolAvailability">Available January 2027 and later.</span>
//   {/* /availability */}
const AVAILABILITY_LINE_RE = /^_Available\b.*\band later\._$/m;
const AVAILABILITY_SPAN_RE =
  /<span\s+className="toolAvailability">[\s\S]*?<\/span>/g;
const MDX_COMMENT_RE = /\{\/\*[\s\S]*?\*\/\}/g;
const MDX_COMMENT_OPEN_RE = /^\{\/\*/;
const MDX_COMMENT_CLOSE_RE = /\*\/\}/;
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
const EXT_PROTOCOL = /^ext:\/\/([^/]+)(?:\/(.*))?$/;
const OFFICIAL_ORIGIN = 'https://tableau.github.io';

export function cleanInline(text) {
  return substituteVars(text)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function firstSentence(text) {
  const m = /^(.*?[.!?])(\s|$)/s.exec(text.trim());
  return (m ? m[1] : text.trim()).trim();
}

export function stripHtml(text) {
  return String(text)
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function outboundExtEnv(env = process.env) {
  // Match docs/src/extLinks/resolve.ts: only an explicit official origin bakes
  // prod sibling-doc bases. Unset GITHUB_ORIGIN (local start/build) is stage.
  return env.GITHUB_ORIGIN === OFFICIAL_ORIGIN ? 'prod' : 'stage';
}

export function parseExtProtocol(url) {
  const match = EXT_PROTOCOL.exec(String(url));
  if (!match) return null;
  return { site: match[1], path: (match[2] ?? '').replace(/^\/+/, '') };
}

export function joinBasePath(base, path = '') {
  if (!path) return base;
  if (path.startsWith('//') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) {
    throw new Error(`ext link path must be relative, got: ${path}`);
  }
  const trimmed = path.replace(/^\/+/, '');
  if (!trimmed) return base;
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return new URL(trimmed, normalizedBase).href;
}

export function resolveExtUrl(url, env = process.env) {
  const parsed = parseExtProtocol(url);
  if (!parsed) return url;
  const entry = EXT_JSON[parsed.site];
  if (!entry) return url;
  const baked = outboundExtEnv(env);
  const base = baked === 'prod' ? entry.prod : (entry.stage ?? entry.prod);
  if (!base) return url;
  return joinBasePath(base, parsed.path);
}

export function rewriteExtLinks(markdown, env = process.env) {
  return String(markdown).replace(
    /\[([^\]]*)\]\((ext:\/\/[^)]+)\)/g,
    (_m, label, href) => `[${label}](${resolveExtUrl(href, env)})`,
  );
}

/**
 * Docusaurus route for a docs-root-relative source path.
 * README.md / index.md become the folder URL, not /…/README.
 */
export function docPathForRel(rel) {
  const normalized = String(rel).replace(/\\/g, '/');
  const noExt = normalized.replace(/\.(mdx|md)$/, '');
  const parts = noExt.split('/');
  const base = parts[parts.length - 1];
  if (base === 'README' || base === 'index') {
    const dir = parts.slice(0, -1).join('/');
    return '/docs' + (dir ? `/${dir}` : '');
  }
  return `/docs/${noExt}`;
}

export function parseFrontMatter(raw) {
  const src = String(raw);
  if (!src.startsWith('---')) return { fm: {}, body: src };
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  if (!m) return { fm: {}, body: src };
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    fm[kv[1]] = kv[2].replace(/^['"]|['"]$/g, '');
  }
  return { fm, body: src.slice(m[0].length) };
}

export function sidebarPositionOf(raw, fallback = 999) {
  const n = Number(parseFrontMatter(raw).fm.sidebar_position);
  return Number.isFinite(n) ? n : fallback;
}

export function isPublishablePageName(name) {
  return (
    (name.endsWith('.md') || name.endsWith('.mdx')) &&
    !name.startsWith('_') &&
    !NONPUBLISH_RE.test(name)
  );
}

function skipAvailabilityAndComments(lines, start) {
  let i = start;
  const para = [];
  for (; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) {
      if (para.length) break;
      continue;
    }
    if (AVAILABILITY_LINE_RE.test(t)) {
      if (para.length) break;
      continue;
    }
    if (MDX_COMMENT_OPEN_RE.test(t)) {
      if (para.length) break;
      let j = i;
      while (j < lines.length && !MDX_COMMENT_CLOSE_RE.test(lines[j])) j++;
      i = j;
      continue;
    }
    if (/^(import\s|:::|<|#{1,6}\s|>|\||```)/.test(t)) {
      if (para.length) break;
      continue;
    }
    para.push(t);
  }
  return para;
}

// Derive { title, summary } from the page's H1 and first Overview paragraph,
// skipping front matter directives, imports, admonitions, JSX/HTML, and the
// inline ship-availability note (its MDX-comment block and the caption line).
export function derivePageProseFromSource(raw, fallbackTitle) {
  const lines = String(raw).split('\n');
  let title = null;
  let i = 0;
  for (; i < lines.length; i++) {
    const m = /^#\s+(.*)$/.exec(lines[i]);
    if (m) {
      title = substituteVars(m[1].trim());
      i++;
      break;
    }
  }
  const para = skipAvailabilityAndComments(lines, i);
  let summary = substituteVars(para.join(' '));
  summary = summary
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  summary = firstSentence(summary);
  return { title: title ?? fallbackTitle, summary };
}

export function derivePageProse(pageAbs) {
  return derivePageProseFromSource(
    readFileSync(pageAbs, 'utf8'),
    basename(pageAbs).replace(/\.(mdx|md)$/, ''),
  );
}

export function categoryInfo(pageAbs) {
  const cat = readJson(join(dirname(pageAbs), '_category_.json'), {});
  const label =
    cat.label ||
    basename(dirname(pageAbs))
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  const description = cat.link && cat.link.description ? cleanInline(cat.link.description) : '';
  return { label, description };
}

function stripAdmonitions(src) {
  return src.replace(/^:::[\w-]+[^\n]*\n([\s\S]*?)^:::\s*$/gm, (_m, body) =>
    String(body)
      .split('\n')
      .map((l) => (l.trim() ? `> ${l}` : '>'))
      .join('\n'),
  );
}

/**
 * Plain markdown an agent can read: no frontmatter, no MDX/JSX, variables
 * substituted, ext:// links resolved, availability caption gone.
 */
export function normalizeForAgents(raw, env = process.env) {
  let text = String(raw).replace(FRONTMATTER_RE, '');
  text = text.replace(MDX_COMMENT_RE, '');
  text = text.replace(AVAILABILITY_SPAN_RE, '');
  text = text.replace(AVAILABILITY_LINE_RE, '');
  text = text.replace(/^import\s.+$/gm, '');
  text = text.replace(/<[A-Z][A-Za-z0-9]*\s*\/>/g, '');
  text = stripAdmonitions(text);
  text = rewriteExtLinks(text, env);
  text = substituteVars(text);
  text = text.replace(/<svg\b[\s\S]*?<\/svg>/gi, '');
  text = text.replace(/<span\b[^>]*>/g, '').replace(/<\/span>/g, '');
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return `${text}\n`;
}
