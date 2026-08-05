/**
 * Standalone E2E driver (NOT a vitest suite) that drives the built server over stdio with the FULL
 * PAT env (the vitest mcpClient.getDefaultEnv() whitelist strips PAT_NAME/PAT_VALUE, which is why
 * the vitest e2e suites fail to even start the child). Run with:
 *
 *   set -a && . <env.list> && set +a && ADMIN_TOOLS_ENABLED=true npx tsx tests/e2e/_mutationGuardDriver.ts
 *
 * Verifies the mutation-guard contract against the LIVE site:
 *   1. forged/precomputed confirm  -> rejected with preview-not-run
 *   2. preview                     -> establishes evidence (nonce / tag), no mutation
 *   3. preview -> confirm          -> mutates (only when a disposable target id is provided)
 *   4. authoritative audit JSON lines land on the child's stderr
 *   5. list-extract-refresh-tasks before/after count cross-check (ground-truth discipline)
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const PASS = '✓';
const FAIL = '✗';

const auditLines: Array<Record<string, unknown>> = [];
const allStderr: string[] = [];

function fullEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') env[k] = v;
  }
  env.TRANSPORT = 'stdio';
  env.ADMIN_TOOLS_ENABLED = 'true';
  env.PATH = process.env.PATH ?? '';
  return env;
}

function textOf(result: any): string {
  if (Array.isArray(result?.content) && result.content[0]?.type === 'text') {
    const raw = String(result.content[0].text);
    // Tool string results are JSON-encoded by constrainSuccessResult, so a plain message arrives as
    // a JSON string literal ("...\"nonce\"..."). Unwrap one layer if so, leaving JSON arrays/objects
    // (list tools) intact for the caller's JSON.parse.
    if (raw.startsWith('"') && raw.endsWith('"')) {
      try {
        return JSON.parse(raw) as string;
      } catch {
        /* fall through */
      }
    }
    return raw;
  }
  return JSON.stringify(result);
}

async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['build/index.js'],
    env: fullEnv(),
    stderr: 'pipe',
  });
  const client = new Client({ name: 'mutation-guard-driver', version: '1.0.0' });

  await client.connect(transport);
  const childStderr = transport.stderr;
  if (childStderr) {
    childStderr.on('data', (buf: Buffer) => {
      const s = buf.toString('utf8');
      allStderr.push(s);
      for (const line of s.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        try {
          const obj = JSON.parse(t);
          if (obj?.logger === 'audit' || obj?.message === 'mutation-audit') {
            auditLines.push(obj);
          }
        } catch {
          /* non-JSON operational line */
        }
      }
    });
  }

  const results: Array<{ name: string; ok: boolean; detail: string }> = [];
  const record = (name: string, ok: boolean, detail: string): void => {
    results.push({ name, ok, detail });

    console.log(`${ok ? PASS : FAIL} ${name} :: ${detail}`);
  };

  // Tool registration under ADMIN_TOOLS_ENABLED=true
  const toolNames = (await client.listTools()).tools.map((t) => t.name);
  for (const tn of [
    'delete-content',
    'update-cloud-extract-refresh-task',
    'list-extract-refresh-tasks',
  ]) {
    record(
      `registered:${tn}`,
      toolNames.includes(tn),
      toolNames.includes(tn) ? 'present' : 'MISSING',
    );
  }

  // --- Ground truth: before count ---
  const listBefore = await client.callTool({ name: 'list-extract-refresh-tasks', arguments: {} });
  let tasksBefore: Array<{ id: string }> = [];
  try {
    tasksBefore = JSON.parse(textOf(listBefore));
  } catch {
    /* ignore */
  }
  record(
    'list-extract-refresh-tasks:before',
    Array.isArray(tasksBefore) && tasksBefore.length > 0,
    `count=${tasksBefore.length}`,
  );

  // --- (1) Forged/precomputed confirm on delete-content (extract-refresh-task): never previewed -> reject ---
  // Use a real task id but jump straight to confirm with a fabricated token. The registry has no
  // nonce for it, so the guard must deny with preview-not-run.
  const targetTaskId = tasksBefore[0]?.id ?? '00000000-0000-4000-8000-000000000000';
  {
    const res = await client.callTool({
      name: 'delete-content',
      arguments: {
        resourceType: 'extract-refresh-task',
        resourceId: targetTaskId,
        confirm: true,
        confirmationToken: 'deadbeef-0000-4000-8000-forgedtoken00',
      },
    });
    const msg = textOf(res);
    const denied =
      res.isError === true &&
      /could not verify that a preview ran|preview-not-run|cannot be bypassed/i.test(msg);
    record(
      'forged-confirm-rejected (delete-content:extract-refresh-task)',
      denied,
      msg.slice(0, 160),
    );
  }

  // --- (1b) Forged confirm on delete-content (datasource, tag evidence): never tagged -> reject ---
  // Need a real datasource id; pull one from list-datasources.
  let dsId: string | undefined;
  try {
    const listDs = await client.callTool({
      name: 'list-datasources',
      arguments: { filter: '', pageSize: 1 },
    });
    const parsed = JSON.parse(textOf(listDs));
    dsId = Array.isArray(parsed) ? parsed[0]?.id : parsed?.datasources?.[0]?.id;
  } catch {
    /* try without args */
  }
  if (!dsId) {
    try {
      const listDs = await client.callTool({ name: 'list-datasources', arguments: {} });
      const parsed = JSON.parse(textOf(listDs));
      dsId = Array.isArray(parsed) ? parsed[0]?.id : parsed?.datasources?.[0]?.id;
    } catch {
      /* ignore */
    }
  }
  if (dsId) {
    const res = await client.callTool({
      name: 'delete-content',
      arguments: {
        resourceType: 'datasource',
        resourceId: dsId,
        confirm: true,
        tag: 'pending-deletion-driver-never-set',
      },
    });
    const msg = textOf(res);
    const denied =
      res.isError === true &&
      /could not verify that a preview ran|preview-not-run|cannot be bypassed/i.test(msg);
    record(
      'forged-confirm-rejected (delete-content:datasource tag-gate)',
      denied,
      msg.slice(0, 160),
    );
  } else {
    record(
      'forged-confirm-rejected (delete-content:datasource tag-gate)',
      false,
      'no datasource id available',
    );
  }

  // --- (2) Preview leg establishes evidence (non-destructive) for delete-content:extract-refresh-task ---
  let mintedNonce: string | undefined;
  {
    const res = await client.callTool({
      name: 'delete-content',
      arguments: { resourceType: 'extract-refresh-task', resourceId: targetTaskId },
    });
    const msg = textOf(res);
    const m = msg.match(/confirmationToken:\s*[“”]?([0-9a-fA-F-]{36})[“”]?/);
    mintedNonce = m?.[1];
    const ok = res.isError !== true && /Preview/i.test(msg) && !!mintedNonce;
    record(
      'preview-mints-nonce (delete-content:extract-refresh-task)',
      ok,
      `nonce=${mintedNonce ?? 'NONE'} | ${msg.slice(0, 220)}`,
    );
  }

  // --- (3) preview -> confirm MUST mutate. Destructive + irreversible against the live task list. ---
  // Only run when explicitly opted in with a disposable task LUID. Cross-check before/after counts.
  const disposableTaskId = process.env.DELETE_EXTRACT_REFRESH_TASK_E2E_ID;
  if (disposableTaskId) {
    const prev = await client.callTool({
      name: 'delete-content',
      arguments: { resourceType: 'extract-refresh-task', resourceId: disposableTaskId },
    });
    const prevMsg = textOf(prev);
    const nonce = prevMsg.match(/confirmationToken:\s*”([^”]+)”/)?.[1];
    const confirmRes = await client.callTool({
      name: 'delete-content',
      arguments: {
        resourceType: 'extract-refresh-task',
        resourceId: disposableTaskId,
        confirm: true,
        confirmationToken: nonce,
      },
    });
    const confirmMsg = textOf(confirmRes);
    const mutated = confirmRes.isError !== true && /successfully deleted/i.test(confirmMsg);
    // After-count cross-check
    const listAfter = await client.callTool({
      name: 'list-extract-refresh-tasks',
      arguments: {},
    });
    let tasksAfter: Array<{ id: string }> = [];
    try {
      tasksAfter = JSON.parse(textOf(listAfter));
    } catch {
      /* ignore */
    }
    const gone = !tasksAfter.some((t) => t.id === disposableTaskId);
    record(
      'preview->confirm MUTATES (delete-content:extract-refresh-task)',
      mutated && gone,
      `mutated=${mutated} after=${tasksAfter.length} gone=${gone}`,
    );
  } else {
    record(
      'preview->confirm MUTATES (delete-content:extract-refresh-task)',
      false,
      'SKIPPED: no DELETE_EXTRACT_REFRESH_TASK_E2E_ID disposable target provided',
    );
  }

  // --- (3b) Ground-truth: non-destructive legs must NOT have changed the task count ---
  const listMid = await client.callTool({ name: 'list-extract-refresh-tasks', arguments: {} });
  let tasksMid: Array<{ id: string }> = [];
  try {
    tasksMid = JSON.parse(textOf(listMid));
  } catch {
    /* ignore */
  }
  if (!disposableTaskId) {
    record(
      'count-unchanged-after-preview/forged-confirm',
      tasksMid.length === tasksBefore.length,
      `before=${tasksBefore.length} after=${tasksMid.length}`,
    );
  }

  // --- (4) Audit JSON lines landed ---
  // Give stderr a beat to flush.
  await new Promise((r) => setTimeout(r, 300));
  const denials = auditLines.filter((a) => (a as any).data?.result === 'denied');
  const allowed = auditLines.filter((a) => (a as any).data?.result === 'allowed');
  const hasPreviewNotRun = denials.some((a) => (a as any).data?.denyReason === 'preview-not-run');
  record(
    'audit-lines-landed',
    auditLines.length > 0,
    `total=${auditLines.length} allowed=${allowed.length} denied=${denials.length} preview-not-run=${hasPreviewNotRun}`,
  );
  record(
    'audit-includes-preview-not-run-denial',
    hasPreviewNotRun,
    hasPreviewNotRun ? 'present' : 'ABSENT',
  );
  // No raw nonce ever in audit detail.
  const leak = auditLines.some((a) =>
    /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/.test(
      JSON.stringify((a as any).data?.confirmationEvidence ?? {}),
    ),
  );
  record('audit-no-nonce-leak', !leak, leak ? 'NONCE LEAKED IN AUDIT' : 'clean');

  await client.close();

  console.log('\n=== AUDIT RECORDS ===');
  for (const a of auditLines) {
    console.log(JSON.stringify((a as any).data ?? a));
  }

  const failed = results.filter((r) => !r.ok);

  console.log(
    `\n=== SUMMARY: ${results.length - failed.length}/${results.length} checks passed ===`,
  );
  if (failed.length > 0) {
    console.log('FAILED CHECKS:');
    for (const f of failed) {
      console.log(`  ${FAIL} ${f.name} :: ${f.detail}`);
    }
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('DRIVER ERROR:', e);

  console.error('--- child stderr tail ---\n' + allStderr.join('').slice(-2000));
  process.exitCode = 2;
});
