import { MCPServerStdio, RunContext, setTracingDisabled, withTrace } from '@openai/agents';

import { formatDashboardPromiseCheck } from '../../src/desktop/validation/promise-check.js';
import { acceptedNoReadbackApplyResult } from '../../src/tools/desktop/api/applyPreamble.js';
import { jsonToolResult } from '../../src/tools/desktop/structuredContent.js';
import invariant from '../../src/utils/invariant.js';
import {
  dashboardApplyCases,
  DashboardApplyScenario,
  dashboardFragment,
  dashboardName,
  draftFile,
  getDashboardApplyEvalAgent,
} from './dashboardApplyScenario.js';

const applyArgs = { session: 'eval-session', dashboardName, dashboardFile: draftFile };
const readbackArgs = { session: 'eval-session', dashboardName, mode: 'inline' };

async function complete(scenario: DashboardApplyScenario): Promise<void> {
  await scenario.invoke('apply_dashboard', applyArgs);
  await scenario.invoke('get_dashboard_xml', readbackArgs);
}

describe('dashboard apply eval fixture and grading (offline)', () => {
  it.each(dashboardApplyCases)('accepts the reference plan: $name', async (testCase) => {
    const scenario = new DashboardApplyScenario(testCase);
    if (testCase.malformed) {
      const rejected = await scenario.invoke('apply_dashboard', applyArgs);
      const error = JSON.parse(rejected.text);
      expect(error.issues).toHaveLength(2);
      expect(error.issues[0].message).toContain('unsupported type-v2="worksheet"');
      expect(scenario.writes).toEqual([]);
      const read = await scenario.invoke('read_cached_xml', { filePath: draftFile });
      const xml = read.text.slice(read.text.indexOf('<dashboard'));
      await scenario.invoke('write_cached_xml', {
        filePath: draftFile,
        xmlContent: xml.replaceAll(' type-v2="worksheet"', ''),
      });
    }
    await complete(scenario);
    expect(scenario.grade()).toEqual([]);
    if (!testCase.blank && !testCase.layoutOnly) {
      expect(scenario.executor.getWorkbookDocument).toHaveBeenCalledTimes(3);
      expect(scenario.writes[0].xml).not.toContain('<actions>');
    }
  });

  it('does not pass a model that only claims success', () => {
    expect(new DashboardApplyScenario(dashboardApplyCases[0]).grade()).toContain(
      'Expected exactly one successful document write',
    );
  });

  it('seeds recovery with the production diagnostic for both layouts', async () => {
    const scenario = new DashboardApplyScenario(dashboardApplyCases[5]);
    const prompt = await scenario.getPrompt();
    expect(prompt).toContain('Previous apply-dashboard call:');
    expect(prompt).toContain('Remove this attribute from the worksheet zone.');
    expect(scenario.rejections).toEqual(['validation-failed']);
    expect(scenario.writes).toEqual([]);
  });

  it('returns the production success content without leaking its internal structured carrier', async () => {
    const scenario = new DashboardApplyScenario(dashboardApplyCases[0]);
    const actual = await scenario.invoke('apply_dashboard', applyArgs);
    const expected = jsonToolResult(
      acceptedNoReadbackApplyResult({
        kind: 'dashboard',
        appliedName: dashboardName,
        resultWarnings: [],
        hostVerification: formatDashboardPromiseCheck([]),
      }),
    );
    expect(actual).toEqual(expected.content[0]);
    expect(JSON.parse(actual.text)).not.toHaveProperty('structuredContent');
  });

  it('requires readback after a successful apply', async () => {
    const scenario = new DashboardApplyScenario(dashboardApplyCases[0]);
    await scenario.invoke('apply_dashboard', applyArgs);
    expect(scenario.grade()).toContain('Successful apply was not read back');
  });

  it('accepts file-mode readback only after reading the returned cache', async () => {
    const scenario = new DashboardApplyScenario(dashboardApplyCases[0]);
    await scenario.invoke('apply_dashboard', applyArgs);
    const response = await scenario.invoke('get_dashboard_xml', { dashboardName, mode: 'file' });
    expect(scenario.grade()).toContain('Successful apply was not read back');
    await scenario.invoke('read_cached_xml', { filePath: JSON.parse(response.text).file });
    expect(scenario.grade()).toEqual([]);
  });

  it('rejects a repair that forgets the Phone zones', async () => {
    const scenario = new DashboardApplyScenario(dashboardApplyCases[5]);
    const read = await scenario.invoke('read_cached_xml', { filePath: draftFile });
    const xml = read.text
      .slice(read.text.indexOf('<dashboard'))
      .replace(' type-v2="worksheet"', '');
    await scenario.invoke('write_cached_xml', { filePath: draftFile, xmlContent: xml });
    await complete(scenario);
    expect(scenario.writes).toEqual([]);
    expect(scenario.rejections).toEqual(['validation-failed']);
    expect(scenario.grade()).toContain('Expected exactly one successful document write');
  });

  it('rejects discarding draft membership to get a successful empty apply', async () => {
    const scenario = new DashboardApplyScenario(dashboardApplyCases[0]);
    await scenario.invoke('write_cached_xml', {
      filePath: draftFile,
      xmlContent: dashboardFragment([]),
    });
    await complete(scenario);
    expect(scenario.grade()).toContain('Dashboard or Phone layout differs from the intended draft');
  });

  it('detects layout-only writes that leave views unregistered (the original regression)', async () => {
    const scenario = new DashboardApplyScenario(dashboardApplyCases[0]);
    await scenario.executor.applyDashboardDocument(
      'dashboard-eval-1',
      dashboardFragment(['Sales']),
      new AbortController().signal,
    );
    expect(scenario.grade()).toContain('Worksheet view registrations do not match membership');
  });

  it('detects duplicate actions when an existing action is resubmitted', async () => {
    const scenario = new DashboardApplyScenario(dashboardApplyCases[0]);
    await complete(scenario);
    const posted = scenario.writes[0].xml.replace(
      '</workbook>',
      '<actions><action name="Existing filter"/></actions></workbook>',
    );
    await scenario.executor.applyWorkbookDocument(posted, new AbortController().signal);
    expect(scenario.grade()).toContain('Unrelated actions changed');
  });

  it('reports the production blank-worksheet diagnostic without a write', async () => {
    const scenario = new DashboardApplyScenario(dashboardApplyCases[6]);
    const result = await scenario.invoke('apply_dashboard', applyArgs);
    expect(result.text).toContain('no visual representation');
    expect(result.text).toContain('No changes were sent to Tableau');
    expect(scenario.grade()).toEqual([]);
    await scenario.invoke('apply_dashboard', applyArgs);
    expect(scenario.grade()).toContain('Expected one blank-worksheet rejection');
  });
});

describe('dashboard apply eval isolation (offline)', () => {
  beforeAll(() => setTracingDisabled(true));
  afterAll(() => setTracingDisabled(false));
  beforeEach(() => vi.stubEnv('OPENAI_API_KEY', 'test-key'));
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('uses discovered schemas but routes all exposed tools to the in-memory scenario', async () => {
    const server = new MCPServerStdio({ command: 'unused' });
    const names = [
      'read-cached-xml',
      'write-cached-xml',
      'apply-dashboard',
      'get-dashboard-xml',
      'apply-workbook',
    ];
    const inputSchema = {
      type: 'object' as const,
      properties: {},
      required: [],
      additionalProperties: true,
    };
    vi.spyOn(server, 'listTools').mockResolvedValue(
      names.map((name) => ({ name, description: `Schema for ${name}`, inputSchema })),
    );
    vi.spyOn(server, 'callTool').mockRejectedValue(new Error('Must not execute live tools'));
    const scenario = new DashboardApplyScenario(dashboardApplyCases[0]);
    const agent = await getDashboardApplyEvalAgent(server, 'test-model', scenario);
    expect(agent.mcpServers).toEqual([]);
    expect(agent.tools.map((tool) => tool.name)).toEqual(
      names.slice(0, 4).map((name) => name.replaceAll('-', '_')),
    );
    const args = [
      { filePath: draftFile },
      { filePath: draftFile, xmlContent: dashboardFragment(['Sales']) },
      applyArgs,
      readbackArgs,
    ];
    for (const [index, tool] of agent.tools.entries()) {
      invariant(tool.type === 'function');
      expect(tool.description).toBe(`Schema for ${names[index]}`);
      expect(tool.parameters.properties).toEqual(inputSchema.properties);
      await withTrace('invoke dashboard fixture', () =>
        tool.invoke(new RunContext(), JSON.stringify(args[index])),
      );
    }
    expect(server.callTool).not.toHaveBeenCalled();
    expect(scenario.grade()).toEqual([]);
  });
});
