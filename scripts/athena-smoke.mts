/* Athena External-API smoke — run on a machine whose Desktop build carries the External
 * Client API (POSTs need monolith PR #59383).
 *
 *   npx tsx scripts/athena-smoke.mts
 *
 * Discovers the running Desktop via the ExternalApi discovery file, exercises every endpoint
 * the tableau-mcp connector uses, prints PASS/FAIL per leg, and saves the live /openapi.json
 * to athena-openapi.live.json (send that file back — it settles every remaining contract
 * question in one artifact). Read-only except one no-op apply: it re-applies the workbook XML
 * it just read (byte-identical round-trip).
 */
import fs from 'node:fs';
import { discoverInstances } from '../src/desktop/externalApi/discovery.js';
import { ExternalApiClient } from '../src/desktop/externalApi/externalApiClient.js';

const out = (ok: boolean, leg: string, detail = ''): void =>
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${leg.padEnd(28)} ${detail}`);
const errDetail = (e: unknown): string => JSON.stringify(e).slice(0, 160);

const instances = discoverInstances();
if (instances.length === 0) {
  console.error(
    'FAIL  discovery — no live discovery file found. Is Desktop running with the External API enabled?\n' +
      '      (503s from the API mean the enable setting is off; no file means the host never started.)',
  );
  process.exit(1);
}
const inst = instances[0];
out(true, 'discovery', `pid=${inst.pid} baseUrl=${inst.baseUrl}`);

const client = new ExternalApiClient(inst);

const health = await client.health();
out(
  health.isOk() && health.value.healthy,
  'GET /v0/health',
  health.isErr() ? errDetail(health.error) : '',
);

let xml: string | null = null;
const doc = await client.getWorkbookDocument();
if (doc.isOk()) {
  xml = doc.value.xml;
  out(
    xml.includes('<workbook'),
    'GET /v0/workbook/document',
    `${xml.length} bytes · appVersion=${doc.value.applicationVersion ?? '?'}`,
  );
} else {
  out(false, 'GET /v0/workbook/document', errDetail(doc.error));
}

if (xml) {
  const applied = await client.applyWorkbookDocument(xml); // byte-identical round-trip — a no-op apply
  out(
    applied.isOk(),
    'POST /v0/workbook/document',
    applied.isOk()
      ? `operation state=${String((applied.value as { state?: unknown }).state ?? '?')}`
      : errDetail(applied.error),
  );
}

// tabdoc:undo is a REAL registry command with no required params — harmless when there is
// nothing to undo, and it proves the {namespace, command, parameters} body shape end-to-end.
const op = await client.invokeCommand('tabdoc', 'undo', {});
out(
  op.isOk(),
  'POST /v0/app:invokeCommand',
  op.isOk()
    ? `state=${String((op.value as { state?: unknown }).state ?? '?')}`
    : errDetail(op.error),
);

let firstWorksheetId: string | undefined;
const worksheets = await client.listWorksheets();
if (worksheets.isOk()) {
  firstWorksheetId = worksheets.value.worksheets[0]?.id;
  out(true, 'GET /v0/workbook/worksheets', `${worksheets.value.worksheets.length} worksheets`);
} else {
  out(false, 'GET /v0/workbook/worksheets', errDetail(worksheets.error));
}

if (firstWorksheetId) {
  const summary = await client.getWorksheetSummaryData(firstWorksheetId, { maxRows: 5 });
  out(
    summary.isOk(),
    'GET .../worksheets/{id}/summaryData',
    summary.isOk()
      ? `${summary.value.rows?.length ?? 0} rows · ${summary.value.columns?.length ?? 0} columns`
      : errDetail(summary.error),
  );
}

const dashboards = await client.listDashboards();
out(
  dashboards.isOk(),
  'GET /v0/workbook/dashboards',
  dashboards.isOk()
    ? `${dashboards.value.dashboards.length} dashboards`
    : errDetail(dashboards.error),
);

const spec = await client.fetchOpenApi();
if (spec.isOk()) {
  fs.writeFileSync('athena-openapi.live.json', JSON.stringify(spec.value, null, 2));
  out(true, 'GET /openapi.json', 'saved to athena-openapi.live.json — PLEASE SEND THIS FILE BACK');
} else {
  out(false, 'GET /openapi.json', errDetail(spec.error));
}

console.log('\nDone. Any FAIL line + the openapi file is exactly the feedback we need.');
