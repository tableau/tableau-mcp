// Project release-notes.mdx into readable markdown for family full-text files.
//
// The MDX page is almost empty — it renders ReleaseNotes from JSON. Agents
// reading the normalized source would otherwise get a blank page. Same grouping
// as docs/src/components/ReleaseNotes (month → tool type → category).

import { substituteVars } from './docsMarkdown.mjs';

const CHANGE_TYPE_ORDER = ['ADD', 'UPDATE', 'DEPRECATE', 'RETIRE'];
const TOOL_TYPE_ORDER = ['Web Tools', 'Desktop Tools'];

function formatMonthYear(isoDate) {
  const [year, month] = String(isoDate).split('-').map(Number);
  const date = new Date(Date.UTC(year, (month ?? 1) - 1, 1));
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function toolTypeRank(toolType) {
  const i = TOOL_TYPE_ORDER.indexOf(toolType);
  return i === -1 ? TOOL_TYPE_ORDER.length : i;
}

export function projectReleaseNotesMarkdown(entries, siteContent, pageUrl) {
  const byMonth = new Map();
  for (const e of entries) {
    const key = String(e.date).slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(e);
  }
  const highlightsByMonth = new Map();
  for (const h of siteContent ?? []) {
    const key = String(h.date).slice(0, 7);
    if (!highlightsByMonth.has(key)) highlightsByMonth.set(key, []);
    highlightsByMonth.get(key).push(substituteVars(h.summary));
  }

  const months = [...byMonth.keys()].sort((a, b) => b.localeCompare(a));
  const lines = [
    '# Release notes',
    '',
    `Source: ${pageUrl}`,
    '',
    "What's changed in the Tableau MCP tools, by release.",
    '',
  ];
  for (const key of months) {
    lines.push(`## ${formatMonthYear(`${key}-01`)}`, '');
    const highlights = highlightsByMonth.get(key) ?? [];
    if (highlights.length) {
      lines.push('Highlights:', '');
      for (const h of highlights) lines.push(`- ${h}`);
      lines.push('');
    }
    const items = byMonth.get(key);
    const byType = new Map();
    for (const e of items) {
      const t = e.toolType || 'Other';
      if (!byType.has(t)) byType.set(t, new Map());
      const cats = byType.get(t);
      const cat = e.toolCategory || 'Other';
      if (!cats.has(cat)) cats.set(cat, []);
      cats.get(cat).push(e);
    }
    const types = [...byType.keys()].sort(
      (a, b) => toolTypeRank(a) - toolTypeRank(b) || a.localeCompare(b),
    );
    for (const t of types) {
      lines.push(`### ${t}`, '');
      const cats = [...byType.get(t).keys()].sort((a, b) => a.localeCompare(b));
      for (const cat of cats) {
        lines.push(`#### ${cat}`, '');
        const rows = [...byType.get(t).get(cat)].sort(
          (a, b) =>
            CHANGE_TYPE_ORDER.indexOf(a.changeType) - CHANGE_TYPE_ORDER.indexOf(b.changeType) ||
            a.title.localeCompare(b.title),
        );
        for (const e of rows) {
          const summary = substituteVars(e.summary || '')
            .replace(/\s+/g, ' ')
            .trim();
          lines.push(`- ${e.changeType}: **${e.title}** — ${summary}`);
        }
        lines.push('');
      }
    }
  }
  return `${lines.join('\n').trim()}\n`;
}
