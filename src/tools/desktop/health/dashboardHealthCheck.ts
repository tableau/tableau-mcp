// dashboard-health-check — READ-ONLY drift detector for previously-bound dashboards
// (W60 self-healing MVP, flag-only mode).
//
// Diffs a caller-held binding manifest (what a prior bind believed to be true)
// against the CURRENT live workbook XML and reports per-finding drift classes:
//   D1  zone points at a dead (likely renamed) worksheet     — breaking
//   D2  referenced worksheet deleted                          — breaking
//   D3  field removed from the datasource                     — breaking
//   D4  field retyped upstream (same name, new type/role)     — ambiguous
//   D7  orphan zone (references a sheet that never existed)   — breaking
//   D10 primary datasource changed (heuristic signal)         — ambiguous
// D9 (live render breakage) is structurally undetectable from XML and is
// disclosed in every report's `undetectable` array — never silently omitted.
//
// FLAG-ONLY HARD LINE: `wouldBeRepair` is prose plus a primitive name, never an
// executable action. This module imports ONLY read-side functions; there is no
// parameter that unlocks a write. The colocated test pins the import list so a
// future edit that pulls in a mutating path fails CI.
//
// Hash reuse (NOT a third mechanism — see w60-self-healing-mvp-spec.md §2):
//   1. raw workbook-XML sha256 (`sha256Hex`, memo.ts — same digest SchemaCache
//      keys by) as the cheap byte-identical short-circuit, and
//   2. the schema-summary content hash (`hashSchemaSummary`, memo.ts) as the
//      per-sheet "schema provably identical" skip; when it differs, a structural
//      field-by-field diff classifies D3 vs D4 vs benign.

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { hashSchemaSummary, sha256Hex } from '../../../desktop/binder/memo.js';
import {
  bareName,
  type SchemaField,
  summarizeSchema,
} from '../../../desktop/binder/schema-summary.js';
import { getWorkbookXml } from '../../../desktop/commands/workbook/getWorkbookXml.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

// ── Binding manifest (input) ─────────────────────────────────────────────────

const boundSheetSchema = z.object({
  title: z.string().describe('Sheet.'),
  templateName: z.string().describe('Template.'),
  fieldMapping: z.record(z.string()).describe('Mapping.'),
  schemaHash: z.string().describe('Schema.'),
  primaryDatasource: z.string().describe('Source.'),
});

const bindingRecordSchema = z.object({
  dashboardName: z.string().describe('Dashboard.'),
  sheets: z.array(boundSheetSchema).describe('Sheets.'),
  workbookHashAtBind: z.string().describe('Workbook.'),
  recordedAt: z.string().describe('Time.'),
});

export type DashboardBoundSheet = z.infer<typeof boundSheetSchema>;
export type DashboardBindingRecord = z.infer<typeof bindingRecordSchema>;

// ── Health report (output) ───────────────────────────────────────────────────

export type DriftClass =
  | 'D1_zone_dead_sheet'
  | 'D2_sheet_deleted'
  | 'D3_field_removed'
  | 'D4_field_retyped'
  // Spec'd report vocabulary; the MVP classifier never emits D5 (name-stability
  // heuristic unresolved — spec §1 D5 caveat).
  | 'D5_field_renamed_suspected'
  | 'D7_orphan_zone'
  | 'D10_primary_datasource_changed';

export type DriftSeverity = 'breaking' | 'ambiguous' | 'benign';

export interface WouldBeRepair {
  primitive: 'rebind' | 'zone-surgery' | 'reinject-from-template' | 'none-available';
  description: string;
  confidence: 'safe-by-construction' | 'judgment-needed';
}

export interface DriftFinding {
  driftClass: DriftClass;
  severity: DriftSeverity;
  sheet?: string;
  evidence: {
    recordedAt: string;
    recorded: unknown;
    current: unknown | null;
  };
  wouldBeRepair: WouldBeRepair;
}

export interface DashboardHealthReport {
  dashboardName: string;
  checkedAt: string;
  /** Raw-XML hash short-circuit result — true means nothing changed at all. */
  workbookUnchanged: boolean;
  /** False when the dashboard element itself is gone from the workbook (renamed/deleted dashboard). */
  dashboardFound: boolean;
  findings: DriftFinding[];
  /** Honesty disclosure — D9 is out of reach from XML, in every report, unconditionally. */
  undetectable: Array<{ driftClass: 'D9_render_error'; reason: string }>;
}

const D9_REASON =
  'Live render/visual breakage is not detectable from workbook structure alone; the Desktop Agent ' +
  'API exposes no render-diagnostics or screenshot-diff surface today.';

function makeUndetectable(): DashboardHealthReport['undetectable'] {
  return [{ driftClass: 'D9_render_error', reason: D9_REASON }];
}

// ── XML name helpers (duplicated tiny escapes — the proven quote-agnostic zone
// regex lives in an edit-frozen module this tool must not import from) ────────

function escapeXmlName(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unescapeXmlName(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Worksheet names, scoped to the <worksheets> block when present. Unescaped. */
function extractWorksheetNames(workbookXml: string): Set<string> {
  const scoped = /<worksheets\b[^>]*>([\s\S]*?)<\/worksheets>/.exec(workbookXml);
  const scope = scoped ? scoped[1] : workbookXml;
  const out = new Set<string>();
  const re = /<worksheet\b[^>]*?\bname=(['"])([\s\S]*?)\1/g;
  for (let m = re.exec(scope); m !== null; m = re.exec(scope)) {
    out.add(unescapeXmlName(m[2]));
  }
  return out;
}

/** The `<dashboard name='X'>…</dashboard>` section, quote-agnostic and attr-order tolerant. */
function extractDashboardSection(workbookXml: string, dashboardName: string): string | null {
  const nameAttr = escapeRegExp(escapeXmlName(dashboardName));
  const re = new RegExp(
    `<dashboard\\b(?=[^>]*\\bname=(['"])${nameAttr}\\1)[^>]*>[\\s\\S]*?</dashboard>`,
  );
  const m = re.exec(workbookXml);
  return m ? m[0] : null;
}

/** Named zones within a dashboard section (layout containers carry no name). Unescaped. */
function extractZoneNames(dashboardSection: string): Set<string> {
  const out = new Set<string>();
  const re = /<zone\b[^>]*?\bname=(['"])([\s\S]*?)\1/g;
  for (let m = re.exec(dashboardSection); m !== null; m = re.exec(dashboardSection)) {
    const name = unescapeXmlName(m[2]);
    if (name.length > 0) out.add(name);
  }
  return out;
}

/** Split "[Datasource].[prefix:Bare Name:suffix]" into its lookup parts. */
function parseColumnRef(ref: string): { datasource: string; bare: string } | null {
  const m = /^\[(.+)\]\.\[(.+)\]$/.exec(ref);
  if (!m) return null;
  const parts = m[2].split(':');
  const bare = parts.length >= 3 ? parts.slice(1, -1).join(':') : m[2];
  return { datasource: m[1], bare };
}

function projectField(field: SchemaField): Record<string, string> {
  return {
    name: field.name,
    column_ref: field.column_ref,
    datatype: field.datatype,
    role: field.role,
    type: field.type,
  };
}

// ── Pure detection core (exported for the fixture tests) ─────────────────────

export function runDashboardHealthCheck({
  manifest,
  workbookXml,
}: {
  manifest: DashboardBindingRecord;
  workbookXml: string;
}): DashboardHealthReport {
  const report: DashboardHealthReport = {
    dashboardName: manifest.dashboardName,
    checkedAt: new Date().toISOString(),
    workbookUnchanged: sha256Hex(workbookXml) === manifest.workbookHashAtBind,
    dashboardFound: true,
    findings: [],
    undetectable: makeUndetectable(),
  };

  // Short-circuit: byte-identical workbook ⇒ the manifest's world still holds.
  if (report.workbookUnchanged) {
    return report;
  }

  // ── Structural pass (D1 / D2 / D7) ────────────────────────────────────────
  const worksheetNames = extractWorksheetNames(workbookXml);
  const dashboardSection = extractDashboardSection(workbookXml, manifest.dashboardName);
  report.dashboardFound = dashboardSection !== null;
  const zoneNames = dashboardSection ? extractZoneNames(dashboardSection) : new Set<string>();
  const manifestTitles = new Set(manifest.sheets.map((s) => s.title));

  // Worksheets no zone points at and the manifest never knew: rename candidates.
  const renameCandidates = [...worksheetNames].filter(
    (w) => !zoneNames.has(w) && !manifestTitles.has(w),
  );

  for (const sheet of manifest.sheets) {
    if (worksheetNames.has(sheet.title)) continue;
    if (renameCandidates.length > 0) {
      report.findings.push({
        driftClass: 'D1_zone_dead_sheet',
        severity: 'breaking',
        sheet: sheet.title,
        evidence: {
          recordedAt: manifest.recordedAt,
          recorded: { worksheetTitle: sheet.title, templateName: sheet.templateName },
          current: null,
        },
        wouldBeRepair: {
          primitive: 'zone-surgery',
          description:
            "Would rewrite the dashboard zone's name attribute to the renamed worksheet " +
            `if the rename could be proven (candidates: ${renameCandidates.join(', ')}).`,
          confidence: 'judgment-needed',
        },
      });
    } else {
      report.findings.push({
        driftClass: 'D2_sheet_deleted',
        severity: 'breaking',
        sheet: sheet.title,
        evidence: {
          recordedAt: manifest.recordedAt,
          recorded: { worksheetTitle: sheet.title, templateName: sheet.templateName },
          current: null,
        },
        wouldBeRepair: {
          primitive: 'none-available',
          description:
            'Re-authoring the deleted worksheet requires a full rebind with the original ask, ' +
            'which this binding manifest does not record.',
          confidence: 'judgment-needed',
        },
      });
    }
  }

  for (const zoneName of zoneNames) {
    if (worksheetNames.has(zoneName) || manifestTitles.has(zoneName)) continue;
    report.findings.push({
      driftClass: 'D7_orphan_zone',
      severity: 'breaking',
      sheet: zoneName,
      evidence: {
        recordedAt: manifest.recordedAt,
        recorded: null,
        current: { zoneName },
      },
      wouldBeRepair: {
        primitive: 'zone-surgery',
        description:
          `Would delete the orphan zone '${zoneName}' (it references nothing); blocked today: ` +
          'no zone-delete primitive exists in the tool surface.',
        confidence: 'safe-by-construction',
      },
    });
  }

  // ── Schema pass (D3 / D4 / D10) ───────────────────────────────────────────
  const freshSummary = summarizeSchema(workbookXml);
  const freshSchemaHash = hashSchemaSummary(freshSummary);
  const byColumnRef = new Map(freshSummary.fields.map((f) => [f.column_ref, f]));

  for (const sheet of manifest.sheets) {
    // Schema-summary content hash unchanged ⇒ D3/D4/D10 provably impossible for
    // this sheet, whatever byte-level noise the raw XML picked up.
    if (sheet.schemaHash === freshSchemaHash) continue;

    for (const [slot, recordedRef] of Object.entries(sheet.fieldMapping).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      if (byColumnRef.has(recordedRef)) continue;
      const parsed = parseColumnRef(recordedRef);
      const retypedCandidates = parsed
        ? freshSummary.fields.filter(
            (f) => f.datasource === parsed.datasource && bareName(f.columnName) === parsed.bare,
          )
        : [];
      if (retypedCandidates.length > 0) {
        report.findings.push({
          driftClass: 'D4_field_retyped',
          severity: 'ambiguous',
          sheet: sheet.title,
          evidence: {
            recordedAt: manifest.recordedAt,
            recorded: { slot, column_ref: recordedRef },
            current: projectField(retypedCandidates[0]),
          },
          wouldBeRepair: {
            primitive: 'reinject-from-template',
            description:
              `Would re-inject template '${sheet.templateName}' with the same field and let ` +
              'Desktop re-resolve the new type, if the template slot accepts it.',
            confidence: 'judgment-needed',
          },
        });
      } else {
        report.findings.push({
          driftClass: 'D3_field_removed',
          severity: 'breaking',
          sheet: sheet.title,
          evidence: {
            recordedAt: manifest.recordedAt,
            recorded: { slot, column_ref: recordedRef },
            current: null,
          },
          wouldBeRepair: {
            primitive: 'rebind',
            description:
              `Would re-run the binder for template '${sheet.templateName}' against the current ` +
              `schema to choose a replacement field for slot '${slot}'.`,
            confidence: 'judgment-needed',
          },
        });
      }
    }
  }

  const changedPrimaries = [
    ...new Set(
      manifest.sheets
        .filter(
          (s) =>
            s.schemaHash !== freshSchemaHash && s.primaryDatasource !== freshSummary.datasource,
        )
        .map((s) => s.primaryDatasource),
    ),
  ];
  for (const recordedPrimary of changedPrimaries) {
    report.findings.push({
      driftClass: 'D10_primary_datasource_changed',
      severity: 'ambiguous',
      evidence: {
        recordedAt: manifest.recordedAt,
        recorded: { primaryDatasource: recordedPrimary },
        current: { primaryDatasource: freshSummary.datasource },
      },
      wouldBeRepair: {
        primitive: 'none-available',
        description:
          'Not a repair target — signals the health check should be re-scoped per datasource.',
        confidence: 'judgment-needed',
      },
    });
  }

  return report;
}

// ── Tool registration ────────────────────────────────────────────────────────

const paramsSchema = {
  session: z.string().optional().describe('Session.'),
  manifest: bindingRecordSchema.describe('Bind record.'),
};

const title = 'Dashboard Health Check (Flag-Only)';
export const getDashboardHealthCheckTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const dashboardHealthCheckTool = new DesktopTool({
    server,
    name: 'dashboard-health-check',
    title,
    description: 'Read-only drift check; no repairs; D9 undetectable.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    callback: async ({ session, manifest }, extra): Promise<CallToolResult> => {
      return await dashboardHealthCheckTool.logAndExecute<DashboardHealthReport>({
        extra,
        args: { session, manifest },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;
          const executor = await extra.getExecutor(resolvedSession);
          const xmlResult = await getWorkbookXml({ executor, signal: extra.signal });
          if (xmlResult.isErr()) {
            return new DesktopCommandExecutionError(xmlResult.error).toErr();
          }
          return new Ok(runDashboardHealthCheck({ manifest, workbookXml: xmlResult.value }));
        },
      });
    },
  });

  return dashboardHealthCheckTool;
};
