import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs';
import path from 'path';
import { Err, Ok } from 'ts-results-es';

import { hashSchemaSummary, sha256Hex } from '../../../desktop/binder/memo.js';
import * as schemaSummaryModule from '../../../desktop/binder/schema-summary.js';
import * as getWorkbookXmlModule from '../../../desktop/commands/workbook/getWorkbookXml.js';
import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { TableauDesktopToolContext } from '../toolContext.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import {
  type DashboardBindingRecord,
  type DashboardHealthReport,
  getDashboardHealthCheckTool,
  runDashboardHealthCheck,
} from './dashboardHealthCheck.js';

// The live workbook read is mocked at the tool boundary. The schema summarizer is
// wrapped (real behavior, spyable) so the raw-hash short-circuit test can assert it
// is never even consulted when the workbook is byte-identical.
vi.mock('../../../desktop/commands/workbook/getWorkbookXml.js');
vi.mock('../../../desktop/binder/schema-summary.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../desktop/binder/schema-summary.js')>();
  return { ...actual, summarizeSchema: vi.fn(actual.summarizeSchema) };
});

const FIXTURE_DIR = path.join(
  process.cwd(),
  'src',
  'tools',
  'desktop',
  'health',
  '__fixtures__',
  'health-check',
);

const FIXTURE_NAMES = [
  'zone-dead-sheet',
  'sheet-deleted',
  'field-removed',
  'field-retyped',
  'orphan-zone',
  'datasource-swap',
  'unchanged',
  'benign-noise',
] as const;

function loadFixture(name: string): {
  baseline: string;
  drifted: string;
  manifest: DashboardBindingRecord;
} {
  const read = (file: string): string => fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8');
  const baseline = read(`${name}-baseline.xml`);
  const drifted = read(`${name}-drifted.xml`);
  const manifest = JSON.parse(read(`${name}-manifest.json`)) as DashboardBindingRecord;
  // "Captured at bind time": hashes derived from the BASELINE exactly as a bind
  // would have recorded them, using the same two memo.ts primitives the tool reuses.
  const baselineSchemaHash = hashSchemaSummary(schemaSummaryModule.summarizeSchema(baseline));
  if (manifest.workbookHashAtBind === '') manifest.workbookHashAtBind = sha256Hex(baseline);
  for (const sheet of manifest.sheets) {
    if (sheet.schemaHash === '') sheet.schemaHash = baselineSchemaHash;
  }
  return { baseline, drifted, manifest };
}

function checkFixture(name: string): DashboardHealthReport {
  const { drifted, manifest } = loadFixture(name);
  return runDashboardHealthCheck({ manifest, workbookXml: drifted });
}

describe('runDashboardHealthCheck (fixtures)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('zone-dead-sheet: flags D1 breaking with the rename candidate named in the repair prose', () => {
    const report = checkFixture('zone-dead-sheet');

    expect(report.dashboardName).toBe('Health Dash');
    expect(report.workbookUnchanged).toBe(false);
    expect(report.dashboardFound).toBe(true);
    expect(report.findings).toHaveLength(1);
    const finding = report.findings[0];
    expect(finding.driftClass).toBe('D1_zone_dead_sheet');
    expect(finding.severity).toBe('breaking');
    expect(finding.sheet).toBe('Sales Trend');
    expect(finding.evidence.recordedAt).toBe('2026-07-01T00:00:00.000Z');
    expect(finding.evidence.recorded).toEqual({
      worksheetTitle: 'Sales Trend',
      templateName: 'line-basic',
    });
    expect(finding.evidence.current).toBeNull();
    expect(finding.wouldBeRepair.primitive).toBe('zone-surgery');
    expect(finding.wouldBeRepair.confidence).toBe('judgment-needed');
    expect(finding.wouldBeRepair.description).toContain('Sales Trend v2');
  });

  it('sheet-deleted: flags D2 breaking with the SAME evidence shape as D1', () => {
    const report = checkFixture('sheet-deleted');

    expect(report.workbookUnchanged).toBe(false);
    expect(report.findings).toHaveLength(1);
    const finding = report.findings[0];
    expect(finding.driftClass).toBe('D2_sheet_deleted');
    expect(finding.severity).toBe('breaking');
    expect(finding.sheet).toBe('Sales Trend');
    // Renamed and deleted are structurally identical from the dashboard's side:
    // both prove "the name a zone points at doesn't resolve" with the same shape.
    expect(finding.evidence.recorded).toEqual({
      worksheetTitle: 'Sales Trend',
      templateName: 'line-basic',
    });
    expect(finding.evidence.current).toBeNull();
    expect(finding.wouldBeRepair.primitive).toBe('none-available');
    expect(finding.wouldBeRepair.confidence).toBe('judgment-needed');
  });

  it('field-removed: flags D3 breaking, scoped ONLY to the drifted sheet (multi-sheet dashboard)', () => {
    const report = checkFixture('field-removed');

    // Two sheets in the manifest; only "Sales Trend" references the removed field.
    expect(report.findings).toHaveLength(1);
    const finding = report.findings[0];
    expect(finding.driftClass).toBe('D3_field_removed');
    expect(finding.severity).toBe('breaking');
    expect(finding.sheet).toBe('Sales Trend');
    expect(finding.evidence.recorded).toEqual({
      slot: 'y',
      column_ref: '[Superstore Lite].[sum:Sales:qk]',
    });
    expect(finding.evidence.current).toBeNull();
    expect(finding.wouldBeRepair.primitive).toBe('rebind');
    expect(finding.wouldBeRepair.confidence).toBe('judgment-needed');
    expect(finding.wouldBeRepair.description).toContain("slot 'y'");
  });

  it('field-retyped: flags D4 ambiguous with the current (retyped) field as evidence', () => {
    const report = checkFixture('field-retyped');

    expect(report.findings).toHaveLength(1);
    const finding = report.findings[0];
    expect(finding.driftClass).toBe('D4_field_retyped');
    expect(finding.severity).toBe('ambiguous');
    expect(finding.sheet).toBe('Sales Trend');
    expect(finding.evidence.recorded).toEqual({
      slot: 'x',
      column_ref: '[Superstore Lite].[none:Order Stamp:nk]',
    });
    expect(finding.evidence.current).toEqual({
      name: 'Order Stamp',
      column_ref: '[Superstore Lite].[none:Order Stamp:qk]',
      datatype: 'date',
      role: 'dimension',
      type: 'quantitative',
    });
    expect(finding.wouldBeRepair.primitive).toBe('reinject-from-template');
    expect(finding.wouldBeRepair.confidence).toBe('judgment-needed');
  });

  it('orphan-zone: flags D7 breaking for a zone whose sheet never existed', () => {
    const report = checkFixture('orphan-zone');

    expect(report.findings).toHaveLength(1);
    const finding = report.findings[0];
    expect(finding.driftClass).toBe('D7_orphan_zone');
    expect(finding.severity).toBe('breaking');
    expect(finding.sheet).toBe('Ghost Sheet');
    expect(finding.evidence.recorded).toBeNull();
    expect(finding.evidence.current).toEqual({ zoneName: 'Ghost Sheet' });
    expect(finding.wouldBeRepair.primitive).toBe('zone-surgery');
    expect(finding.wouldBeRepair.confidence).toBe('safe-by-construction');
  });

  it('datasource-swap: flags exactly one D10 ambiguous when the primary datasource pick flips', () => {
    const report = checkFixture('datasource-swap');

    expect(report.findings).toHaveLength(1);
    const finding = report.findings[0];
    expect(finding.driftClass).toBe('D10_primary_datasource_changed');
    expect(finding.severity).toBe('ambiguous');
    expect(finding.sheet).toBeUndefined();
    expect(finding.evidence.recorded).toEqual({ primaryDatasource: 'Superstore Lite' });
    expect(finding.evidence.current).toEqual({ primaryDatasource: 'Mega Warehouse' });
    expect(finding.wouldBeRepair.primitive).toBe('none-available');
  });

  it('unchanged: short-circuits on the raw-XML hash and never consults the schema summarizer', () => {
    const { drifted, manifest } = loadFixture('unchanged');
    vi.mocked(schemaSummaryModule.summarizeSchema).mockClear();

    const report = runDashboardHealthCheck({ manifest, workbookXml: drifted });

    expect(report.workbookUnchanged).toBe(true);
    expect(report.findings).toEqual([]);
    expect(schemaSummaryModule.summarizeSchema).not.toHaveBeenCalled();
  });

  it('benign-noise: byte-level noise defeats the raw hash but the STRUCTURAL diff stays clean', () => {
    const { drifted, manifest } = loadFixture('benign-noise');
    vi.mocked(schemaSummaryModule.summarizeSchema).mockClear();

    const report = runDashboardHealthCheck({ manifest, workbookXml: drifted });

    // Raw hash WILL differ (attribute reorder is a byte change) — proving the
    // schema-content diff, not raw-hash inequality, is the drift decision-maker.
    expect(report.workbookUnchanged).toBe(false);
    expect(report.findings).toEqual([]);
    expect(schemaSummaryModule.summarizeSchema).toHaveBeenCalled();
  });

  it('every report unconditionally discloses D9 as undetectable', () => {
    for (const name of FIXTURE_NAMES) {
      const report = checkFixture(name);
      expect(report.undetectable).toHaveLength(1);
      expect(report.undetectable[0].driftClass).toBe('D9_render_error');
      expect(report.undetectable[0].reason).toContain('not detectable');
    }
  });
});

describe('dashboardHealthCheck read-only proof (import audit)', () => {
  const moduleSource = fs.readFileSync(
    path.join(process.cwd(), 'src', 'tools', 'desktop', 'health', 'dashboardHealthCheck.ts'),
    'utf8',
  );

  it('imports ONLY from the read-side allowlist — any new import must be re-justified here', () => {
    const allowed = new Set([
      '@modelcontextprotocol/sdk/types.js',
      'ts-results-es',
      'zod',
      '../../../desktop/binder/memo.js',
      '../../../desktop/binder/schema-summary.js',
      '../../../desktop/commands/workbook/getWorkbookXml.js',
      '../../../errors/mcpToolError.js',
      '../../../server.desktop.js',
      '../tool.js',
    ]);
    // Catch every module-specifier form: `from '…'`, bare `import '…'`,
    // dynamic `import('…')`, and `require('…')` — a side-effect import is just
    // as capable of smuggling in a mutating path as a named one.
    const specifiers = [
      ...moduleSource.matchAll(/(?:from\s+|import\s*\(?\s*|require\s*\(\s*)'([^']+)'/g),
    ].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(
        allowed.has(specifier),
        `dashboardHealthCheck.ts imports '${specifier}', which is outside the read-side allowlist. ` +
          'This tool is flag-only by construction: it must never gain a mutating code path.',
      ).toBe(true);
    }
  });

  it('never references a bind/inject/apply/dispatch identifier anywhere in the module', () => {
    expect(moduleSource).not.toMatch(
      /bindTemplate|loadWorkbookXml|injectTemplate|buildInjectedWorkbookXml|executeCommand|applyWorkbook|applyWorksheet|applyDashboard|writeCachedXml|writeFileSync/,
    );
  });
});

describe('dashboardHealthCheckTool (wiring)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getDashboardHealthCheckTool(new DesktopMcpServer());
    expect(tool.name).toBe('dashboard-health-check');
    expect(tool.description).toContain('READ-ONLY drift detector');
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      manifest: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({
      title: 'Dashboard Health Check (Flag-Only)',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
  });

  it('reads the live workbook once and returns the health report as JSON', async () => {
    const { drifted, manifest } = loadFixture('field-removed');
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(drifted));

    const result = await getToolResult({ manifest });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const report = JSON.parse(result.content[0].text) as DashboardHealthReport;
    expect(report.dashboardName).toBe('Health Dash');
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].driftClass).toBe('D3_field_removed');
    expect(report.undetectable[0].driftClass).toBe('D9_render_error');
    expect(getWorkbookXmlModule.getWorkbookXml).toHaveBeenCalledTimes(1);
  });

  it('funnels a workbook-read failure through the McpToolError path (isError true)', async () => {
    const { manifest } = loadFixture('unchanged');
    const error = { type: 'unknown' as const, error: new Error('Network error') };
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Err(error));

    const result = await getToolResult({ manifest });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new DesktopCommandExecutionError(error).message);
  });
});

async function getToolResult({
  session = '12345',
  manifest,
  mockExecutor = vi.fn().mockResolvedValue({}),
}: {
  session?: string;
  manifest: DashboardBindingRecord;
  mockExecutor?: TableauDesktopToolContext['getExecutor'];
}): Promise<CallToolResult> {
  const tool = getDashboardHealthCheckTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: mockExecutor,
  };
  return await callback({ session, manifest }, extra);
}
