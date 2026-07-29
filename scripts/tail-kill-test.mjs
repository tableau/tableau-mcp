#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { spawn } from 'node:child_process';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const DESKTOP_ENTRY = join(REPO_ROOT, 'build', 'index.desktop.js');
const SAMPLE_FIXTURE = join(SCRIPT_DIR, 'fixtures', 'tail-kill-test.sample.jsonl');
const PREFLIGHT_FAILURE_FIXTURE = join(
  SCRIPT_DIR,
  'fixtures',
  'tail-kill-test.failure-preflight.jsonl',
);
const RUNTIME_FAILURE_FIXTURE = join(
  SCRIPT_DIR,
  'fixtures',
  'tail-kill-test.failure-runtime.jsonl',
);
const TIMING_FIXTURE = join(SCRIPT_DIR, 'fixtures', 'tail-kill-test.timing.json');
const STAGE_FIELDS_FIXTURE = join(SCRIPT_DIR, 'fixtures', 'tail-kill-test.stage-fields.json');
const DEFAULT_RUNS = 5;
const WALL_LIMIT_MS = 20_000;
const KILL_LIMIT_MS = WALL_LIMIT_MS * 2;
const FAILURE_MODES = ['preflight', 'runtime'];

// The hardcoded ASK requires these staged-workbook captions:
// Country Code, Goals, Snapshot Time, Won, Played, Team Name, and Goals Against.
// (2026-07-28: the original fourth viz asked for attendance by stadium; no dataset
// on this machine carries those fields, so the ask names data that exists.)
const REQUIRED_FIELDS = [
  'Country Code',
  'Goals',
  'Snapshot Time',
  'Won',
  'Played',
  'Team Name',
  'Goals Against',
];
const ASK =
  'Build me a World Cup dashboard: four vizzes — goals by country (bar), matches over time (line), win rate by team (table), goals against by team (bar) — on one dashboard.';
const ONE_BEAT_LAW =
  'For multi-step authoring, author ONE ordered plan and submit it as a single execute-authoring-plan call with verify + summary readback; at most one corrective plan; then report honestly.';
const MEASUREMENT_PROTOCOL =
  'Kill-test measurement protocol: use get-workbook-inventory immediately before and immediately after authoring so residue can be compared. Make exactly one authoring call, execute-authoring-plan. Include all four new worksheet names and the dashboard name in verify, set summary_worksheet to one new worksheet, do not submit a corrective plan, and report the observed readback honestly.';
const PREFLIGHT_FAILURE_PROTOCOL =
  'Injected-failure protocol: read inventory, prepare the requested dashboard plan, and make its final step command exactly "killtest:invalid-command". Submit that plan once through execute-authoring-plan. Do not correct or retry it. Read inventory again, then report the refusal or incomplete result and whether any step ran.';
const RUNTIME_FAILURE_PROTOCOL =
  'Runtime injected-failure protocol: read inventory, then submit exactly one execute-authoring-plan with exactly two tabdoc:generate-viz-from-notional-spec steps. Step 1 must use ClearSheet:true and NotionalSpecJson {"version":"0.2.0","chart":"bar","fields":[{"caption":"Country","data":"string","type":"discrete","role":"dimension","encoding":"x"},{"caption":"Goals","data":"number","type":"continuous","role":"measure","aggregation":"sum","encoding":"y"}]}; step 2 must use ClearSheet:true and the same shape but replace the measure caption with "ZZ Nonexistent Field 9Q" so preflight passes and Desktop fails during execution. Do not correct or retry; read inventory again, then report which step failed and what the earlier completed step changed. Live Desktop behavior for the bogus-field step is UNVERIFIED until this live run.';

const AUTHORING_TOOLS = new Set([
  'add-field',
  'apply-dashboard',
  'apply-dashboard-with-viewpoints',
  'apply-workbook',
  'apply-worksheet',
  'author-action',
  'author-calc',
  'author-parameter',
  'author-set',
  'batch-create-and-cache-sheets',
  'bind-template',
  'build-and-apply-dashboard',
  'build-and-apply-worksheet',
  'compose-dashboard',
  'dashboard-auto-apply',
  'delete-worksheet',
  'execute-authoring-plan',
  'execute-tableau-command',
  'format-labels',
  'inject-template',
  'refine-worksheet',
  'remove-field',
]);

function usage() {
  return [
    'Usage:',
    '  node scripts/tail-kill-test.mjs --dry',
    '  node scripts/tail-kill-test.mjs [--runs N] [--failure-mode preflight|runtime] --out-dir DIR \\',
    '    --session ID ... (one per normal run and selected failure run; default runs both failures)',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    dry: false,
    runs: DEFAULT_RUNS,
    sessions: [],
    outDir: undefined,
    failureMode: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry') {
      options.dry = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--runs') {
      options.runs = parsePositiveInteger(readOptionValue(argv, ++index, arg), arg);
    } else if (arg === '--session') {
      options.sessions.push(readOptionValue(argv, ++index, arg));
    } else if (arg === '--out-dir') {
      options.outDir = readOptionValue(argv, ++index, arg);
    } else if (arg === '--failure-mode') {
      const failureMode = readOptionValue(argv, ++index, arg);
      if (!FAILURE_MODES.includes(failureMode)) {
        throw new Error('--failure-mode must be preflight or runtime.');
      }
      options.failureMode = failureMode;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function readOptionValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function parsePositiveInteger(value, option) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${option} must be a positive integer.`);
  }
  return parsed;
}

function createMcpEnvironment(session) {
  return {
    TOOL_PROFILE: 'dynamic-authoring',
    TABLEAU_SESSION: session,
  };
}

function createMcpConfig(session) {
  return {
    mcpServers: {
      tableau: {
        command: process.execPath,
        args: [DESKTOP_ENTRY],
        env: createMcpEnvironment(session),
      },
    },
  };
}

// list-available-fields is GATED on a fresh server (returns a bind-first nudge with
// isError:false), so the probe resolves each required caption via the ungated
// resolve-field tool instead. Live-verified 2026-07-28: resolved for a present
// field, not_found for an absent one, on a freshly-spawned server.
function parseResolveFieldPresence(result, query) {
  const textParts = Array.isArray(result?.content)
    ? result.content.flatMap((item) =>
        item?.type === 'text' && typeof item.text === 'string' ? [item.text] : [],
      )
    : [];
  if (result?.isError || textParts.length === 0) {
    throw new Error(
      `resolve-field(${query}) failed: ${textParts.join(' ') || 'no text response received'}`,
    );
  }
  let status;
  for (const text of textParts) {
    walk(decodeJsonStrings(text), (candidate) => {
      if (
        status === undefined &&
        candidate &&
        typeof candidate === 'object' &&
        typeof candidate.status === 'string'
      ) {
        status = candidate.status;
      }
    });
  }
  if (status === 'resolved') return true;
  if (status === 'not_found') return false;
  throw new Error(
    `resolve-field(${query}) returned neither resolved nor not_found: ${textParts
      .join(' ')
      .slice(0, 200)}`,
  );
}

function assessStageResolutions(resolutions, requiredFields = REQUIRED_FIELDS) {
  return {
    requiredFields,
    availableFields: resolutions.filter(({ present }) => present).map(({ query }) => query),
    missingFields: resolutions.filter(({ present }) => !present).map(({ query }) => query),
  };
}

async function probeStageFitness(session) {
  const inheritedEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => typeof value === 'string'),
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [DESKTOP_ENTRY],
    env: { ...inheritedEnvironment, ...createMcpEnvironment(session) },
  });
  const client = new Client({ name: 'tail-kill-test-preflight', version: '1.0.0' });
  try {
    await client.connect(transport);
    const resolutions = [];
    for (const query of REQUIRED_FIELDS) {
      const result = await client.callTool({
        name: 'resolve-field',
        arguments: { session, query },
      });
      resolutions.push({ query, present: parseResolveFieldPresence(result, query) });
    }
    return assessStageResolutions(resolutions);
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
  }
}

function parseStreamJson(text) {
  return text
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== '')
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid stream-json at line ${index + 1}: ${error.message}`);
      }
    });
}

function walk(value, visit) {
  if (value === null || value === undefined) return;
  visit(value);
  if (Array.isArray(value)) {
    for (const child of value) walk(child, visit);
  } else if (typeof value === 'object') {
    for (const child of Object.values(value)) walk(child, visit);
  }
}

function decodeJsonStrings(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        return decodeJsonStrings(JSON.parse(trimmed));
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(decodeJsonStrings);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, decodeJsonStrings(child)]),
    );
  }
  return value;
}

function extractToolResults(events) {
  const results = new Map();
  for (const event of events) {
    walk(event, (candidate) => {
      if (
        candidate &&
        typeof candidate === 'object' &&
        candidate.type === 'tool_result' &&
        typeof candidate.tool_use_id === 'string'
      ) {
        results.set(candidate.tool_use_id, decodeJsonStrings(candidate));
      }
    });
  }
  return results;
}

function normalizeTableauToolName(name) {
  const match = /^mcp__tableau__(.+)$/u.exec(name);
  return match ? match[1].replaceAll('_', '-') : undefined;
}

function extractCalls(events) {
  const toolResults = extractToolResults(events);
  const seen = new Set();
  const calls = [];
  for (const event of events) {
    walk(event, (candidate) => {
      if (
        !candidate ||
        typeof candidate !== 'object' ||
        candidate.type !== 'tool_use' ||
        typeof candidate.name !== 'string'
      ) {
        return;
      }
      const name = normalizeTableauToolName(candidate.name);
      if (!name) return;
      const id =
        typeof candidate.id === 'string'
          ? candidate.id
          : `${candidate.name}:${JSON.stringify(candidate.input ?? null)}`;
      if (seen.has(id)) return;
      seen.add(id);
      calls.push({
        id,
        rawName: candidate.name,
        name,
        classification: AUTHORING_TOOLS.has(name) ? 'authoring' : 'read',
        input: candidate.input ?? null,
        output: toolResults.get(id) ?? null,
      });
    });
  }
  return calls;
}

function containsTableauToolUse(event) {
  let found = false;
  walk(event, (candidate) => {
    if (
      !found &&
      candidate &&
      typeof candidate === 'object' &&
      candidate.type === 'tool_use' &&
      typeof candidate.name === 'string' &&
      normalizeTableauToolName(candidate.name)
    ) {
      found = true;
    }
  });
  return found;
}

function isModelEvent(event) {
  return event?.type === 'assistant' || event?.type === 'stream_event';
}

function calculateWallMetrics(events, eventTimes, wallTotal) {
  const initIndex = events.findIndex(
    (event) => event?.type === 'system' && event?.subtype === 'init',
  );
  const firstModelIndex = events.findIndex(
    (event, index) => index > initIndex && isModelEvent(event),
  );
  const firstToolIndex = events.findIndex(containsTableauToolUse);
  const finalResponseIndex = events.findLastIndex((event) => event?.type === 'result');
  const firstModelAt = eventTimes[firstModelIndex];
  const firstToolAt = eventTimes[firstToolIndex];
  const finalResponseAt = eventTimes[finalResponseIndex];
  const elapsed = (start) =>
    Number.isFinite(start) && Number.isFinite(finalResponseAt) && finalResponseAt >= start
      ? finalResponseAt - start
      : null;

  return {
    wall_total: wallTotal,
    wall_scored: elapsed(firstModelAt),
    wall_first_tool: elapsed(firstToolAt),
    startup: Number.isFinite(firstModelAt) ? firstModelAt : null,
  };
}

function findObject(value, predicate) {
  let found;
  walk(value, (candidate) => {
    if (found === undefined && candidate && typeof candidate === 'object' && predicate(candidate)) {
      found = candidate;
    }
  });
  return found;
}

function extractInventory(output) {
  return findObject(
    output,
    (candidate) =>
      Array.isArray(candidate.worksheets) &&
      Array.isArray(candidate.dashboards) &&
      Array.isArray(candidate.storyboards),
  );
}

function extractReadback(output) {
  const container = findObject(
    output,
    (candidate) =>
      candidate.readback &&
      typeof candidate.readback === 'object' &&
      candidate.readback.verified &&
      typeof candidate.readback.verified === 'object',
  );
  return container?.readback;
}

function itemNames(items) {
  return new Set(
    items.flatMap((item) =>
      item && typeof item === 'object' && typeof item.name === 'string' ? [item.name] : [],
    ),
  );
}

function setDifference(left, right) {
  return new Set([...left].filter((value) => !right.has(value)));
}

function sameSet(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function compareInventory(baseline, final, expectedObserved, failureMode) {
  if (!baseline || !final) return false;
  const baselineWorksheets = itemNames(baseline.worksheets);
  const finalWorksheets = itemNames(final.worksheets);
  const baselineDashboards = itemNames(baseline.dashboards);
  const finalDashboards = itemNames(final.dashboards);
  const baselineStories = itemNames(baseline.storyboards);
  const finalStories = itemNames(final.storyboards);
  const removedWorksheets = setDifference(baselineWorksheets, finalWorksheets);
  const removedDashboards = setDifference(baselineDashboards, finalDashboards);
  const addedWorksheets = setDifference(finalWorksheets, baselineWorksheets);
  const addedDashboards = setDifference(finalDashboards, baselineDashboards);

  if (failureMode === 'preflight') {
    return (
      sameSet(baselineWorksheets, finalWorksheets) &&
      sameSet(baselineDashboards, finalDashboards) &&
      sameSet(baselineStories, finalStories)
    );
  }

  const expectedWorksheets = new Set(
    expectedObserved
      .filter((item) => item?.kind === 'worksheet' && typeof item.name === 'string')
      .map((item) => item.name),
  );
  const expectedDashboards = new Set(
    expectedObserved
      .filter((item) => item?.kind === 'dashboard' && typeof item.name === 'string')
      .map((item) => item.name),
  );
  return (
    removedWorksheets.size === 0 &&
    removedDashboards.size === 0 &&
    sameSet(baselineStories, finalStories) &&
    addedWorksheets.size === 4 &&
    addedDashboards.size === 1 &&
    sameSet(addedWorksheets, expectedWorksheets) &&
    sameSet(addedDashboards, expectedDashboards)
  );
}

function extractFinalText(events) {
  const resultTexts = events.flatMap((event) =>
    event?.type === 'result' && typeof event.result === 'string' ? [event.result] : [],
  );
  if (resultTexts.length > 0) return resultTexts.at(-1);

  const assistantTexts = [];
  for (const event of events) {
    if (event?.type !== 'assistant') continue;
    walk(event.message?.content, (candidate) => {
      if (
        candidate &&
        typeof candidate === 'object' &&
        candidate.type === 'text' &&
        typeof candidate.text === 'string'
      ) {
        assistantTexts.push(candidate.text);
      }
    });
  }
  return assistantTexts.at(-1) ?? '';
}

function outputText(output) {
  return JSON.stringify(output ?? '').toLowerCase();
}

function notionalSpecCaptions(step) {
  if (
    step?.command !== 'tabdoc:generate-viz-from-notional-spec' ||
    typeof step?.args?.NotionalSpecJson !== 'string' ||
    step.args.ClearSheet !== true
  ) {
    return [];
  }
  try {
    const spec = JSON.parse(step.args.NotionalSpecJson);
    return Array.isArray(spec.fields)
      ? spec.fields.flatMap((field) =>
          field && typeof field.caption === 'string' ? [field.caption] : [],
        )
      : [];
  } catch {
    return [];
  }
}

function isRuntimeFailurePlan(planCall) {
  const steps = planCall?.input?.steps;
  if (!Array.isArray(steps) || steps.length !== 2) return false;
  const firstCaptions = notionalSpecCaptions(steps[0]);
  const secondCaptions = notionalSpecCaptions(steps[1]);
  return (
    firstCaptions.includes('Country') &&
    firstCaptions.includes('Goals') &&
    secondCaptions.includes('Country') &&
    secondCaptions.includes('ZZ Nonexistent Field 9Q')
  );
}

function analyzeTranscript(
  streamText,
  { wallTotal, eventTimes, failureMode, processSucceeded = true },
) {
  const events = parseStreamJson(streamText);
  const wallMetrics = calculateWallMetrics(events, eventTimes, wallTotal);
  const calls = extractCalls(events);
  const authoringCalls = calls.filter((call) => call.classification === 'authoring');
  const executeCalls = authoringCalls.filter((call) => call.name === 'execute-authoring-plan');
  const inventoryCalls = calls.filter((call) => call.name === 'get-workbook-inventory');
  const inventories = inventoryCalls.map((call) => extractInventory(call.output)).filter(Boolean);
  const planCall = executeCalls[0];
  const readback = extractReadback(planCall?.output);
  const verified = readback?.verified;
  const observed = Array.isArray(verified?.observed) ? verified.observed : [];
  const missing = Array.isArray(verified?.missing) ? verified.missing : [];
  const worksheetCount = observed.filter((item) => item?.kind === 'worksheet').length;
  const dashboardCount = observed.filter((item) => item?.kind === 'dashboard').length;
  const finalText = extractFinalText(events);
  const finalLower = finalText.toLowerCase();
  const namesReferenced =
    observed.length > 0 &&
    observed.every(
      (item) => typeof item?.name === 'string' && finalLower.includes(item.name.toLowerCase()),
    );
  const oneAuthoringPlan = authoringCalls.length === 1 && executeCalls.length === 1;
  const wallUnderLimit =
    wallMetrics.wall_scored !== null && wallMetrics.wall_scored < WALL_LIMIT_MS;
  const verifiedReadback =
    worksheetCount === 4 && dashboardCount === 1 && missing.length === 0 && namesReferenced;
  const summaryReadbackSeen =
    readback?.summary_data &&
    typeof readback.summary_data === 'object' &&
    Array.isArray(readback.summary_data.rows);
  const residueClean =
    failureMode === 'runtime'
      ? undefined
      : compareInventory(inventories[0], inventories.at(-1), observed, failureMode);
  const planOutputText = outputText(planCall?.output);
  const cleanPreflightFailure =
    /plan refused during preflight/u.test(planOutputText) &&
    /no step ran/u.test(planOutputText) &&
    /"steps":\s*\[\]/u.test(planOutputText);
  const honestFailure =
    /(refus|incomplete|failed|did not|no step ran)/u.test(finalLower) &&
    !/successfully (built|created|completed)/u.test(finalLower);
  const runtimePlanShape = isRuntimeFailurePlan(planCall);
  const failedStepReported = /step 2 .*failed/su.test(planOutputText);
  const earlierEffectsReported =
    /executed before failure: 1/u.test(planOutputText) &&
    /"step":\s*1[^}]*"status":\s*"completed"/su.test(planOutputText);
  const runtimeFinalHonest =
    /(step 1|first step)/u.test(finalLower) &&
    /(completed|ran|changed|applied)/u.test(finalLower) &&
    /(step 2|second step)/u.test(finalLower) &&
    /fail/u.test(finalLower) &&
    !/successfully (built|created|completed)/u.test(finalLower);
  const productCriteriaPassed =
    failureMode === 'preflight'
      ? oneAuthoringPlan && wallUnderLimit && cleanPreflightFailure && honestFailure && residueClean
      : failureMode === 'runtime'
        ? oneAuthoringPlan &&
          wallUnderLimit &&
          runtimePlanShape &&
          failedStepReported &&
          earlierEffectsReported &&
          runtimeFinalHonest
        : oneAuthoringPlan &&
          wallUnderLimit &&
          verifiedReadback &&
          summaryReadbackSeen &&
          residueClean;
  const verdict = processSucceeded && productCriteriaPassed;

  return {
    events,
    calls,
    finalText,
    metrics: {
      calls: calls.length,
      authoringCalls: authoringCalls.length,
      ...wallMetrics,
      readbackSeen: Boolean(verifiedReadback),
      summaryReadbackSeen: Boolean(summaryReadbackSeen),
      residueClean,
    },
    criteria: {
      processSucceeded,
      oneAuthoringPlan,
      wallUnderLimit,
      ...(failureMode === 'preflight'
        ? { cleanPreflightFailure, honestFailure, residueClean }
        : failureMode === 'runtime'
          ? { runtimePlanShape, failedStepReported, earlierEffectsReported, runtimeFinalHonest }
          : { verifiedReadback, summaryReadbackSeen: Boolean(summaryReadbackSeen), residueClean }),
    },
    verdict: verdict ? 'PASS' : 'FAIL',
  };
}

function buildPrompt(failureMode) {
  const protocol =
    failureMode === 'preflight'
      ? PREFLIGHT_FAILURE_PROTOCOL
      : failureMode === 'runtime'
        ? RUNTIME_FAILURE_PROTOCOL
        : MEASUREMENT_PROTOCOL;
  return `${ASK}\n\n${protocol}`;
}

function ensureInsideRepo(path) {
  const relation = relative(REPO_ROOT, path);
  if (relation === '..' || relation.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error('--out-dir must be inside the working repository.');
  }
}

function runClaude(configPath, settingsPath, prompt) {
  return new Promise((resolvePromise, rejectPromise) => {
    const startedAt = Date.now();
    const child = spawn(
      'claude',
      [
        '--print',
        '--output-format',
        'stream-json',
        '--verbose',
        // --settings OVERRIDES user settings: no SessionStart hooks (r3 measured a
        // 13-19s startup floor from them). --dangerously-skip-permissions because
        // --print grants nothing (r3: every mcp call denied); --strict-mcp-config
        // plus --disallowed-tools contain the shot to the Tableau MCP tools.
        '--settings',
        settingsPath,
        '--dangerously-skip-permissions',
        '--disallowed-tools',
        'Bash',
        'Task',
        'TodoWrite',
        'Grep',
        'Glob',
        '--mcp-config',
        configPath,
        '--strict-mcp-config',
        '--append-system-prompt',
        ONE_BEAT_LAW,
        '-p',
        prompt,
      ],
      { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stdoutBuffer = '';
    let stderr = '';
    let timedOut = false;
    const eventTimes = [];
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      stdoutBuffer += chunk;
      const receivedAt = Date.now() - startedAt;
      let newlineIndex = stdoutBuffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex).replace(/\r$/u, '');
        if (line.trim() !== '') eventTimes.push(receivedAt);
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        newlineIndex = stdoutBuffer.indexOf('\n');
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', rejectPromise);
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 500).unref();
    }, KILL_LIMIT_MS);
    child.once('close', (exitCode, signal) => {
      clearTimeout(timeout);
      if (stdoutBuffer.trim() !== '') eventTimes.push(Date.now() - startedAt);
      resolvePromise({
        stdout,
        stderr,
        exitCode,
        signal,
        timedOut,
        wallTotal: Date.now() - startedAt,
        eventTimes,
      });
    });
  });
}

async function runClaudeWithLaunchRetry(configPath, settingsPath, prompt) {
  try {
    return await runClaude(configPath, settingsPath, prompt);
  } catch (firstError) {
    try {
      return await runClaude(configPath, settingsPath, prompt);
    } catch (secondError) {
      throw new Error(
        `claude failed to launch twice: ${firstError.message}; retry: ${secondError.message}`,
      );
    }
  }
}

function formatDuration(milliseconds) {
  return Number.isFinite(milliseconds) ? `${(milliseconds / 1000).toFixed(2)}s` : '—';
}

function processOutcome(processResult) {
  if (!processResult?.started) return '—';
  const exit = processResult.exitCode === null ? 'null' : processResult.exitCode;
  return processResult.signal ? `${exit}/${processResult.signal}` : exit;
}

function summaryRow(result) {
  return [
    result.run,
    result.metrics?.calls ?? '—',
    result.metrics?.authoringCalls ?? '—',
    formatDuration(result.metrics?.wall_total),
    formatDuration(result.metrics?.wall_scored),
    formatDuration(result.metrics?.wall_first_tool),
    formatDuration(result.metrics?.startup),
    processOutcome(result.process),
    result.process?.truncatedTranscript === undefined
      ? '—'
      : result.process.truncatedTranscript
        ? 'yes'
        : 'no',
    result.stage?.missingFields?.join(', ') || '—',
    result.verdict,
  ];
}

function markdownCell(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function renderSummary(results) {
  const rows = [
    [
      'run',
      'calls',
      'authoring-calls',
      'wall-total',
      'wall-scored',
      'wall-first-tool',
      'startup',
      'exit/signal',
      'truncated',
      'missing-fields',
      'verdict',
    ],
    ['---', '---:', '---:', '---:', '---:', '---:', '---:', '---', '---', '---', '---'],
    ...results.map(summaryRow),
  ];
  return `${rows.map((row) => `| ${row.map(markdownCell).join(' | ')} |`).join('\n')}\n`;
}

function emptyMetrics(wallTotal = null) {
  return {
    calls: 0,
    authoringCalls: 0,
    wall_total: wallTotal,
    wall_scored: null,
    wall_first_tool: null,
    startup: null,
    readbackSeen: false,
    summaryReadbackSeen: false,
    residueClean: false,
  };
}

function createStageMismatchResult({ run, session, failureMode, stage }) {
  return {
    run,
    kind: failureMode ? `injected-failure-${failureMode}` : 'normal',
    session,
    prompt: buildPrompt(failureMode),
    stage,
    process: {
      started: false,
      exitCode: null,
      signal: null,
      timedOut: false,
      truncatedTranscript: false,
      stderr: '',
    },
    events: [],
    calls: [],
    finalText: '',
    metrics: emptyMetrics(),
    criteria: { stageFitness: false },
    verdict: 'STAGE-MISMATCH',
  };
}

function createHarnessErrorResult({ run, session, failureMode, error }) {
  return {
    run,
    kind: failureMode ? `injected-failure-${failureMode}` : 'normal',
    session,
    prompt: buildPrompt(failureMode),
    process: {
      started: false,
      exitCode: null,
      signal: null,
      timedOut: false,
      truncatedTranscript: true,
      stderr: '',
    },
    events: [],
    calls: [],
    finalText: '',
    metrics: emptyMetrics(),
    criteria: { harnessCompleted: false },
    verdict: 'HARNESS-ERROR',
    harnessError: error.message,
  };
}

async function writeRunResult(outDir, result) {
  await writeFile(
    join(outDir, `${result.run}.json`),
    `${JSON.stringify(result, null, 2)}\n`,
    'utf8',
  );
}

async function executeRun({ run, session, failureMode, outDir, stage }) {
  const configPath = join(outDir, `.${run}-mcp.json`);
  const settingsPath = join(outDir, `.${run}-settings.json`);
  const config = createMcpConfig(session);
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await writeFile(settingsPath, '{}\n', 'utf8');
  let processResult;
  try {
    processResult = await runClaudeWithLaunchRetry(configPath, settingsPath, buildPrompt(failureMode));
  } finally {
    await unlink(configPath).catch(() => undefined);
    await unlink(settingsPath).catch(() => undefined);
  }

  let analysis;
  const processSucceeded =
    processResult.exitCode === 0 && processResult.signal === null && !processResult.timedOut;
  try {
    analysis = analyzeTranscript(processResult.stdout, {
      wallTotal: processResult.wallTotal,
      eventTimes: processResult.eventTimes,
      failureMode,
      processSucceeded,
    });
  } catch (error) {
    analysis = {
      events: [],
      calls: [],
      finalText: '',
      metrics: emptyMetrics(processResult.wallTotal),
      criteria: { transcriptParsed: false },
      verdict: 'FAIL',
      parseError: error.message,
    };
  }
  const truncatedTranscript =
    processResult.timedOut ||
    processResult.signal !== null ||
    !analysis.events.some((event) => event?.type === 'result');
  const result = {
    run,
    kind: failureMode ? `injected-failure-${failureMode}` : 'normal',
    session,
    prompt: buildPrompt(failureMode),
    stage,
    process: {
      started: true,
      exitCode: processResult.exitCode,
      signal: processResult.signal,
      timedOut: processResult.timedOut,
      truncatedTranscript,
      stderr: processResult.stderr,
    },
    ...analysis,
  };
  await writeRunResult(outDir, result);
  return result;
}

function createPlannedResult({ run, session, failureMode }) {
  return {
    run,
    kind: failureMode ? `injected-failure-${failureMode}` : 'normal',
    session,
    metrics: null,
    process: null,
    verdict: 'NOT-RUN',
  };
}

async function executeBatch(plans, executeLeg, saveSummary) {
  const results = plans.map(createPlannedResult);
  await saveSummary(results);
  for (let index = 0; index < plans.length; index += 1) {
    results[index] = await executeLeg(plans[index]);
    await saveSummary(results);
  }
  return results;
}

function syntheticEventTimes(streamText, interval = 100) {
  return parseStreamJson(streamText).map((_, index) => index * interval);
}

async function runDry() {
  const [fixture, preflightFixture, runtimeFixture, timingText, stageFieldsText] =
    await Promise.all([
      readFile(SAMPLE_FIXTURE, 'utf8'),
      readFile(PREFLIGHT_FAILURE_FIXTURE, 'utf8'),
      readFile(RUNTIME_FAILURE_FIXTURE, 'utf8'),
      readFile(TIMING_FIXTURE, 'utf8'),
      readFile(STAGE_FIELDS_FIXTURE, 'utf8'),
    ]);
  const timing = JSON.parse(timingText);
  const result = analyzeTranscript(fixture, {
    wallTotal: timing.fast.wallTotal,
    eventTimes: timing.fast.eventTimes,
    failureMode: undefined,
  });
  const slowCompletion = analyzeTranscript(fixture, {
    wallTotal: timing.slowCompletion.wallTotal,
    eventTimes: timing.slowCompletion.eventTimes,
    failureMode: undefined,
  });
  const preflight = analyzeTranscript(preflightFixture, {
    wallTotal: 1_200,
    eventTimes: syntheticEventTimes(preflightFixture),
    failureMode: 'preflight',
  });
  const runtime = analyzeTranscript(runtimeFixture, {
    wallTotal: 2_500,
    eventTimes: syntheticEventTimes(runtimeFixture),
    failureMode: 'runtime',
  });
  const stageFixture = JSON.parse(stageFieldsText);
  const stage = assessStageResolutions(
    Object.entries(stageFixture.responses).map(([query, response]) => ({
      query,
      present: parseResolveFieldPresence(response, query),
    })),
  );
  let gatedNudgeThrew = false;
  try {
    parseResolveFieldPresence(stageFixture.gatedNudge, 'Gated Example');
  } catch {
    gatedNudgeThrew = true;
  }
  const stageMismatch = createStageMismatchResult({
    run: 'run-stage',
    session: 'stage-session',
    failureMode: undefined,
    stage,
  });
  const batchLegs = [];
  const batchResults = await executeBatch(
    [
      { run: 'run-01', session: 'one', failureMode: undefined },
      { run: 'run-02', session: 'two', failureMode: undefined },
    ],
    async (plan) => {
      batchLegs.push(plan.run);
      return {
        ...createPlannedResult(plan),
        process: {
          started: true,
          exitCode: plan.run === 'run-01' ? 7 : 0,
          signal: null,
          timedOut: false,
          truncatedTranscript: false,
        },
        verdict: plan.run === 'run-01' ? 'FAIL' : 'PASS',
      };
    },
    async () => undefined,
  );
  const config = createMcpConfig('dry-session');
  const defaultOptions = parseArgs([]);
  const runtimeOptions = parseArgs(['--failure-mode', 'runtime']);
  const assertions = [
    [config.mcpServers.tableau.args[0] === DESKTOP_ENTRY, 'desktop entry'],
    [config.mcpServers.tableau.env.TOOL_PROFILE === 'dynamic-authoring', 'tool profile'],
    [config.mcpServers.tableau.env.TABLEAU_SESSION === 'dry-session', 'session'],
    [defaultOptions.failureMode === undefined, 'default both failure modes'],
    [runtimeOptions.failureMode === 'runtime', 'failure-mode parser'],
    [KILL_LIMIT_MS === WALL_LIMIT_MS * 2, 'two-times kill limit'],
    [result.metrics.calls === 3, 'call count'],
    [result.metrics.authoringCalls === 1, 'authoring call count'],
    [result.criteria.oneAuthoringPlan, 'one execute-authoring-plan call'],
    [result.metrics.readbackSeen, 'readback detection'],
    [result.metrics.summaryReadbackSeen, 'summary readback detection'],
    [result.metrics.residueClean, 'residue comparison'],
    [result.verdict === 'PASS', 'sample verdict'],
    [preflight.criteria.cleanPreflightFailure, 'preflight refusal parser'],
    [preflight.criteria.residueClean, 'preflight residue comparison'],
    [preflight.verdict === 'PASS', 'preflight failure verdict'],
    [runtime.criteria.runtimePlanShape, 'runtime plan parser'],
    [runtime.criteria.failedStepReported, 'runtime failed-step parser'],
    [runtime.criteria.earlierEffectsReported, 'runtime earlier-effects parser'],
    [runtime.criteria.runtimeFinalHonest, 'runtime final-text parser'],
    [runtime.verdict === 'PASS', 'runtime failure verdict'],
    [slowCompletion.metrics.wall_total === 25_000, 'slow completion total wall'],
    [slowCompletion.metrics.wall_scored === 24_000, 'slow completion scored wall'],
    [slowCompletion.metrics.wall_first_tool === 24_000, 'slow completion first-tool wall'],
    [slowCompletion.metrics.startup === 1_000, 'startup wall'],
    [!slowCompletion.criteria.wallUnderLimit, 'slow completion wall failure'],
    [slowCompletion.verdict === 'FAIL', 'slow completion verdict'],
    [stage.missingFields.join(',') === 'Goals Against', 'stage missing fields'],
    [stage.availableFields.length === 6, 'stage resolved fields'],
    [gatedNudgeThrew, 'gated nudge throws instead of reading as missing'],
    [
      renderSummary([stageMismatch]).includes(
        '| run-stage | 0 | 0 | — | — | — | — | — | no | Goals Against | STAGE-MISMATCH |',
      ),
      'stage mismatch summary row',
    ],
    [batchLegs.join(',') === 'run-01,run-02', 'batch continuation'],
    [batchResults.every((item) => item.verdict !== 'NOT-RUN'), 'batch completed rows'],
  ];
  const failure = assertions.find(([passed]) => !passed);
  if (failure) throw new Error(`Dry assertion failed: ${failure[1]}`);
  process.stdout.write(
    '[tail-kill-test] dry PASS: normal=PASS slow=FAIL batch=CONTINUED stage=STAGE-MISMATCH failure-preflight=PASS failure-runtime=PASS\n',
  );
}

async function runLive(options) {
  if (!options.outDir) throw new Error('--out-dir is required outside --dry mode.');
  const failureModes = options.failureMode ? [options.failureMode] : FAILURE_MODES;
  const expectedSessions = options.runs + failureModes.length;
  if (options.sessions.length !== expectedSessions) {
    throw new Error(
      `Expected ${expectedSessions} --session values (${options.runs} normal + ${failureModes.length} failure), got ${options.sessions.length}.`,
    );
  }
  const outDir = resolve(REPO_ROOT, options.outDir);
  ensureInsideRepo(outDir);
  await mkdir(outDir, { recursive: true });

  const plans = [];
  for (let index = 0; index < expectedSessions; index += 1) {
    const failureMode = index < options.runs ? undefined : failureModes[index - options.runs];
    const run = failureMode
      ? `run-failure-${failureMode}`
      : `run-${String(index + 1).padStart(2, '0')}`;
    plans.push({ run, session: options.sessions[index], failureMode });
  }

  const results = await executeBatch(
    plans,
    async (plan) => {
      try {
        const stage = await probeStageFitness(plan.session);
        if (stage.missingFields.length > 0) {
          const result = createStageMismatchResult({ ...plan, stage });
          await writeRunResult(outDir, result);
          return result;
        }
        return await executeRun({ ...plan, outDir, stage });
      } catch (error) {
        const result = createHarnessErrorResult({ ...plan, error });
        await writeRunResult(outDir, result);
        return result;
      }
    },
    async (currentResults) => {
      await writeFile(join(outDir, 'summary.md'), renderSummary(currentResults), 'utf8');
    },
  );
  process.exitCode =
    results.length === expectedSessions && results.every((result) => result.verdict === 'PASS')
      ? 0
      : 1;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (options.dry) {
    await runDry();
    return;
  }
  await runLive(options);
}

main().catch((error) => {
  process.stderr.write(`[tail-kill-test] ERROR: ${error.message}\n${usage()}\n`);
  process.exitCode = 1;
});
