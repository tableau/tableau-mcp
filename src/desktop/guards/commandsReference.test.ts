import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

import { _resetExternalApiCommandRegistryForTest } from '../externalApi/paramWireRegistry.js';
import {
  _resetCommandsReferenceForTest,
  loadCommandsReference,
  loadCommandsReferenceDocument,
} from './commandsReference.js';

const TEST_DIRS: string[] = [];

function enableExternalApiRegistry(commands: Record<string, unknown>): void {
  const dir = mkdtempSync(join(process.cwd(), 'commands-reference-test-'));
  TEST_DIRS.push(dir);
  writeFileSync(join(dir, 'command_param_registry.json'), JSON.stringify(commands), 'utf-8');
  writeFileSync(join(dir, 'codegen_registry.json'), JSON.stringify({}), 'utf-8');
  vi.stubEnv('TABLEAU_COMMANDS_REGISTRY_DIR', dir);
  _resetExternalApiCommandRegistryForTest();
  _resetCommandsReferenceForTest();
}

describe('commandsReference (synthesized from the External API registry)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    _resetExternalApiCommandRegistryForTest();
    _resetCommandsReferenceForTest();
    for (const dir of TEST_DIRS.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null when no External API registry is loaded', () => {
    expect(loadCommandsReferenceDocument()).toBeNull();
    expect(loadCommandsReference()).toBeNull();
  });

  it('projects one reference entry per registry command, memoised across calls', () => {
    enableExternalApiRegistry({
      'tabdoc:sort': {
        agent_can_invoke: false,
        opens_blocking_dialog: true,
        modifies_state: 'true',
        in_params: [
          { local: 'FieldName', type: 'DPI_GlobalFieldName', required: true, wire: 'field-name' },
          { local: 'ClearSort', type: 'DPI_ClearSort', required: false, wire: 'clear-sort' },
        ],
      },
      'tabdoc:sort-nested': {
        agent_can_invoke: true,
        opens_blocking_dialog: false,
        modifies_state: 'true',
        in_params: [],
      },
    });

    const document = loadCommandsReferenceDocument();
    expect(document).not.toBeNull();
    // Memoised: repeated calls return the identical parsed object until reset.
    expect(loadCommandsReferenceDocument()).toBe(document);

    const entries = loadCommandsReference();
    expect(entries).toHaveLength(2);

    const sort = entries?.find((entry) => entry.fully_qualified_serialized_name === 'tabdoc:sort');
    expect(sort).toMatchObject({
      command_name: 'sort',
      agent_can_invoke: false,
      opens_blocking_dialog: true,
      modifies_workbook_state: true,
    });
    expect(sort?.parameters).toEqual([
      {
        direction: 'in',
        local_name: 'FieldName',
        type_id: 'DPI_GlobalFieldName',
        required: true,
        cannot_provide_from_mcp: false,
        context_filled: false,
        comment: null,
      },
      {
        direction: 'in',
        local_name: 'ClearSort',
        type_id: 'DPI_ClearSort',
        required: false,
        cannot_provide_from_mcp: false,
        context_filled: false,
        comment: null,
      },
    ]);

    const sortNested = entries?.find(
      (entry) => entry.fully_qualified_serialized_name === 'tabdoc:sort-nested',
    );
    expect(sortNested).toMatchObject({
      command_name: 'sort-nested',
      agent_can_invoke: true,
      opens_blocking_dialog: false,
      modifies_workbook_state: true,
    });
    expect(sortNested?.parameters).toEqual([]);
  });

  it('splits only the namespace off command_name, keeping multi-colon command tails intact', () => {
    enableExternalApiRegistry({
      'tabui:workgroup:change-site': {
        agent_can_invoke: false,
        opens_blocking_dialog: false,
        modifies_state: 'false',
        in_params: [],
      },
    });

    const [entry] = loadCommandsReference() ?? [];

    expect(entry.command_name).toBe('workgroup:change-site');
  });

  it('projects description and per-param comments from the live registry', () => {
    enableExternalApiRegistry({
      'tabdoc:build-sheet-list-context-menu': {
        agent_can_invoke: true,
        opens_blocking_dialog: false,
        modifies_state: 'false',
        description: 'Build the context menu for the sheet list.',
        in_params: [
          {
            local: 'SheetName',
            type: 'DPI_SheetName',
            required: true,
            wire: 'sheet-name',
            comment: 'The name of the sheet.',
          },
        ],
      },
    });

    const [entry] = loadCommandsReference() ?? [];
    expect(entry.description).toBe('Build the context menu for the sheet list.');
    expect(entry.parameters).toEqual([
      {
        direction: 'in',
        local_name: 'SheetName',
        type_id: 'DPI_SheetName',
        required: true,
        cannot_provide_from_mcp: false,
        context_filled: false,
        comment: 'The name of the sheet.',
      },
    ]);
  });

  it('projects unprovidable and context_filled flags onto each param', () => {
    enableExternalApiRegistry({
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
            local: 'Workspace',
            type: 'UPI_Workspace',
            required: true,
            wire: 'workspace',
            unprovidable: true,
            context_filled: true,
          },
        ],
      },
    });

    const [entry] = loadCommandsReference() ?? [];
    expect(entry.parameters).toEqual([
      {
        direction: 'in',
        local_name: 'VizID',
        type_id: 'DPI_VisualIDPM',
        required: false,
        cannot_provide_from_mcp: true,
        context_filled: false,
        comment: null,
      },
      {
        direction: 'in',
        local_name: 'Workspace',
        type_id: 'UPI_Workspace',
        required: true,
        cannot_provide_from_mcp: true,
        context_filled: true,
        comment: null,
      },
    ]);
  });
});
