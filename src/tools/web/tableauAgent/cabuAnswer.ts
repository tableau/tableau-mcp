import { CabuDatatable, CabuResponseCompleteEvent } from '../../../sdks/tableau/types/cabu.js';

/** The assembled, caller-facing answer to one `cabu-ask` turn. */
export interface CabuAnswer {
  response?: string;
  /** Each entry is one datatable, pre-rendered as truncated markdown -- see `renderDatatable`. */
  datatables?: Array<string>;
  dataDetails?: string;
  /** Thread this into the next `cabu-ask` call's `parentLuid` to continue the conversation. */
  nextParentLuid?: string;
}

const MAX_DATATABLE_ROWS = 20;
const MAX_JSON_CHARS = 2000;

/**
 * Assembles a `response_complete` SSE event into the answer `cabu-ask` returns. The server has
 * already parsed WAII's response into ready-to-render fields (see `ResponseNode`/`ResponseFormatter`
 * in `.work/specs/W-24280234-cabu-tools.md`'s implementation notes) -- this only formats them for an
 * MCP client, it does not reinterpret WAII internals. `chatLuid` becomes `nextParentLuid`: the field
 * name changes because the caller only ever threads it forward as the NEXT question's `parentLuid`.
 */
export function buildCabuAnswer(event: CabuResponseCompleteEvent): CabuAnswer {
  return {
    response: event.response,
    datatables: event.datatables?.map(renderDatatable),
    dataDetails: event.dataDetails,
    nextParentLuid: event.chatLuid,
  };
}

/**
 * Renders one datatable as truncated markdown. CABU's `data` field is untyped (`z.unknown()` --
 * see `cabu.ts`): when it is an array of plain row objects, render a markdown table capped at
 * `MAX_DATATABLE_ROWS` rows; for any other shape, fall back to a truncated JSON code block rather
 * than guessing at a structure that was never confirmed from CES source.
 */
function renderDatatable(datatable: CabuDatatable): string {
  const title = `**${datatable.name || 'Table'}**`;
  const rows = asRowObjects(datatable.data);

  if (rows) {
    return `${title}\n\n${renderRowsAsMarkdownTable(rows)}`;
  }

  const json = JSON.stringify(datatable.data ?? null);
  const truncated =
    json.length > MAX_JSON_CHARS ? `${json.slice(0, MAX_JSON_CHARS)}…` : (json ?? 'null');
  return `${title}\n\n\`\`\`json\n${truncated}\n\`\`\``;
}

function asRowObjects(data: unknown): Array<Record<string, unknown>> | undefined {
  if (
    Array.isArray(data) &&
    data.length > 0 &&
    data.every((row) => typeof row === 'object' && row !== null && !Array.isArray(row))
  ) {
    return data as Array<Record<string, unknown>>;
  }
  return undefined;
}

function renderRowsAsMarkdownTable(rows: Array<Record<string, unknown>>): string {
  const columns = Object.keys(rows[0]);
  const header = `| ${columns.join(' | ')} |`;
  const divider = `| ${columns.map(() => '---').join(' | ')} |`;
  const truncatedRows = rows.slice(0, MAX_DATATABLE_ROWS);
  const body = truncatedRows
    .map((row) => `| ${columns.map((column) => formatCell(row[column])).join(' | ')} |`)
    .join('\n');
  const truncationNote =
    rows.length > MAX_DATATABLE_ROWS
      ? `\n_...truncated to ${MAX_DATATABLE_ROWS} of ${rows.length} rows_`
      : '';

  return `${header}\n${divider}\n${body}${truncationNote}`;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
