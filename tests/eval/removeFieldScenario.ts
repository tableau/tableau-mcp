import { Agent, MCPServerStdio } from '@openai/agents';
import { z } from 'zod';

import { formatArtifactSummary } from '../../src/desktop/limits/artifactSummary.js';
import {
  listFields,
  removeFieldFromCols,
  removeFieldFromEncoding,
  removeFieldFromRows,
} from '../../src/desktop/metadata/fields.js';
import type { EncodingType } from '../../src/desktop/metadata/types.js';
import {
  FieldRemovalPlacement,
  removeFieldResult,
} from '../../src/tools/desktop/authoring/fields/removeFieldResult.js';
import { jsonToolResult } from '../../src/tools/desktop/structuredContent.js';
import invariant from '../../src/utils/invariant.js';
import { getAgent } from './base.js';

export const worksheetName = 'Sales by Category';
export const draftFile = '/eval/cache/draft.xml';
export const liveFile = '/eval/cache/live.xml';
export const sales = '[Sample].[sum:Sales:qk]';
export const profit = '[Sample].[sum:Profit:qk]';
export const category = '[Sample].[none:Category:nk]';

type Placements = {
  rows: string[];
  cols: string[];
  encodings: Partial<Record<EncodingType, string[]>>;
};

const removalSchema = z.object({
  target: z.enum(['rows', 'cols', 'encoding']),
  columnRef: z.string(),
  encodingType: z
    .enum(['color', 'size', 'lod', 'detail', 'text', 'tooltip', 'path', 'angle'])
    .optional(),
});
type Removal = z.infer<typeof removalSchema>;

export type RemoveFieldCase = {
  name: string;
  request: string;
  current: Placements;
  expected: Placements;
  removals: number;
  fresh?: boolean;
  live?: Placements;
  previousRemoval?: Removal;
};

const empty: Placements = { rows: [], cols: [], encodings: {} };
const rows: Placements = { ...empty, rows: [sales], cols: [category] };
const cols: Placements = { ...empty, rows: [category], cols: [sales] };
const color: Placements = { ...rows, encodings: { color: [sales] } };

export const removeFieldCases: RemoveFieldCase[] = [
  {
    name: 'preflight corrects a stale Columns assumption',
    request: `Remove Sales from its current axis shelf. My old notes put ${sales} on Columns.`,
    current: rows,
    expected: { ...rows, rows: [] },
    removals: 1,
    fresh: true,
  },
  {
    name: 'preflight corrects a stale Rows assumption',
    request: `Remove Sales from its current axis shelf. My old notes put ${sales} on Rows.`,
    current: cols,
    expected: { ...cols, cols: [] },
    removals: 1,
    fresh: true,
  },
  {
    name: 'wrong-shelf error recovers using the same draft',
    request: 'Continue removing Sales from its axis shelf in this draft after the failed attempt.',
    current: rows,
    expected: { ...rows, rows: [] },
    removals: 1,
    previousRemoval: { target: 'cols', columnRef: sales },
  },
  {
    name: 'already-removed field is not retried',
    request: 'Finish clearing Sales from Rows in this draft after the failed attempt.',
    current: { ...rows, rows: [] },
    expected: { ...rows, rows: [] },
    removals: 0,
    previousRemoval: { target: 'rows', columnRef: sales },
  },
  ...(['size', 'angle'] as const).map(
    (encodingType): RemoveFieldCase => ({
      name: `absent ${encodingType} encoding leaves other placements intact`,
      request: `Finish clearing Sales from ${encodingType} in this draft after the failed attempt. Keep its other placements.`,
      current: color,
      expected: color,
      removals: 0,
      previousRemoval: { target: 'encoding', encodingType, columnRef: sales },
    }),
  ),
  {
    name: 'pending Profit edit survives removal of Sales',
    request:
      'I added Profit to Rows in the draft and have not applied it. Remove Sales from Rows and keep my Profit edit.',
    current: { ...rows, rows: [sales, profit] },
    live: rows,
    expected: { ...rows, rows: [profit] },
    removals: 1,
  },
  {
    name: 'Detail removal uses lod and preserves Color and Rows',
    request: 'Remove Sales from Detail in this draft. Keep it on Rows and Color.',
    current: { ...color, encodings: { color: [sales], lod: [sales] } },
    expected: color,
    removals: 1,
  },
];

function worksheetXml(placements: Placements): string {
  const encodings = Object.entries(placements.encodings)
    .flatMap(([channel, columns]) => columns.map((column) => `<${channel} column="${column}"/>`))
    .join('');
  return `<worksheet name="${worksheetName}"><table>
    <rows>${placements.rows.join(' / ')}</rows><cols>${placements.cols.join(' / ')}</cols>
    <panes><pane><encodings>${encodings}</encodings></pane></panes>
    </table><simple-id uuid="{00000000-0000-0000-0000-000000000001}"/></worksheet>`;
}

function remove(xml: string, args: Removal): string {
  switch (args.target) {
    case 'rows':
      return removeFieldFromRows(xml, args.columnRef);
    case 'cols':
      return removeFieldFromCols(xml, args.columnRef);
    case 'encoding':
      invariant(args.encodingType, 'encodingType is required when target=encoding');
      return removeFieldFromEncoding(xml, args.encodingType, args.columnRef);
  }
}

function placements(xml: string): string[] {
  return listFields(xml)
    .map((field) => `${field.location}:${field.encodingType ?? ''}:${field.column}:${field.index}`)
    .sort();
}

/** In-memory tool environment. Paths are identifiers; no filesystem or Desktop calls occur. */
export class RemoveFieldScenario {
  readonly prompt: string;
  readonly calls: Array<{ name: string; args: Record<string, unknown>; output: string }> = [];
  private readonly files = new Map<string, string>();
  private readonly inspected = new Map<string, string>();
  private readonly inspectedShelves = new Map<string, string>();
  private readonly violations: string[] = [];
  private activeFile: string;

  constructor(readonly testCase: RemoveFieldCase) {
    this.activeFile = testCase.fresh ? liveFile : draftFile;
    this.files.set(this.activeFile, worksheetXml(testCase.current));
    this.prompt =
      `In session eval-session, worksheet "${worksheetName}": ${testCase.request} ` +
      'Prepare the draft only; do not apply it. ' +
      (testCase.fresh ? '' : `The current working draft is ${draftFile}. `);
    if (testCase.previousRemoval) {
      let previousError: string | undefined;
      try {
        remove(worksheetXml(testCase.current), testCase.previousRemoval);
      } catch (error) {
        previousError = error instanceof Error ? error.message : String(error);
      }
      invariant(previousError, 'The recovery fixture must begin with a failing removal');
      // Use the implementation's actual diagnostic, not a hand-written hint with the answer.
      this.prompt += `\nPrevious remove-field call: ${JSON.stringify({
        worksheetFile: draftFile,
        ...testCase.previousRemoval,
      })}\nTool error: ${previousError}`;
    }
  }

  invoke(name: string, args: Record<string, unknown>): { type: 'text'; text: string } {
    let text: string;
    try {
      text = this.execute(name, args);
    } catch (error) {
      text = error instanceof Error ? error.message : String(error);
      this.violations.push(`${name} failed: ${text}`);
    }
    // The SDK unwraps a single MCP content block, then serializes that object for the model.
    const output = { type: 'text' as const, text };
    this.calls.push({ name, args, output: JSON.stringify(output) });
    return output;
  }

  private execute(name: string, args: Record<string, unknown>): string {
    invariant(args.session == null || args.session === 'eval-session', 'Unknown fixture session');
    invariant(
      args.worksheetName == null || args.worksheetName === worksheetName,
      'Unknown fixture worksheet',
    );
    switch (name) {
      case 'get_worksheet_xml': {
        invariant(args.worksheetName === worksheetName, 'worksheetName is required');
        const mode = args.mode ?? 'file';
        invariant(mode === 'file' || mode === 'inline', 'mode must be file or inline');
        if (!this.testCase.fresh) this.violations.push('Live refresh resets the working draft');
        const xml = worksheetXml(this.testCase.live ?? this.testCase.current);
        this.files.set(liveFile, xml);
        this.activeFile = liveFile;
        if (mode === 'inline') {
          this.inspected.set(liveFile, xml);
          return JSON.stringify({ worksheetXml: xml });
        }
        this.inspected.delete(liveFile);
        // The real summary shows these short axis shelves in full, but only counts encodings.
        this.inspectedShelves.set(liveFile, xml);
        return JSON.stringify({
          file: liveFile,
          message: `Worksheet saved to ${liveFile}\n\nArtifact summary:\n${formatArtifactSummary('worksheet', xml)}`,
          instructions:
            'Use this file path with apply-worksheet instead of passing content directly.',
        });
      }
      case 'read_cached_xml': {
        invariant(typeof args.filePath === 'string', 'filePath is required');
        const xml = this.files.get(args.filePath);
        invariant(xml !== undefined, 'Unknown fixture file');
        invariant(args.dashboardName == null && args.dashboard == null, 'Not a dashboard');
        invariant(args.worksheet == null || args.worksheet === worksheetName, 'Unknown worksheet');
        const worksheetSelector = args.worksheetName ?? args.worksheet;
        const usesByteRange = args.startByte !== undefined || args.endByte !== undefined;
        invariant(
          worksheetSelector == null || !usesByteRange,
          'Multiple selectors provided. Pass either a worksheet selector or a byte range.',
        );
        const slice = Buffer.from(xml)
          .subarray(
            typeof args.startByte === 'number' ? args.startByte : 0,
            typeof args.endByte === 'number' ? args.endByte : undefined,
          )
          .toString();
        if (slice === xml) this.inspected.set(args.filePath, xml);
        const sliceLabel =
          worksheetSelector != null
            ? ` (worksheet "${worksheetSelector}")`
            : usesByteRange
              ? ` (bytes ${args.startByte ?? 0}-${args.endByte ?? 'end'})`
              : '';
        return `Read ${slice.length} bytes from ${args.filePath}${sliceLabel}\n\n${slice}`;
      }
      case 'remove_field': {
        invariant(
          args.worksheetFile != null || args.worksheetName != null,
          'A worksheet is required',
        );
        const file = args.worksheetFile ?? this.activeFile;
        invariant(typeof file === 'string', 'worksheetFile must be a string');
        const xml = this.files.get(file);
        invariant(xml !== undefined, 'Unknown fixture file');
        const removal = removalSchema.parse(args);
        const shelfInspected =
          removal.target !== 'encoding' && this.inspectedShelves.get(file) === xml;
        if (this.inspected.get(file) !== xml && !shelfInspected) {
          this.violations.push('Removal attempted without inspecting the current selected draft');
        }
        const modifiedXml = remove(xml, removal);
        this.files.set(file, modifiedXml);
        this.activeFile = file;
        const placement: FieldRemovalPlacement =
          removal.target === 'rows'
            ? 'Rows shelf'
            : removal.target === 'cols'
              ? 'Columns shelf'
              : `${removal.encodingType!} encoding`;
        const result = jsonToolResult(
          removeFieldResult(placement, file, removal.columnRef, modifiedXml),
        );
        invariant(result.content[0].type === 'text');
        return result.content[0].text;
      }
      default:
        throw new Error(`Unexpected fixture tool: ${name}`);
    }
  }

  grade(): string[] {
    const failures = [...this.violations];
    if (this.testCase.fresh && !this.calls.some((call) => call.name === 'get_worksheet_xml')) {
      failures.push('Fresh edits must inspect the live worksheet');
    }
    const removals = this.calls.filter((call) => call.name === 'remove_field').length;
    if (removals !== this.testCase.removals) {
      failures.push(`Expected ${this.testCase.removals} removal calls, received ${removals}`);
    }
    const actual = placements(this.files.get(this.activeFile)!);
    const expected = placements(worksheetXml(this.testCase.expected));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      failures.push(`Incorrect final placements: ${JSON.stringify({ expected, actual })}`);
    }
    return failures;
  }
}

const toolNames = ['get_worksheet_xml', 'read_cached_xml', 'remove_field'];

export async function getRemoveFieldEvalAgent(
  mcpServer: MCPServerStdio,
  model: string,
  scenario: RemoveFieldScenario,
): Promise<Agent> {
  const agent = await getAgent({
    mcpServer,
    model,
    systemPrompt:
      "Use the available tools to carry out the user's worksheet edit and report the result.",
    toolAllowList: toolNames,
    stubToolExecution: true,
  });
  invariant(agent.tools.length === toolNames.length, 'Required Desktop eval tools are missing');
  invariant(
    agent.mcpServers.length === 0,
    'Fixture evals must not register executable MCP servers',
  );
  for (const tool of agent.tools) {
    invariant(tool.type === 'function');
    tool.invoke = async (_context, input) => scenario.invoke(tool.name, JSON.parse(input));
  }
  agent.modelSettings = { ...agent.modelSettings, toolChoice: 'auto', parallelToolCalls: false };
  return agent;
}
