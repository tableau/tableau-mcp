import {
  type AskMode,
  type AskOption,
  INSIGHT_BUNDLE_ARTIFACT_TYPE,
  requireToolAllowlistedKind,
  type Utterance,
  type UtteranceBody,
} from './utterance.js';

export function summaryDataUtterance(input: {
  caption?: string;
  columns: unknown[];
  rows: unknown[];
}): Utterance {
  requireToolAllowlistedKind('result');
  const body: Extract<UtteranceBody, { type: 'table' }> = {
    type: 'table',
    columns: summaryColumns(input.columns),
    rows: summaryRows(input.rows),
  };
  if (input.caption !== undefined && input.caption.length > 0) {
    body.caption = input.caption;
  }
  return { kind: 'result', body };
}

export function queryDataUtterance(data: unknown): Utterance {
  requireToolAllowlistedKind('result');
  return { kind: 'result', body: objectRowsToTable(data) };
}

export function askUtteranceFromInput(input: {
  question: string;
  urgency?: 'blocking' | 'soft';
  options?: string[];
}): Utterance {
  const kind = input.urgency === 'soft' ? 'proposal' : 'question';
  requireToolAllowlistedKind(kind);
  return {
    kind,
    body: {
      type: 'ask',
      stem: input.question,
      mode: askModeFor(input.options),
      options: (input.options ?? []).map((pick): AskOption => ({ pick })),
    },
  };
}

export function insightBundleUtterance(payload: unknown): Utterance {
  requireToolAllowlistedKind('delivery');
  return {
    kind: 'delivery',
    body: {
      type: 'artifact',
      artifactType: INSIGHT_BUNDLE_ARTIFACT_TYPE,
      payload,
    },
  };
}

function askModeFor(options: string[] | undefined): AskMode {
  if (options?.length === 2) {
    return 'binary';
  }
  return 'chips';
}

function summaryColumns(columns: unknown[]): string[] {
  return columns.map((column, index) => {
    if (typeof column === 'string' && column.length > 0) {
      return column;
    }
    if (column && typeof column === 'object' && 'name' in column) {
      const name = (column as { name?: unknown }).name;
      if (typeof name === 'string' && name.length > 0) {
        return name;
      }
    }
    return `column_${index + 1}`;
  });
}

function summaryRows(rows: unknown[]): string[][] {
  return rows.map((row) => {
    if (!Array.isArray(row)) {
      return [cellText(row)];
    }
    return row.map(cellText);
  });
}

function objectRowsToTable(data: unknown): Extract<UtteranceBody, { type: 'table' }> {
  if (!Array.isArray(data) || data.length === 0) {
    return { type: 'table', columns: [], rows: [] };
  }
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of data) {
    if (!isPlainRecord(row)) {
      continue;
    }
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  return {
    type: 'table',
    columns,
    rows: data.map((row) => {
      if (!isPlainRecord(row)) {
        return columns.map(() => cellText(row));
      }
      return columns.map((column) => cellText(row[column]));
    }),
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return JSON.stringify(value) ?? '';
}
