#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { spawn } from 'node:child_process';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const DESKTOP_ENTRY = join(REPO_ROOT, 'build', 'index.desktop.js');
const SAMPLE_FIXTURE = join(SCRIPT_DIR, 'fixtures', 'tail-kill-test.sample.jsonl');
const DEFAULT_RUNS = 5;
const WALL_LIMIT_MS = 20_000;

const ASK =
  'Build me a World Cup dashboard: four vizzes — goals by country (bar), matches over time (line), win rate by team (table), attendance by stadium (bar) — on one dashboard.';
const ONE_BEAT_LAW =
  'For multi-step authoring, author ONE ordered plan and submit it as a single execute-authoring-plan call with verify + summary readback; at most one corrective plan; then report honestly.';
const MEASUREMENT_PROTOCOL =
  'Kill-test measurement protocol: use get-workbook-inventory immediately before and immediately after authoring so residue can be compared. Make exactly one authoring call, execute-authoring-plan. Include all four new worksheet names and the dashboard name in verify, set summary_worksheet to one new worksheet, do not submit a corrective plan, and report the observed readback honestly.';
const FAILURE_PROTOCOL =
  'Injected-failure protocol: read inventory, prepare the requested dashboard plan, and make its final step command exactly "killtest:invalid-command". Submit that plan once through execute-authoring-plan. Do not correct or retry it. Read inventory again, then report the refusal or incomplete result and whether any step ran.';

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
    '  node scripts/tail-kill-test.mjs [--runs N] --out-dir DIR \\',
    '    --session ID ... (one session for each normal run plus one failure run)',
  ].join('\n');
}

function parseArgs(argv) {
  const options = { dry: false, runs: DEFAULT_RUNS, sessions: [], outDir: undefined };
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

function createMcpConfig(session) {
  return {
    mcpServers: {
      tableau: {
        command: process.execPath,
        args: [DESKTOP_ENTRY],
        env: {
          TOOL_PROFILE: 'dynamic-authoring',
          TABLEAU_SESSION: session,
        },
      },
    },
  };
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

function compareInventory(baseline, final, expectedObserved, failureRun) {
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

  if (failureRun) {
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

function analyzeTranscript(streamText, { wallMs, failureRun }) {
  const events = parseStreamJson(streamText);
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
  const wallUnderLimit = wallMs < WALL_LIMIT_MS;
  const verifiedReadback =
    worksheetCount === 4 && dashboardCount === 1 && missing.length === 0 && namesReferenced;
  const summaryReadbackSeen =
    readback?.summary_data &&
    typeof readback.summary_data === 'object' &&
    Array.isArray(readback.summary_data.rows);
  const residueClean = compareInventory(inventories[0], inventories.at(-1), observed, failureRun);
  const planOutputText = outputText(planCall?.output);
  const cleanFailure =
    /plan refused during preflight/u.test(planOutputText) &&
    /no step ran/u.test(planOutputText) &&
    /"steps":\s*\[\]/u.test(planOutputText);
  const honestFailure =
    /(refus|incomplete|failed|did not|no step ran)/u.test(finalLower) &&
    !/successfully (built|created|completed)/u.test(finalLower);
  const verdict = failureRun
    ? oneAuthoringPlan && wallUnderLimit && cleanFailure && honestFailure && residueClean
    : oneAuthoringPlan && wallUnderLimit && verifiedReadback && summaryReadbackSeen && residueClean;

  return {
    events,
    calls,
    finalText,
    metrics: {
      calls: calls.length,
      authoringCalls: authoringCalls.length,
      wallMs,
      readbackSeen: Boolean(verifiedReadback),
      summaryReadbackSeen: Boolean(summaryReadbackSeen),
      residueClean,
    },
    criteria: {
      oneAuthoringPlan,
      wallUnderLimit,
      ...(failureRun
        ? { cleanFailure, honestFailure, residueClean }
        : { verifiedReadback, summaryReadbackSeen: Boolean(summaryReadbackSeen), residueClean }),
    },
    verdict: verdict ? 'PASS' : 'FAIL',
  };
}

function buildPrompt(failureRun) {
  return failureRun ? `${ASK}\n\n${FAILURE_PROTOCOL}` : `${ASK}\n\n${MEASUREMENT_PROTOCOL}`;
}

function ensureInsideRepo(path) {
  const relation = relative(REPO_ROOT, path);
  if (relation === '..' || relation.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error('--out-dir must be inside the working repository.');
  }
}

function runClaude(configPath, prompt) {
  return new Promise((resolvePromise, rejectPromise) => {
    const startedAt = Date.now();
    const child = spawn(
      'claude',
      [
        '--print',
        '--output-format',
        'stream-json',
        '--verbose',
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
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', rejectPromise);
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 500).unref();
    }, WALL_LIMIT_MS);
    child.once('close', (exitCode, signal) => {
      clearTimeout(timeout);
      resolvePromise({
        stdout,
        stderr,
        exitCode,
        signal,
        timedOut,
        wallMs: Date.now() - startedAt,
      });
    });
  });
}

async function runClaudeWithLaunchRetry(configPath, prompt) {
  try {
    return await runClaude(configPath, prompt);
  } catch (firstError) {
    try {
      return await runClaude(configPath, prompt);
    } catch (secondError) {
      throw new Error(
        `claude failed to launch twice: ${firstError.message}; retry: ${secondError.message}`,
      );
    }
  }
}

function summaryRow(result) {
  return [
    result.run,
    result.metrics.calls,
    result.metrics.authoringCalls,
    `${(result.metrics.wallMs / 1000).toFixed(2)}s`,
    result.metrics.readbackSeen ? 'yes' : 'no',
    result.verdict,
  ];
}

function markdownCell(value) {
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function renderSummary(results) {
  const rows = [
    ['run', 'calls', 'authoring-calls', 'wall', 'readback-seen', 'verdict'],
    ['---', '---:', '---:', '---:', '---', '---'],
    ...results.map(summaryRow),
  ];
  return `${rows.map((row) => `| ${row.map(markdownCell).join(' | ')} |`).join('\n')}\n`;
}

async function executeRun({ run, session, failureRun, outDir }) {
  const configPath = join(outDir, `.${run}-mcp.json`);
  const config = createMcpConfig(session);
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  let processResult;
  try {
    processResult = await runClaudeWithLaunchRetry(configPath, buildPrompt(failureRun));
  } finally {
    await unlink(configPath).catch(() => undefined);
  }

  let analysis;
  try {
    analysis = analyzeTranscript(processResult.stdout, {
      wallMs: processResult.wallMs,
      failureRun,
    });
  } catch (error) {
    analysis = {
      events: [],
      calls: [],
      finalText: '',
      metrics: {
        calls: 0,
        authoringCalls: 0,
        wallMs: processResult.wallMs,
        readbackSeen: false,
        summaryReadbackSeen: false,
        residueClean: false,
      },
      criteria: { transcriptParsed: false },
      verdict: 'FAIL',
      parseError: error.message,
    };
  }
  const result = {
    run,
    kind: failureRun ? 'injected-failure' : 'normal',
    session,
    prompt: buildPrompt(failureRun),
    process: {
      exitCode: processResult.exitCode,
      signal: processResult.signal,
      timedOut: processResult.timedOut,
      stderr: processResult.stderr,
    },
    ...analysis,
  };
  await writeFile(join(outDir, `${run}.json`), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return result;
}

async function runDry() {
  const fixture = await readFile(SAMPLE_FIXTURE, 'utf8');
  const result = analyzeTranscript(fixture, { wallMs: 12_340, failureRun: false });
  const config = createMcpConfig('dry-session');
  const assertions = [
    [config.mcpServers.tableau.args[0] === DESKTOP_ENTRY, 'desktop entry'],
    [config.mcpServers.tableau.env.TOOL_PROFILE === 'dynamic-authoring', 'tool profile'],
    [config.mcpServers.tableau.env.TABLEAU_SESSION === 'dry-session', 'session'],
    [result.metrics.calls === 3, 'call count'],
    [result.metrics.authoringCalls === 1, 'authoring call count'],
    [result.criteria.oneAuthoringPlan, 'one execute-authoring-plan call'],
    [result.metrics.readbackSeen, 'readback detection'],
    [result.metrics.summaryReadbackSeen, 'summary readback detection'],
    [result.metrics.residueClean, 'residue comparison'],
    [result.verdict === 'PASS', 'sample verdict'],
  ];
  const failure = assertions.find(([passed]) => !passed);
  if (failure) throw new Error(`Dry assertion failed: ${failure[1]}`);
  process.stdout.write(
    '[tail-kill-test] dry PASS: calls=3 authoring-calls=1 wall=12.34s readback-seen=yes residue=clean verdict=PASS\n',
  );
}

async function runLive(options) {
  if (!options.outDir) throw new Error('--out-dir is required outside --dry mode.');
  const expectedSessions = options.runs + 1;
  if (options.sessions.length !== expectedSessions) {
    throw new Error(
      `Expected ${expectedSessions} --session values (${options.runs} normal + 1 failure), got ${options.sessions.length}.`,
    );
  }
  const outDir = resolve(REPO_ROOT, options.outDir);
  ensureInsideRepo(outDir);
  await mkdir(outDir, { recursive: true });

  const results = [];
  for (let index = 0; index < expectedSessions; index += 1) {
    const failureRun = index === options.runs;
    const run = failureRun ? 'run-failure' : `run-${String(index + 1).padStart(2, '0')}`;
    const result = await executeRun({
      run,
      session: options.sessions[index],
      failureRun,
      outDir,
    });
    results.push(result);
    await writeFile(join(outDir, 'summary.md'), renderSummary(results), 'utf8');
    if (result.process.exitCode !== 0 || result.process.timedOut) break;
  }
  process.exitCode =
    results.length === expectedSessions && results.every((r) => r.verdict === 'PASS') ? 0 : 1;
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
