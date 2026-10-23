import {
  getAllMcpTools,
  MCPServerStdio,
  RunContext,
  setTracingDisabled,
  withTrace,
} from '@openai/agents';

import { removeFieldFromRows } from '../../src/desktop/metadata/fields.js';
import { removeFieldResult } from '../../src/tools/desktop/authoring/fields/removeFieldResult.js';
import { jsonToolResult } from '../../src/tools/desktop/structuredContent.js';
import invariant from '../../src/utils/invariant.js';
import {
  draftFile,
  getRemoveFieldEvalAgent,
  liveFile,
  removeFieldCases,
  RemoveFieldScenario,
  sales,
  worksheetName,
} from './removeFieldScenario.js';

function inspect(scenario: RemoveFieldScenario, file = draftFile): void {
  scenario.invoke('read_cached_xml', { filePath: file });
}

function remove(scenario: RemoveFieldScenario, args: Record<string, unknown> = {}): void {
  scenario.invoke('remove_field', { worksheetName, target: 'rows', columnRef: sales, ...args });
}

describe('remove-field eval grading (offline)', () => {
  it('returns the production success response instead of abbreviated fixture guidance', () => {
    const scenario = new RemoveFieldScenario(removeFieldCases[2]);
    const read = scenario.invoke('read_cached_xml', { filePath: draftFile });
    const modifiedXml = removeFieldFromRows(
      read.text.slice(read.text.indexOf('<worksheet')),
      sales,
    );
    remove(scenario);
    expect(JSON.parse(scenario.calls[1].output)).toEqual(
      jsonToolResult(removeFieldResult('Rows shelf', draftFile, sales, modifiedXml)).content[0],
    );
  });

  it.each(removeFieldCases)('accepts a correct sequence: $name', (testCase) => {
    const scenario = new RemoveFieldScenario(testCase);
    const file = testCase.fresh ? liveFile : draftFile;
    if (testCase.fresh) scenario.invoke('get_worksheet_xml', { worksheetName, mode: 'file' });
    inspect(scenario, file);
    if (testCase.removals) {
      const target = testCase.current.encodings.lod
        ? 'encoding'
        : testCase.current.cols.includes(sales)
          ? 'cols'
          : 'rows';
      remove(scenario, { worksheetFile: file, target, encodingType: 'detail' });
    }
    expect(scenario.grade()).toEqual([]);
  });

  it('accepts inline live inspection followed by a name-only removal', () => {
    const scenario = new RemoveFieldScenario(removeFieldCases[0]);
    scenario.invoke('get_worksheet_xml', { worksheetName, mode: 'inline' });
    remove(scenario);
    expect(scenario.grade()).toEqual([]);
  });

  it('does not require another call when the prior diagnostic already proves absence', () => {
    const scenario = new RemoveFieldScenario(removeFieldCases[3]);
    expect(scenario.prompt).toContain('Do not retry removal if the field is absent.');
    expect(scenario.grade()).toEqual([]);
  });

  it('rejects blind removal even when it picks the correct shelf', () => {
    const scenario = new RemoveFieldScenario(removeFieldCases[0]);
    remove(scenario);
    expect(scenario.grade()).toContain(
      'Removal attempted without inspecting the current selected draft',
    );
  });

  it('accepts the default file-mode summary as inspection of a short axis shelf', () => {
    const scenario = new RemoveFieldScenario(removeFieldCases[0]);
    scenario.invoke('get_worksheet_xml', { worksheetName });
    remove(scenario, { worksheetFile: liveFile });
    expect(scenario.grade()).toEqual([]);
  });

  it('does not treat encoding counts or an incomplete byte slice as encoding inspection', () => {
    const scenario = new RemoveFieldScenario({ ...removeFieldCases[7], fresh: true });
    scenario.invoke('get_worksheet_xml', { worksheetName, mode: 'file' });
    scenario.invoke('read_cached_xml', { filePath: liveFile, endByte: 10 });
    remove(scenario, { target: 'encoding', encodingType: 'lod' });
    expect(scenario.grade()).toContain(
      'Removal attempted without inspecting the current selected draft',
    );
  });

  it.each(['worksheetName', 'worksheet'])(
    'rejects a read combining %s with a byte range, as the real tool does',
    (selector) => {
      const scenario = new RemoveFieldScenario(removeFieldCases[7]);
      scenario.invoke('read_cached_xml', {
        filePath: draftFile,
        [selector]: worksheetName,
        startByte: 0,
      });
      remove(scenario, { target: 'encoding', encodingType: 'detail' });
      expect(scenario.grade()).toContain(
        'read_cached_xml failed: Multiple selectors provided. Pass either a worksheet selector or a byte range.',
      );
      expect(scenario.grade()).toContain(
        'Removal attempted without inspecting the current selected draft',
      );
    },
  );

  it.each(['worksheetName', 'worksheet'])(
    'accepts and labels a read using the %s selector',
    (selector) => {
      const scenario = new RemoveFieldScenario(removeFieldCases[7]);
      const result = scenario.invoke('read_cached_xml', {
        filePath: draftFile,
        [selector]: worksheetName,
      });
      expect(result.text).toContain(`${draftFile} (worksheet "${worksheetName}")\n\n`);
      remove(scenario, { target: 'encoding', encodingType: 'detail' });
      expect(scenario.grade()).toEqual([]);
    },
  );

  it('rejects a guessed cache path as evidence of current live state', () => {
    const scenario = new RemoveFieldScenario(removeFieldCases[0]);
    inspect(scenario, liveFile);
    remove(scenario);
    expect(scenario.grade()).toContain('Fresh edits must inspect the live worksheet');
  });

  it('rejects a wrong shelf followed by a successful retry', () => {
    const scenario = new RemoveFieldScenario(removeFieldCases[2]);
    inspect(scenario);
    remove(scenario, { target: 'cols' });
    remove(scenario);
    expect(scenario.grade()).toContain('Expected 1 removal calls, received 2');
    expect(scenario.calls[1].output).toContain('Current placements in the selected worksheet');
  });

  it.each(removeFieldCases.filter((testCase) => testCase.removals === 0))(
    'rejects redundant removal after absence is established: $name',
    (testCase) => {
      const scenario = new RemoveFieldScenario(testCase);
      inspect(scenario);
      remove(scenario, testCase.previousRemoval);
      expect(scenario.grade()).toContain('Expected 0 removal calls, received 1');
    },
  );

  it('rejects a live refresh that loses the pending Profit edit', () => {
    const scenario = new RemoveFieldScenario(removeFieldCases[6]);
    scenario.invoke('get_worksheet_xml', { worksheetName, mode: 'inline' });
    remove(scenario);
    expect(scenario.grade()).toContain('Live refresh resets the working draft');
    expect(
      scenario.grade().some((failure) => failure.startsWith('Incorrect final placements')),
    ).toBe(true);
  });

  it('rejects removing Color when only Detail was requested', () => {
    const scenario = new RemoveFieldScenario(removeFieldCases[7]);
    inspect(scenario);
    remove(scenario, { target: 'encoding', encodingType: 'color' });
    expect(
      scenario.grade().some((failure) => failure.startsWith('Incorrect final placements')),
    ).toBe(true);
  });

  it('rejects removing the same encoding again using the Detail alias', () => {
    const scenario = new RemoveFieldScenario(removeFieldCases[7]);
    inspect(scenario);
    remove(scenario, { target: 'encoding', encodingType: 'lod' });
    remove(scenario, { target: 'encoding', encodingType: 'detail' });
    expect(scenario.grade()).toContain('Expected 1 removal calls, received 2');
    expect(
      scenario
        .grade()
        .some((failure) => failure.startsWith('remove_field failed: No lod encodings found')),
    ).toBe(true);
  });

  it('rejects doing nothing when a placement still needs removal', () => {
    const scenario = new RemoveFieldScenario(removeFieldCases[0]);
    expect(scenario.grade()).toContain('Expected 1 removal calls, received 0');
  });
});

describe('remove-field eval isolation (offline)', () => {
  beforeAll(() => setTracingDisabled(true));
  afterAll(() => setTracingDisabled(false));
  beforeEach(() => vi.stubEnv('OPENAI_API_KEY', 'test-key'));
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('returns the same single-content output as the SDK MCP adapter', async () => {
    const server = new MCPServerStdio({ command: 'unused' });
    vi.spyOn(server, 'listTools').mockResolvedValue([
      {
        name: 'remove-field',
        description: 'Remove a field',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
          additionalProperties: true,
        },
      },
    ]);
    const scenario = new RemoveFieldScenario(removeFieldCases[2]);
    const read = scenario.invoke('read_cached_xml', { filePath: draftFile });
    const modifiedXml = removeFieldFromRows(
      read.text.slice(read.text.indexOf('<worksheet')),
      sales,
    );
    const result = jsonToolResult(removeFieldResult('Rows shelf', draftFile, sales, modifiedXml));
    invariant(result.content[0].type === 'text');
    vi.spyOn(server, 'callTool').mockResolvedValue([result.content[0]]);
    const [tool] = await withTrace('discover SDK adapter', () => getAllMcpTools([server]));
    invariant(tool.type === 'function');
    const args = { worksheetFile: draftFile, target: 'rows', columnRef: sales };
    const actual = await withTrace('invoke SDK adapter', () =>
      tool.invoke(new RunContext(), JSON.stringify(args)),
    );
    expect(scenario.invoke('remove_field', args)).toEqual(actual);
    expect(scenario.calls[1].output).toBe(JSON.stringify(actual));
    expect(scenario.grade()).toEqual([]);
  });

  it('uses discovered schemas while every tool executes only against the fixture', async () => {
    const server = new MCPServerStdio({ command: 'unused' });
    const inputSchema = {
      type: 'object' as const,
      properties: {},
      required: [],
      additionalProperties: true,
    };
    const names = ['get-worksheet-xml', 'read-cached-xml', 'remove-field', 'apply-worksheet'];
    vi.spyOn(server, 'listTools').mockResolvedValue(
      names.map((name) => ({ name, description: `Actual schema for ${name}`, inputSchema })),
    );
    vi.spyOn(server, 'callTool').mockRejectedValue(new Error('Must not execute live tools'));
    const scenario = new RemoveFieldScenario(removeFieldCases[0]);
    const agent = await getRemoveFieldEvalAgent(server, 'test-model', scenario);
    expect(agent.mcpServers).toEqual([]);
    expect(agent.tools.map((tool) => tool.name)).toEqual([
      'get_worksheet_xml',
      'read_cached_xml',
      'remove_field',
    ]);
    const args = [
      { worksheetName, mode: 'file' },
      { filePath: liveFile },
      { worksheetFile: liveFile, target: 'rows', columnRef: sales },
    ];
    for (const [index, tool] of agent.tools.entries()) {
      invariant(tool.type === 'function');
      expect(tool.description).toBe(`Actual schema for ${names[index]}`);
      expect(tool.parameters.properties).toEqual(inputSchema.properties);
      await withTrace('invoke fixture', () =>
        tool.invoke(new RunContext(), JSON.stringify(args[index])),
      );
    }
    expect(scenario.grade()).toEqual([]);
    expect(server.callTool).not.toHaveBeenCalled();
  });
});
