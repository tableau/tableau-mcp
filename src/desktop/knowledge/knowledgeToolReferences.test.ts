import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

import { desktopToolNames } from '../../tools/desktop/toolName.js';
import { getKnowledgeDir } from './index.js';

const registeredDesktopToolNames = new Set<string>(desktopToolNames);

const allowedNonToolTokens = new Set<string>([
  'advanced-chart-builds',
  'agent-to-tableau-desktop',
  'apply-calculation-for-create-or-update',
  'attrition-kpi',
  'axis-column',
  'axis-labels',
  'axis-title',
  'base-agg',
  'build-sheet',
  'calc-name',
  'captured-sheet',
  'categorical-filter-slices',
  'change-parameter',
  'checked-out',
  'client-side',
  'color-blind',
  'color-mode',
  'color-palette',
  'column-instance',
  'command-not-found',
  'computed-sort',
  'computed-sort-crash',
  'create-new-parameter',
  'create-or-edit-parameter',
  'custom-type-name',
  'customized-tooltip',
  'dashboard-archetypes',
  'dashboard-extension',
  'dashboard-peer-review-checklist',
  'data-pane',
  'data-source',
  'datasource-dependencies',
  'datasource-relationships',
  'date-part',
  'dateparse-friendly',
  'default-aggregation',
  'default-format',
  'design-principles',
  'desktop-authoring',
  'diff-options',
  'dim-ordering',
  'distribute-evenly',
  'document-format-change-manifest',
  'drag-and-drop',
  'drop-down',
  'edit-existing-parameter',
  'edit-filter-dialog',
  'edit-parameter-action',
  'empty-level',
  'enable-instant-analytics',
  'encoding-icon',
  'excel-direct',
  'export-image-layout-options',
  'extension-version',
  'fast-path',
  'field-captions',
  'field-level',
  'file-name',
  'filter-action',
  'filter-group',
  'fiscal-year-start',
  'fixed-width',
  'font-color',
  'font-size',
  'font-style',
  'font-weight',
  'formatted-text',
  'free-form',
  'full-canvas',
  'get-export-image-layout-options',
  'high-cardinality',
  'invalid-column-instance-pivot',
  'invalid-derivation-string',
  'invalid-request-body',
  'label-type',
  'layout-basic',
  'layout-flow',
  'letter-s',
  'letter-t',
  'level-address',
  'level-break',
  'level-members',
  'low-cardinality',
  'malformed-top-n-filter',
  'manifest-version',
  'manual-sort',
  'mark-labels-mode',
  'mark-labels-range-field',
  'mark-labels-show',
  'mark-transparency',
  'mark-type',
  'marks-and-encodings',
  'marks-scaling-off',
  'measure-ordering',
  'metadata-records',
  'min-api-version',
  'multi-select',
  'named-connections',
  'natural-sort',
  'object-graph',
  'on-select',
  'ordered-diverging',
  'ordered-sequential',
  'ordering-field',
  'ordering-type',
  'original-version',
  'paired-id',
  'param-domain-type',
  'parameter-driven-views',
  'part-to-whole',
  'part-to-whole-waterfall',
  'per-cell',
  'per-pane',
  'per-table',
  'plugin-tableau-master',
  'post-apply',
  'pre-apply',
  'quick-filter',
  'rank-as-membership',
  'rank-options',
  'redundant-color-encoding',
  'reference-line',
  'reference-parameter',
  'relative-date',
  'repository-location',
  'right-click',
  'row-level',
  'semantic-role',
  'shelf-sort-deltas',
  'shelf-sort-v2',
  'shelf-sorts',
  'show-sort-dialog',
  'show-structure',
  'side-by-side',
  'simple-id',
  'single-select',
  'size-bar',
  'sizing-mode',
  'sort-by',
  'source-build',
  'source-field',
  'source-location',
  'source-platform',
  'stepwise-build',
  'story-points',
  'style-rule',
  'table-calc',
  'table-calculations',
  'tableau-date-handling',
  'tableau-desktop-commands-reference',
  'tableau-document-schemas',
  'tableau-package',
  'tableau-server-client',
  'tableau-speak',
  'target-parameter',
  'text-align',
  'tooltip-dimension-requires-attr',
  'top-n',
  'type-h',
  'type-v2',
  'type-w',
  'user-facing',
  'value-column',
  'vertical-align',
  'visual-doc',
  'visual-docs',
  'window-options',
  'workbook-calcs',
  'worksheet-extension',
  'worksheet-title',
  'workspace-extension',
  'ww-floating-bars',
  'x-axis-name',
  'y-axis-name',
  'year-over-year',
  'z-order',
  'zero-row',
  'zone-style',
]);

interface CandidateReference {
  file: string;
  token: string;
  lineNumber: number;
  line: string;
}

function listMarkdownFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listMarkdownFiles(path));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(path);
    }
  }
  return files.sort();
}

function extractCandidateReferences(file: string, content: string): CandidateReference[] {
  const references: CandidateReference[] = [];
  const lines = content.split('\n');

  lines.forEach((line, index) => {
    for (const match of line.matchAll(/(?<![a-z0-9-])tableau-[a-z0-9-]+\b/g)) {
      if (isPathOrUriToken(line, match.index ?? 0, match[0].length)) {
        continue;
      }
      references.push({ file, token: match[0], lineNumber: index + 1, line });
    }

    for (const match of line.matchAll(/`([a-z][a-z0-9]*(?:-[a-z0-9]+)+)`/g)) {
      references.push({ file, token: match[1], lineNumber: index + 1, line });
    }
  });

  return references;
}

function isPathOrUriToken(line: string, index: number, length: number): boolean {
  const before = line.slice(0, index).match(/[^\s`"']*$/)?.[0] ?? '';
  const after = line.slice(index + length).match(/^[^\s`"']*/)?.[0] ?? '';
  return before.includes('/') || after.includes('/');
}

function isAllowedReference(token: string): boolean {
  return registeredDesktopToolNames.has(token) || allowedNonToolTokens.has(token);
}

describe('desktop knowledge tool references', () => {
  it('only teaches registered desktop tools', () => {
    const knowledgeDir = getKnowledgeDir();
    const offenders = listMarkdownFiles(knowledgeDir)
      .flatMap((file) =>
        extractCandidateReferences(relative(knowledgeDir, file), readFileSync(file, 'utf-8')),
      )
      .filter(({ token }) => !isAllowedReference(token));

    expect(
      offenders.map(({ file, token, lineNumber, line }) => ({
        file,
        token,
        line: `${lineNumber}: ${line.trim()}`,
      })),
    ).toEqual([]);
  });
});
