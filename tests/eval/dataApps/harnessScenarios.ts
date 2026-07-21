/**
 * Trace-derived regression scenarios for the static data-app workflow, expressed against the
 * repository's established eval harness (`tests/eval/base.ts` + `grade.ts`).
 *
 * These describe agent BEHAVIOUR that is not deterministically code-testable (it depends on an LLM
 * deciding how to query, author, and split data). The purely code-testable invariants from the same
 * Claude trace live instead in
 * `src/tools/web/dataApps/staticDataAppFlow.integration.test.ts`, which runs in `scripts/agent-check`.
 *
 * This module is intentionally free of live-service calls so it can be imported and type-checked
 * anywhere. The colocated `harnessScenarios.test.ts` consumes it and only reaches live services when
 * an `OPENAI_API_KEY` (and Tableau credentials) are present, mirroring the other eval suites.
 */

/**
 * The observed shape of a tool call, mirroring `getToolExecutions()` in `tests/eval/base.ts`
 * (kept as a local structural type so this module has no runtime dependency on the harness).
 */
export type ToolExecution = {
  name: string;
  arguments: Record<string, unknown>;
  output: string;
};

export type DataAppEvalScenario = {
  /** Stable id for reporting. */
  id: string;
  /** Business-language prompt the agent receives (no tool orchestration hints). */
  prompt: string;
  /** What the scenario is proving, from the trace. */
  intent: string;
  /**
   * Behavioural invariants checked against the observed tool executions. Each returns an error
   * message when violated, or `undefined` when satisfied.
   */
  invariants: ReadonlyArray<(executions: ReadonlyArray<ToolExecution>) => string | undefined>;
};

/** Strip the eval harness's `tableau_` prefix so scenarios can match plain MCP tool names. */
export function toolBaseName(name: string): string {
  return name.replace(/^tableau_/, '');
}

function indexOfTool(executions: ReadonlyArray<ToolExecution>, name: string): number {
  return executions.findIndex((e) => toolBaseName(e.name) === name);
}

/** The workspace-authoring workflow tools, in the order the trace exercises them. */
export const WORKFLOW_TOOLS = [
  'scaffold-data-app',
  'upsert-data-app-files',
  'validate-workbook-package',
  'create-and-publish-workbook',
] as const;

/** Assert tool A is invoked strictly before tool B (both must be present). */
function orderedBefore(
  executions: ReadonlyArray<ToolExecution>,
  a: string,
  b: string,
): string | undefined {
  const ai = indexOfTool(executions, a);
  const bi = indexOfTool(executions, b);
  if (ai === -1) {
    return `expected ${a} to be called`;
  }
  if (bi === -1) {
    return `expected ${b} to be called`;
  }
  return ai < bi ? undefined : `expected ${a} to be called before ${b}`;
}

/** No file/HTML content is transmitted anywhere except upsert-data-app-files. */
function htmlOnlyInUpsert(executions: ReadonlyArray<ToolExecution>): string | undefined {
  for (const execution of executions) {
    const base = toolBaseName(execution.name);
    if (base === 'upsert-data-app-files') {
      continue;
    }
    const serialized = JSON.stringify(execution.arguments ?? {}).toLowerCase();
    if (serialized.includes('<!doctype') || serialized.includes('<html')) {
      return `HTML markup leaked into ${base} arguments; source must only flow through upsert-data-app-files`;
    }
  }
  return undefined;
}

/** Publication consumes a validationId (never raw HTML/build params). */
function publishConsumesValidationId(executions: ReadonlyArray<ToolExecution>): string | undefined {
  const publish = executions.find((e) => toolBaseName(e.name) === 'create-and-publish-workbook');
  if (!publish) {
    return 'expected create-and-publish-workbook to be called';
  }
  const args = (publish.arguments ?? {}) as Record<string, unknown>;
  if (typeof args.validationId !== 'string' || args.validationId.length === 0) {
    return 'create-and-publish-workbook must be called with a validationId';
  }
  return undefined;
}

export const staticDataAppScenarios: ReadonlyArray<DataAppEvalScenario> = [
  {
    id: 'build-static-data-app-end-to-end',
    prompt:
      'Using data from my Tableau site, build me a small self-contained web dashboard that shows ' +
      'quarterly sales, let me review it, and then publish it to my site once I approve.',
    intent:
      'The agent scaffolds a workspace, writes source once, validates to a receipt, and publishes ' +
      'that receipt — never re-sending HTML to validate/publish.',
    invariants: [
      (e) => orderedBefore(e, 'scaffold-data-app', 'upsert-data-app-files'),
      (e) => orderedBefore(e, 'upsert-data-app-files', 'validate-workbook-package'),
      (e) => orderedBefore(e, 'validate-workbook-package', 'create-and-publish-workbook'),
      htmlOnlyInUpsert,
      publishConsumesValidationId,
    ],
  },
  {
    id: 'oversized-query-data-is-aggregated-by-agent',
    prompt:
      'Build a static dashboard summarizing every order in my Superstore data. There are far too ' +
      'many rows to embed individually.',
    intent:
      'Oversized query results are aggregated/summarized by the agent before being embedded as ' +
      'static rows — never hidden in an inaccessible harness path or embedded row-for-row.',
    invariants: [
      // The agent must still produce a workspace it authored source into; the aggregation decision
      // itself is graded qualitatively by the eval judge, not asserted structurally here.
      (e) => orderedBefore(e, 'scaffold-data-app', 'upsert-data-app-files'),
      htmlOnlyInUpsert,
    ],
  },
];
