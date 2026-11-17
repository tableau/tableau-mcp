/**
 * Split a generated-index category description into ordinary HTML and ext://
 * anchors so the category page can render sibling-docs links through ExtSiteLink.
 *
 * `_category_.json` descriptions are JSON strings, not markdown, so the remark
 * `ext://` rewrite never sees them. Authors write the same protocol in an HTML
 * href (`<a href="ext://eca">…</a>`); this splitter is the category-page half of
 * that contract.
 */

import { parseExtProtocol, type ExtSite } from './resolve';

export type CategoryDescriptionPart =
  | { kind: 'html'; html: string }
  | { kind: 'ext'; site: ExtSite; path: string; text: string };

const EXT_ANCHOR = /<a\b[^>]*\bhref="(ext:\/\/[^"]+)"[^>]*>(.*?)<\/a>/gi;

export function splitCategoryDescription(html: string): CategoryDescriptionPart[] {
  const parts: CategoryDescriptionPart[] = [];
  let lastIndex = 0;
  for (const match of html.matchAll(EXT_ANCHOR)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push({ kind: 'html', html: html.slice(lastIndex, index) });
    }
    const parsed = parseExtProtocol(match[1]);
    if (!parsed) {
      throw new Error(`category description has an invalid ext:// href: ${match[1]}`);
    }
    parts.push({
      kind: 'ext',
      site: parsed.site,
      path: parsed.path,
      text: match[2],
    });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < html.length || parts.length === 0) {
    parts.push({ kind: 'html', html: html.slice(lastIndex) });
  }
  return parts;
}
