import { Agent, MCPServerStdio } from '@openai/agents';
import { DOMParser, Element, Node, XMLSerializer } from '@xmldom/xmldom';
import { Ok } from 'ts-results-es';

import { makeExecutorMock } from '../../src/desktop/externalApi/executor.mock.js';
import type { ExecuteCommandResult } from '../../src/desktop/externalApi/executorTypes.js';
import { formatArtifactSummary } from '../../src/desktop/limits/artifactSummary.js';
import { formatDashboardPromiseCheck } from '../../src/desktop/validation/promise-check.js';
import { sourceSha256 } from '../../src/desktop/wrappers/cacheFingerprint.js';
import { loadDashboardXml } from '../../src/desktop/wrappers/loadDashboardXml.js';
import {
  DashboardXmlLoadFailedError,
  DesktopCommandExecutionError,
} from '../../src/errors/mcpToolError.js';
import { acceptedNoReadbackApplyResult } from '../../src/tools/desktop/api/applyPreamble.js';
import { jsonToolResult } from '../../src/tools/desktop/structuredContent.js';
import invariant from '../../src/utils/invariant.js';
import { getAgent } from './base.js';

export const dashboardName = 'Sales Overview';
export const draftFile = '/eval/cache/dashboard-draft.xml';
const liveFile = '/eval/cache/dashboard-live.xml';
const dashboardId = 'dashboard-eval-1';

type DashboardApplyCase = {
  name: string;
  before: string[];
  after: string[];
  registered?: string[];
  malformed?: boolean;
  malformedBaseline?: boolean;
  blank?: boolean;
  layoutOnly?: boolean;
  registrationRequired?: boolean;
  concurrentEdit?: boolean;
};

export const dashboardApplyCases: DashboardApplyCase[] = [
  {
    name: 'add a registered worksheet to an empty dashboard',
    before: [],
    registered: ['Sales'],
    after: ['Sales'],
  },
  {
    name: 'refuse populated zones with missing view registrations without replacing the workbook',
    before: ['Sales'],
    registered: [],
    after: ['Sales'],
    registrationRequired: true,
  },
  {
    name: 'replace membership while preserving the retained view settings',
    before: ['Sales', 'Profit'],
    registered: ['Sales', 'Profit', 'Quantity'],
    after: ['Profit', 'Quantity'],
  },
  { name: 'remove the final worksheet from both layouts', before: ['Sales'], after: [] },
  {
    name: 'ordinary layout edit stays on the dashboard route',
    before: ['Sales'],
    after: ['Sales'],
    layoutOnly: true,
  },
  {
    name: 'recover unsupported worksheet types in desktop and Phone zones',
    before: [],
    after: ['Sales'],
    malformed: true,
    registered: ['Sales'],
  },
  {
    name: 'blank worksheet rejection does not send a write',
    before: [],
    after: ['Empty'],
    blank: true,
  },
  {
    name: 'repair unsupported worksheet types already present in the live dashboard',
    before: ['Sales'],
    after: ['Sales'],
    malformed: true,
    malformedBaseline: true,
  },
  {
    name: 'refuse first apply requiring new view registrations without replacing the workbook',
    before: [],
    after: ['Sales'],
    registrationRequired: true,
  },
  {
    name: 'preserve a same-instance Desktop edit made immediately before the dashboard POST',
    before: ['Sales'],
    after: ['Sales'],
    layoutOnly: true,
    concurrentEdit: true,
  },
];

function concurrentDesktopEdit(xml: string): string {
  return xml.replace(
    '<datasource name="Sample"',
    '<datasource caption="Edited in Desktop" name="Sample"',
  );
}

export function dashboardFragment(names: string[], height = 800): string {
  const zones = names
    .map(
      (name, i) =>
        `<zone id="${i + 1}" name="${name}" x="0" y="${i * 40000}" w="100000" h="40000"/>`,
    )
    .join('');
  return `<dashboard name="${dashboardName}"><style/><size maxheight="${height}" maxwidth="1000" minheight="${height}" minwidth="1000"/>
    <zones><zone id="20" type-v2="layout-basic" x="0" y="0" w="100000" h="100000">${zones}</zone></zones>
    <devicelayouts><devicelayout name="Phone"><size maxheight="700" minheight="700" sizing-mode="vscroll"/>
    <zones><zone id="21" type-v2="layout-flow" param="vert" x="0" y="0" w="100000" h="100000">${zones}</zone></zones></devicelayout></devicelayouts>
    <simple-id uuid="${dashboardId}"/></dashboard>`;
}

function parse(xml: string): Element {
  const doc = new DOMParser({
    onError: (_level, message) => {
      throw new Error(message);
    },
  }).parseFromString(xml, 'text/xml');
  invariant(doc.documentElement, 'Missing XML root');
  return doc.documentElement;
}

function named(root: Element, tag: string, name: string): Element {
  const element = Array.from(root.getElementsByTagName(tag)).find(
    (node) => node.getAttribute('name') === name,
  );
  invariant(element, `Missing ${tag}: ${name}`);
  return element;
}

function serialize(node: Node): string {
  return new XMLSerializer().serializeToString(node);
}

// Independent structural comparison: ignore indentation and attribute order, preserve content/order.
function structure(node: Node): unknown {
  if (node.nodeType !== 1) return node.nodeValue?.trim() || null;
  const element = node as Element;
  return [
    element.tagName,
    Array.from(element.attributes)
      .map((attr) => [attr.name, attr.value])
      .sort(),
    Array.from(element.childNodes)
      .map(structure)
      .filter((child) => child !== null),
  ];
}

function sameXml(left: Element, right: Element): boolean {
  return JSON.stringify(structure(left)) === JSON.stringify(structure(right));
}

function workbook(testCase: DashboardApplyCase): string {
  const dashboard = testCase.malformedBaseline
    ? dashboardFragment(testCase.before).replace(
        / name="Sales"/g,
        ' name="Sales" type-v2="worksheet"',
      )
    : dashboardFragment(testCase.before);
  const worksheets = ['Sales', 'Profit', 'Quantity', 'Empty']
    .map(
      (name) =>
        `<worksheet name="${name}"><table><rows>${name === 'Empty' ? '' : `[Sample].[sum:${name}:qk]`}</rows><cols/></table></worksheet>`,
    )
    .join('');
  const views = (testCase.registered ?? testCase.before)
    .map((name) => `<viewpoint name="${name}"><zoom type="entire-view"/></viewpoint>`)
    .join('');
  return `<workbook><datasources><datasource name="Sample"/></datasources><worksheets>${worksheets}</worksheets>
    <dashboards>${dashboard}<dashboard name="Unrelated"><style/><zones/></dashboard></dashboards>
    <windows><window class="dashboard" name="${dashboardName}"><viewpoints>${views}</viewpoints><active id="20"/></window>
    <window class="dashboard" name="Unrelated"><viewpoints/></window></windows>
    <actions><action name="Existing filter"/></actions></workbook>`;
}

/** Real apply/validation code over an in-memory External API and cache. No file or Desktop I/O. */
export class DashboardApplyScenario {
  readonly prompt: string;
  readonly calls: Array<{ name: string; args: Record<string, unknown>; output: string }> = [];
  readonly writes: Array<{ route: 'workbook' | 'dashboard'; xml: string }> = [];
  readonly rejections: string[] = [];
  private readonly files = new Map<string, string>();
  private readonly violations: string[] = [];
  private readonly original: string;
  private readonly sourceHash: string;
  private live: string;
  private readback?: string;
  private successes = 0;
  readonly executor: ReturnType<typeof makeExecutorMock>;

  constructor(readonly testCase: DashboardApplyCase) {
    this.original = workbook(testCase);
    this.live = this.original;
    this.sourceHash = sourceSha256(this.dashboardXml());
    const draft = dashboardFragment(testCase.after, testCase.layoutOnly ? 850 : 800);
    this.files.set(
      draftFile,
      testCase.malformed
        ? draft.replace(/ name="Sales"/g, ' name="Sales" type-v2="worksheet"')
        : draft,
    );
    this.prompt =
      `In session eval-session, apply the prepared draft ${draftFile} to the existing dashboard "${dashboardName}". ` +
      "Keep the draft's worksheet choices, layout, and Phone layout, and preserve the rest of the workbook. " +
      'If apply reports a layout validation error, correct it and retry. Read back the dashboard after a successful apply. ' +
      'If the current Desktop API cannot register the requested worksheet views safely, stop and explain the blocker without replacing the workbook. ' +
      'If a referenced worksheet has no visual representation, stop and explain the blocker; do not populate it or change the selected worksheets.';
    const completed = (): Ok<ExecuteCommandResult<undefined>> =>
      Ok({ command_id: 'eval-apply', status: 'completed' as const, submitted_at: '' });
    this.executor = makeExecutorMock({
      listDashboards: vi
        .fn()
        .mockImplementation(async () =>
          Ok({ dashboards: [{ id: dashboardId, name: dashboardName }] }),
        ),
      getDashboardDocument: vi
        .fn()
        .mockImplementation(async () => Ok({ xml: this.dashboardXml() })),
      getWorkbookDocument: vi.fn().mockImplementation(async () => Ok({ xml: this.live })),
      applyWorkbookDocument: vi.fn().mockImplementation(async (xml: string) => {
        if (testCase.concurrentEdit) this.live = concurrentDesktopEdit(this.live);
        this.writes.push({ route: 'workbook', xml });
        const posted = parse(xml);
        invariant(posted.ownerDocument, 'Missing workbook document');
        // Native workbook POST appends actions. Model that behavior so resubmitting actions
        // duplicates them and fails the preservation grade instead of silently hiding the bug.
        const retained = parse(this.live).getElementsByTagName('actions')[0];
        const actions = posted.getElementsByTagName('actions')[0];
        if (actions) {
          for (const action of Array.from(retained.childNodes))
            actions.appendChild(posted.ownerDocument.importNode(action, true));
        } else {
          posted.appendChild(posted.ownerDocument.importNode(retained, true));
        }
        this.live = serialize(posted);
        return completed();
      }),
      applyDashboardDocument: vi.fn().mockImplementation(async (_id: string, xml: string) => {
        if (testCase.concurrentEdit) this.live = concurrentDesktopEdit(this.live);
        this.writes.push({ route: 'dashboard', xml });
        const root = parse(this.live);
        invariant(root.ownerDocument, 'Missing workbook document');
        const target = named(root, 'dashboard', dashboardName);
        target.parentNode!.replaceChild(root.ownerDocument.importNode(parse(xml), true), target);
        // Per-dashboard POST changes only the layout, leaving window registrations untouched.
        this.live = serialize(root);
        return completed();
      }),
    });
  }

  private dashboardXml(): string {
    return serialize(named(parse(this.live), 'dashboard', dashboardName));
  }

  async getPrompt(): Promise<string> {
    if (!this.testCase.malformed) return this.prompt;
    // Seed recovery with the production rejection, not hand-written instructions with the answer.
    const args = { session: 'eval-session', dashboardName, dashboardFile: draftFile };
    const rejected = await this.invoke('apply_dashboard', args);
    invariant(
      this.rejections[0] === 'validation-failed',
      'Recovery must start with a validation failure',
    );
    invariant(this.writes.length === 0, 'Malformed zones must not reach Desktop');
    return `${this.prompt}\nPrevious apply-dashboard call: ${JSON.stringify(args)}\nTool error: ${rejected.text}`;
  }

  async invoke(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ type: 'text'; text: string }> {
    let text: string;
    try {
      text = await this.execute(name, args);
    } catch (error) {
      text = error instanceof Error ? error.message : String(error);
      this.violations.push(`${name}: ${text}`);
    }
    const output = { type: 'text' as const, text };
    this.calls.push({ name, args, output: JSON.stringify(output) });
    return output;
  }

  private async execute(name: string, args: Record<string, unknown>): Promise<string> {
    invariant(args.session == null || args.session === 'eval-session', 'Unknown fixture session');
    invariant(
      args.dashboardName == null || args.dashboardName === dashboardName,
      'Unknown dashboard',
    );
    invariant(
      args.dashboard == null || args.dashboard === dashboardName,
      'Unknown dashboard alias',
    );
    invariant(
      args.worksheetName == null && args.worksheet == null,
      'Worksheet selector is invalid here',
    );
    switch (name) {
      case 'read_cached_xml': {
        invariant(typeof args.filePath === 'string', 'filePath is required');
        const xml = this.files.get(args.filePath);
        invariant(xml !== undefined, 'Unknown fixture file');
        const range = args.startByte != null || args.endByte != null;
        invariant(
          !range || (args.dashboardName == null && args.dashboard == null),
          'Conflicting read selectors',
        );
        const slice = Buffer.from(xml)
          .subarray(
            typeof args.startByte === 'number' ? args.startByte : 0,
            typeof args.endByte === 'number' ? args.endByte : undefined,
          )
          .toString();
        if (args.filePath === liveFile && slice === xml && this.successes > 0) this.readback = xml;
        return `Read ${Buffer.byteLength(slice)} bytes from ${args.filePath}\n\n${slice}`;
      }
      case 'write_cached_xml': {
        invariant(args.filePath === draftFile, 'Edit the supplied draft');
        invariant(typeof args.xmlContent === 'string', 'xmlContent is required');
        const root = parse(args.xmlContent);
        invariant(
          root.tagName === 'dashboard' && root.getAttribute('name') === dashboardName,
          'Expected the target dashboard fragment',
        );
        this.files.set(draftFile, args.xmlContent);
        return `Wrote ${Buffer.byteLength(args.xmlContent)} bytes to ${draftFile}\n\nFile is ready to use with apply-* tools.`;
      }
      case 'get_dashboard_xml': {
        invariant(args.dashboardName === dashboardName, 'dashboardName is required');
        invariant(
          args.mode == null || args.mode === 'file' || args.mode === 'inline',
          'Invalid mode',
        );
        const xml = this.dashboardXml();
        if (args.mode === 'inline') {
          if (this.successes > 0) this.readback = xml;
          return JSON.stringify({ dashboardXml: xml });
        }
        this.files.set(liveFile, xml);
        return JSON.stringify({
          file: liveFile,
          message: `Dashboard saved to cache\n\nArtifact summary:\n${formatArtifactSummary('dashboard', xml)}`,
          instructions:
            'Use this file path with apply-dashboard instead of passing content directly.',
        });
      }
      case 'apply_dashboard':
      case 'apply_dashboard_with_viewpoints': {
        invariant(args.dashboardName === dashboardName, 'dashboardName is required');
        invariant(
          args.dashboardFile === draftFile,
          'Apply the supplied draft, not a refreshed live layout',
        );
        const helper = name === 'apply_dashboard_with_viewpoints';
        if (helper)
          invariant(
            Array.isArray(args.worksheetNames) &&
              args.worksheetNames.every((value) => typeof value === 'string'),
            'worksheetNames is required',
          );
        const result = await loadDashboardXml({
          dashboardName,
          xml: this.files.get(draftFile)!,
          expectedSourceHash: helper ? undefined : this.sourceHash,
          requireExistingSheet: true,
          verifyReadback: helper,
          worksheetNames: helper ? (args.worksheetNames as string[]) : undefined,
          focus: { navigate: 'none', reason: 'intermediate-leg' },
          executor: this.executor,
          signal: new AbortController().signal,
        });
        if (result.isErr()) {
          const error = result.error;
          this.rejections.push(error.error.type);
          return error.type === 'load-dashboard-xml-error'
            ? new DashboardXmlLoadFailedError(error.error).message
            : new DesktopCommandExecutionError(error.error).message;
        }
        this.successes++;
        const warnings = result.value.validationWarnings;
        const response = jsonToolResult(
          acceptedNoReadbackApplyResult({
            kind: 'dashboard',
            appliedName: result.value.appliedName,
            resultWarnings: warnings,
            hostVerification: formatDashboardPromiseCheck(warnings),
          }),
        );
        invariant(response.content[0].type === 'text');
        return response.content[0].text;
      }
      default:
        throw new Error(`Unexpected fixture tool: ${name}`);
    }
  }

  grade(): string[] {
    const failures = [...this.violations];
    if (this.testCase.blank) {
      if (JSON.stringify(this.rejections) !== JSON.stringify(['sheet-not-rendered']))
        failures.push('Expected one blank-worksheet rejection');
      if (this.writes.length !== 0 || this.live !== this.original || this.successes !== 0)
        failures.push('Blank worksheet must not cause a write or success');
      return failures;
    }
    if (this.testCase.registrationRequired) {
      if (JSON.stringify(this.rejections) !== JSON.stringify(['registration-required']))
        failures.push('Expected one missing-registration rejection');
      if (this.writes.length !== 0 || this.live !== this.original || this.successes !== 0)
        failures.push('Missing registrations must not cause a write or success');
      return failures;
    }
    if (this.successes !== 1 || this.writes.length !== 1)
      failures.push('Expected exactly one successful document write');
    if (
      this.rejections.length > 1 ||
      this.rejections.some((type) => !this.testCase.malformed || type !== 'validation-failed')
    )
      failures.push(`Unexpected apply rejections: ${this.rejections.join(', ')}`);
    const root = parse(this.live);
    const original = parse(
      this.testCase.concurrentEdit ? concurrentDesktopEdit(this.original) : this.original,
    );
    const target = named(root, 'dashboard', dashboardName);
    const expected = parse(
      dashboardFragment(this.testCase.after, this.testCase.layoutOnly ? 850 : 800),
    );
    if (!sameXml(target, expected))
      failures.push('Dashboard or Phone layout differs from the intended draft');
    const views = Array.from(
      named(root, 'window', dashboardName).getElementsByTagName('viewpoint'),
    );
    const actualNames = views.map((view) => view.getAttribute('name')).sort();
    if (this.testCase.after.some((name) => !actualNames.includes(name)))
      failures.push('Worksheet view registrations do not match membership');
    for (const view of views) {
      const name = view.getAttribute('name')!;
      if (
        (this.testCase.registered ?? this.testCase.before).includes(name) &&
        !sameXml(view, named(original, 'viewpoint', name))
      )
        failures.push(`Retained view settings changed: ${name}`);
    }
    for (const tag of ['worksheets', 'datasources', 'actions']) {
      if (!sameXml(root.getElementsByTagName(tag)[0], original.getElementsByTagName(tag)[0]))
        failures.push(`Unrelated ${tag} changed`);
    }
    for (const tag of ['dashboard', 'window']) {
      if (!sameXml(named(root, tag, 'Unrelated'), named(original, tag, 'Unrelated')))
        failures.push(`Unrelated ${tag} changed`);
    }
    if (this.writes[0]?.route !== 'dashboard') failures.push('Incorrect apply route');
    if (!this.readback || !sameXml(parse(this.readback), target))
      failures.push('Successful apply was not read back');
    return failures;
  }
}

const toolNames = ['read_cached_xml', 'write_cached_xml', 'apply_dashboard', 'get_dashboard_xml'];

export async function getDashboardApplyEvalAgent(
  mcpServer: MCPServerStdio,
  model: string,
  scenario: DashboardApplyScenario,
): Promise<Agent> {
  const agent = await getAgent({
    mcpServer,
    model,
    systemPrompt:
      'Use the available tools to carry out the dashboard request and report the result.',
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
