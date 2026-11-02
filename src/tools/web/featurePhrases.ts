import type { WebToolGroupName } from './toolName.js';
import { webToolGroupNames, webToolGroups } from './toolName.js';

/**
 * Plain-language name for each tool group, shown to the user when tools are omitted for missing
 * scopes (see server.web.ts). User-facing copy: no scope strings, no feature-flag names. Each phrase
 * completes "…doesn't include access for: {phrase}".
 */
const GROUP_FEATURE_PHRASES = {
  datasource: 'querying data sources',
  workbook: 'viewing and downloading workbooks',
  authoring: 'publishing workbooks and data sources',
  project: 'browsing projects',
  view: 'viewing and exporting views',
  flow: 'running and inspecting flows',
  pulse: 'Pulse metrics and insights',
  insights: 'generating insight cards',
  'content-exploration': 'content search',
  tasks: 'extract refresh tasks',
  jobs: 'viewing background jobs',
  users: 'viewing and updating users',
  'token-management': 'managing access tokens',
  'mcp-apps': 'interactive visualizations',
  'admin-insights': 'Admin Insights queries',
  content: 'deleting content',
  knowledge: 'knowledge context',
  'data-apps': 'building data apps',
} as const satisfies Record<WebToolGroupName, string>;

// Reverse lookup tool name → group, built once from the authoritative webToolGroups map.
const toolToGroup = new Map<string, WebToolGroupName>();
for (const group of webToolGroupNames) {
  for (const toolName of webToolGroups[group]) {
    toolToGroup.set(toolName, group);
  }
}

const groupOrder = new Map<WebToolGroupName, number>(
  webToolGroupNames.map((group, index) => [group, index]),
);

/**
 * Map a set of omitted tool names to the distinct human-readable feature phrases they belong to.
 * Mapped phrases come first, ordered by group declaration order; a tool with no known group falls
 * back to its own raw name, appended after the mapped phrases in first-seen order.
 */
export function featurePhrasesForTools(toolNames: string[]): string[] {
  const mapped = new Set<WebToolGroupName>();
  const unmapped: string[] = [];
  const seenUnmapped = new Set<string>();

  for (const toolName of toolNames) {
    const group = toolToGroup.get(toolName);
    if (group === undefined) {
      if (!seenUnmapped.has(toolName)) {
        seenUnmapped.add(toolName);
        unmapped.push(toolName);
      }
      continue;
    }
    mapped.add(group);
  }

  const mappedPhrases = Array.from(mapped)
    .sort((a, b) => (groupOrder.get(a) ?? 0) - (groupOrder.get(b) ?? 0))
    .map((group) => GROUP_FEATURE_PHRASES[group]);

  return [...mappedPhrases, ...unmapped];
}
