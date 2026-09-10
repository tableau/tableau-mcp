// Search result quality — the agent must never be offered a command it cannot invoke.
//
// Live incident (v11 bundle): after a chart came out wrong the user said "warmer should be
// with color". The agent called search-commands ~10 times and was handed
// publish-workbook-to-workgroup, export-as-version, save-as, cell-size,
// launch-worksheet-title-rich-text-editor, copy-worksheet-formatting and three COLOR dialogs
// whose parameters can never be filled headlessly. Every surplus call costs ~8.6s in production.
//
// Driven off a fixture External API registry rather than the old bundled 956KB snapshot
// (deleted; see commandsReference.ts) — the invariants under test (never offer an uninvocable
// command, never offer one the static policy layer refuses, always warn on a blocking-dialog
// command) do not depend on the reference's provenance.

import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

import { _resetExternalApiCommandRegistryForTest } from '../externalApi/paramWireRegistry.js';
import { _resetCommandsReferenceForTest } from '../guards/commandsReference.js';
import { searchCommandsByKeywords } from './searchLibrary.js';

const TEST_DIRS: string[] = [];

// One command per invariant this suite pins, plus a couple of ordinary invocable
// commands so a keyword search has more than one thing to rank.
const FIXTURE_REGISTRY: Record<string, unknown> = {
  'tabdoc:add-field': {
    agent_can_invoke: true,
    opens_blocking_dialog: false,
    modifies_state: 'true',
    in_params: [{ local: 'Target', type: 'DPI_EncodingTarget', required: true, wire: 'target' }],
  },
  'tabdoc:apply-worksheet': {
    agent_can_invoke: true,
    opens_blocking_dialog: false,
    modifies_state: 'true',
    in_params: [],
  },
  // agent_can_invoke: false — must never surface, at any query, including its own name.
  'tabdoc:hidden-from-agent': {
    agent_can_invoke: false,
    opens_blocking_dialog: false,
    modifies_state: 'false',
    in_params: [],
  },
  // Registry says invocable, but the static policy layer (commandPolicy.ts) refuses it as
  // crash-prone — must never surface even though agent_can_invoke is true here.
  'tabdoc:show-parameter-controls': {
    agent_can_invoke: true,
    opens_blocking_dialog: false,
    modifies_state: 'false',
    in_params: [],
  },
  // Registry says invocable, but the policy layer refuses it as an unvalidated navigation
  // target — same "policy overrides the registry" invariant, different reason.
  'tabdoc:goto-sheet': {
    agent_can_invoke: true,
    opens_blocking_dialog: false,
    modifies_state: 'false',
    in_params: [{ local: 'Sheet', type: 'DPI_SheetName', required: true, wire: 'sheet' }],
  },
  // Invocable and not policy-refused, but flagged as opening a blocking dialog — must carry
  // a warning naming execute-tableau-command rather than being silently offered.
  'tabdoc:open-calc-editor': {
    agent_can_invoke: true,
    opens_blocking_dialog: true,
    modifies_state: 'false',
    in_params: [{ local: 'EditorTarget', type: 'DPI_Worksheet', required: true, wire: 'target' }],
  },
  // Optional VizID is unprovidable — the color-dialog incident: Desktop still cannot run
  // this headlessly, so search must not offer it even though agent_can_invoke is true.
  'tabdoc:launch-quantitative-color-dialog': {
    agent_can_invoke: true,
    opens_blocking_dialog: false,
    modifies_state: 'false',
    in_params: [
      {
        local: 'VizID',
        type: 'DPI_VisualIDPM',
        required: false,
        wire: 'visual-id-pres-model',
        unprovidable: true,
      },
      {
        local: 'FieldNames',
        type: 'DPI_EncodingFieldVector',
        required: true,
        wire: 'encoding-field-vector',
      },
    ],
  },
  // Optional FieldVector is unprovidable, but the required params are fillable — keep it.
  'tabdoc:show-me': {
    agent_can_invoke: true,
    opens_blocking_dialog: false,
    modifies_state: 'true',
    in_params: [
      { local: 'WorksheetName', type: 'DPI_Worksheet', required: true, wire: 'worksheet' },
      {
        local: 'ShowMeType',
        type: 'DPI_ShowMeCommandType',
        required: true,
        wire: 'show-me-command-type',
      },
      {
        local: 'FieldsSelectedInSchemaViewer',
        type: 'DPI_FieldVector',
        required: false,
        wire: 'field-vector',
        unprovidable: true,
      },
    ],
  },
  // Workspace is unprovidable but context-filled by Desktop — keep it.
  'tabui:new-workbook': {
    agent_can_invoke: true,
    opens_blocking_dialog: false,
    modifies_state: 'true',
    in_params: [
      {
        local: 'Workspace',
        type: 'UPI_Workspace',
        required: true,
        wire: 'workspace',
        unprovidable: true,
        context_filled: true,
      },
    ],
  },
  // Required FieldVector is unprovidable — drop the whole command.
  'tabdoc:delete-calculation-fields-command': {
    agent_can_invoke: true,
    opens_blocking_dialog: false,
    modifies_state: 'true',
    in_params: [
      {
        local: 'FieldVector',
        type: 'DPI_FieldVector',
        required: true,
        wire: 'field-vector',
        unprovidable: true,
      },
    ],
  },
};

function enableExternalApiRegistry(commands: Record<string, unknown>): void {
  const dir = mkdtempSync(join(process.cwd(), 'search-commands-quality-test-'));
  TEST_DIRS.push(dir);
  writeFileSync(join(dir, 'command_param_registry.json'), JSON.stringify(commands), 'utf-8');
  writeFileSync(join(dir, 'codegen_registry.json'), JSON.stringify({}), 'utf-8');
  vi.stubEnv('TABLEAU_COMMANDS_REGISTRY_DIR', dir);
  _resetExternalApiCommandRegistryForTest();
  _resetCommandsReferenceForTest();
}

function names(result: {
  commands?: Array<{ fully_qualified_serialized_name?: string }>;
}): string[] {
  return (result.commands ?? []).map((cmd) => cmd.fully_qualified_serialized_name ?? '');
}

beforeAll(() => {
  // One fixture registry for the whole file: searchLibrary.ts memoises its search index
  // at module scope the first time any test calls searchCommandsByKeywords, so every test
  // below runs against this same fixture regardless of which describe block it lives in.
  enableExternalApiRegistry(FIXTURE_REGISTRY);
});

afterAll(() => {
  vi.unstubAllEnvs();
  _resetExternalApiCommandRegistryForTest();
  _resetCommandsReferenceForTest();
  for (const dir of TEST_DIRS.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('search-commands never offers an uninvocable command', () => {
  it('never returns a command flagged agent_can_invoke: false, even searching by its own name', () => {
    const hits = names(searchCommandsByKeywords(['hidden-from-agent']));
    expect(hits).not.toContain('tabdoc:hidden-from-agent');
  });

  it('drops every command the static policy layer refuses, even when the registry allows it', () => {
    const crashProne = names(searchCommandsByKeywords(['show-parameter-controls']));
    const unvalidatedTarget = names(searchCommandsByKeywords(['goto-sheet']));

    expect(crashProne).not.toContain('tabdoc:show-parameter-controls');
    expect(unvalidatedTarget).not.toContain('tabdoc:goto-sheet');
  });

  it('returns ordinary invocable commands for a matching keyword', () => {
    const hits = names(searchCommandsByKeywords(['add-field']));
    expect(hits).toContain('tabdoc:add-field');
  });

  it('drops a command whose optional VizID is unprovidable', () => {
    const hits = names(searchCommandsByKeywords(['launch-quantitative-color-dialog']));
    expect(hits).not.toContain('tabdoc:launch-quantitative-color-dialog');
  });

  it('still offers show-me when only an optional FieldVector is unprovidable', () => {
    const hits = names(searchCommandsByKeywords(['show-me']));
    expect(hits).toContain('tabdoc:show-me');
  });

  it('still offers a command whose only unprovidable param is context-filled', () => {
    const hits = names(searchCommandsByKeywords(['new-workbook']));
    expect(hits).toContain('tabui:new-workbook');
  });

  it('drops a command with a required unprovidable param', () => {
    const hits = names(searchCommandsByKeywords(['delete-calculation-fields-command']));
    expect(hits).not.toContain('tabdoc:delete-calculation-fields-command');
  });

  it('never reports a parameter it cannot fill on a returned command', () => {
    for (const query of [['field'], ['sheet'], ['editor'], []]) {
      const result = searchCommandsByKeywords(query) as {
        commands: Array<{
          fully_qualified_serialized_name: string;
          parameters: Array<{ direction?: string; cannot_provide_from_mcp?: boolean }>;
        }>;
      };
      for (const cmd of result.commands) {
        const bad = cmd.parameters.filter(
          (param) => param.direction === 'in' && param.cannot_provide_from_mcp,
        );
        expect(
          bad,
          `${cmd.fully_qualified_serialized_name} for query ${JSON.stringify(query)}`,
        ).toEqual([]);
      }
    }
  });
});

describe('search-commands routing recommendation', () => {
  it('returns the recommendation even when commands match', () => {
    const result = searchCommandsByKeywords(['field']) as {
      commands: unknown[];
      recommendation?: string;
    };
    expect(result.commands.length).toBeGreaterThan(0);
    expect(result.recommendation).toBeTypeOf('string');
  });

  it('names the bounded populated-sheet routes, including compatible rounded stacks', () => {
    const { recommendation } = searchCommandsByKeywords(['field']) as { recommendation?: string };
    expect(recommendation).toBeTypeOf('string');
    expect(recommendation).toContain('add-field');
    expect(recommendation).toContain('apply-worksheet');
    expect(recommendation).toContain('encoding');
    expect(recommendation).toContain('refine-worksheet');
    expect(recommendation).toContain('operation=round_stacked_bar');
    expect(recommendation).toMatch(/compatible stacked bar/i);
    expect(recommendation).not.toMatch(/refine-worksheet only for top-N or sort/);
  });

  it('does not recommend full-profile workbook XML editing', () => {
    const { recommendation } = searchCommandsByKeywords(['field']) as { recommendation?: string };

    expect(recommendation).not.toMatch(/edit workbook XML/i);
  });

  it('uses the same chart-route precedence as the desktop instructions', () => {
    const { recommendation } = searchCommandsByKeywords(['field']) as { recommendation?: string };

    expect(recommendation).toContain('preview/no-change');
    expect(recommendation).toContain('open multi-chart');
    expect(recommendation).toContain('skip bind-template');
    expect(recommendation).toContain('single-view visualization request');
    expect(recommendation).toContain('bind-template first');
    expect(recommendation).toContain('semantic ask may return one bounded proposal');
    expect(recommendation).toContain('existing-sheet tools only');
    expect(recommendation).toContain('unnamed derived metric');
    expect(recommendation).not.toMatch(/build-and-apply-worksheet|inject-template|apply-workbook/);
  });

  it('distinguishes named blank-sheet chart creation from populated-sheet edits', () => {
    const { recommendation } = searchCommandsByKeywords(['field']) as {
      recommendation?: string;
    };

    expect(recommendation).toContain('explicitly named existing blank worksheet');
    expect(recommendation).toContain('bind-template with target_worksheet');
    expect(recommendation).toMatch(/populated worksheet edits/i);
    expect(recommendation).toContain('add-field then apply-worksheet');
  });

  it('names the registered execute-tableau-command tool in blocking-surface warnings', () => {
    const { commands } = searchCommandsByKeywords(['editor']) as {
      commands: Array<{ warning?: string }>;
    };
    const warning = commands.find((command) => command.warning)?.warning;

    expect(warning).toContain('execute-tableau-command');
    expect(warning).not.toContain('execute_tableau_command');
  });
});
