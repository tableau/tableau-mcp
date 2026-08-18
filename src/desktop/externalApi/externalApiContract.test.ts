import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  apiRootSchema,
  appInfoSchema,
  dashboardItemSchema,
  dashboardListSchema,
  datasourceItemSchema,
  datasourceListSchema,
  EXTERNAL_API_ROUTES,
  healthSchema,
  imageResultSchema,
  logicalTableItemSchema,
  logicalTableListSchema,
  operationEnvelopeSchema,
  operationErrorSchema,
  operationWarningSchema,
  PROBLEM_CODES,
  problemResponseSchema,
  protectedResourceMetadataSchema,
  siteDatasourceItemSchema,
  siteDatasourceListSchema,
  siteSchema,
  siteWorkbookItemSchema,
  siteWorkbookListSchema,
  storyboardItemSchema,
  storyboardListSchema,
  summaryDataSchema,
  validationResultSchema,
  windowInfoSchema,
  workbookInventorySchema,
  worksheetItemSchema,
  worksheetListSchema,
} from './types.js';

/**
 * Contract-intake harness: validates OUR zod schemas against the captured
 * `/openapi.json` artifact. When the API owner ships a new spec, overwrite the
 * fixture with it and rerun — every drift (new field, changed requiredness, enum
 * growth, route add/remove) surfaces as a red/green diff instead of a manual reread.
 *
 * Fixture provenance: live Desktop `/openapi.json`, `info.version` 0.2.6 — a build
 * adding the `app:openFile`, `workbook:save`, and `worksheets:new`/`dashboards:new`/
 * `storyboards:new` routes, the `operation-not-found`/`unsupported-file-type`/
 * `file-not-found` problem codes, and formalized `required` arrays across the read
 * schemas, on top of the 0.2.5 surface (`:pauseAutoUpdates`/`:resumeAutoUpdates`,
 * `isActiveSheet`/`isAutoUpdatesPaused`). No hand-edits.
 */

type SpecSchema = {
  required?: Array<string>;
  properties?: Record<string, { 'x-extensible-enum'?: Array<string> }>;
};

const spec = JSON.parse(
  readFileSync(path.join(__dirname, '__fixtures__', 'externalClientApi-openapi.json'), 'utf-8'),
) as {
  paths: Record<string, unknown>;
  components: { schemas: Record<string, SpecSchema> };
};

const specSchema = (name: string): SpecSchema => {
  const schema = spec.components.schemas[name];
  expect(schema, `spec component schema ${name} missing`).toBeDefined();
  return schema;
};

const declaredKeys = (schema: z.AnyZodObject): Array<string> => Object.keys(schema.shape);

const requiredKeys = (schema: z.AnyZodObject): Array<string> =>
  declaredKeys(schema).filter((key) => !(schema.shape[key] as z.ZodTypeAny).isOptional());

// Read schemas parse fail-open: each keeps spec-`required` fields optional so an older Desktop
// build that omits a field a newer spec marks required still parses. Each entry is the set of
// spec-required keys the matching zod schema leaves optional (spec-required minus zod-required).
const KNOWN_READ_REQUIREDNESS_EXCEPTIONS: Readonly<Record<string, readonly string[]>> = {
  ApiRoot: ['apiVersion', 'applicationVersion', 'links'],
  AppInfo: [
    'applicationVersion',
    'edition',
    'build',
    'os',
    'locale',
    'repositoryLocation',
    'logLocation',
  ],
  DashboardItem: ['isActiveSheet', 'isAutoUpdatesPaused', 'containedSheets'],
  DashboardList: ['dashboards'],
  DatasourceItem: ['id', 'luid', 'name', 'caption'],
  DatasourceList: ['datasources'],
  Health: ['status'],
  ProtectedResourceMetadata: ['authorization_servers', 'bearer_methods_supported'],
  Site: ['siteId', 'authenticatedUserId'],
  SiteWorkbookItem: ['id', 'luid', 'name', 'project'],
  SiteWorkbookList: ['workbooks'],
  WorksheetItem: ['isActiveSheet', 'isAutoUpdatesPaused', 'datasources'],
  WorksheetList: ['worksheets'],
  StoryboardItem: ['isActiveSheet'],
  StoryboardList: ['storyboards'],
  WorkbookInventory: ['location', 'worksheets', 'dashboards', 'storyboards'],
  SiteDatasourceItem: ['id', 'luid', 'name', 'caption', 'project'],
  SiteDatasourceList: ['datasources'],
  SummaryData: ['columns', 'rows'],
  LogicalTableItem: ['id', 'caption'],
  LogicalTableList: ['tables'],
  ValidationResult: ['validationIssues'],
  ImageExport: ['width', 'height'],
};

describe('external client API contract (captured openapi fixture)', () => {
  describe('Operation ↔ operationEnvelopeSchema', () => {
    const operation = specSchema('Operation');

    it('declares every spec property', () => {
      const missing = Object.keys(operation.properties ?? {}).filter(
        (key) => !declaredKeys(operationEnvelopeSchema).includes(key),
      );
      expect(missing).toEqual([]);
    });

    it('declares no property the spec does not', () => {
      const extras = declaredKeys(operationEnvelopeSchema).filter(
        (key) => !(key in (operation.properties ?? {})),
      );
      expect(extras).toEqual([]);
    });

    // The envelope schema is deliberately looser than the spec's required set (it parses fail-open —
    // see operationEnvelopeSchema), so require only that it never demands a field the spec does not.
    it('requires no field the spec does not mark required', () => {
      const specRequired = new Set(operation.required ?? []);
      const strayRequired = requiredKeys(operationEnvelopeSchema).filter(
        (key) => !specRequired.has(key),
      );
      expect(strayRequired).toEqual([]);
    });
  });

  describe('OperationError / OperationWarning', () => {
    it.each([
      ['OperationError', operationErrorSchema],
      ['OperationWarning', operationWarningSchema],
    ] as const)('%s: properties and required set match', (name, schema) => {
      const component = specSchema(name);
      expect(declaredKeys(schema).sort()).toEqual(Object.keys(component.properties ?? {}).sort());
      expect(requiredKeys(schema).sort()).toEqual([...(component.required ?? [])].sort());
    });
  });

  describe('data-first read schemas', () => {
    it.each([
      ['ApiRoot', apiRootSchema],
      ['AppInfo', appInfoSchema],
      ['DashboardItem', dashboardItemSchema],
      ['DashboardList', dashboardListSchema],
      ['DatasourceItem', datasourceItemSchema],
      ['DatasourceList', datasourceListSchema],
      ['Health', healthSchema],
      ['ProtectedResourceMetadata', protectedResourceMetadataSchema],
      ['Site', siteSchema],
      ['SiteWorkbookItem', siteWorkbookItemSchema],
      ['SiteWorkbookList', siteWorkbookListSchema],
      ['WorksheetItem', worksheetItemSchema],
      ['WorksheetList', worksheetListSchema],
      ['StoryboardItem', storyboardItemSchema],
      ['StoryboardList', storyboardListSchema],
      ['WorkbookInventory', workbookInventorySchema],
      ['SiteDatasourceItem', siteDatasourceItemSchema],
      ['SiteDatasourceList', siteDatasourceListSchema],
      ['SummaryData', summaryDataSchema],
      ['LogicalTableItem', logicalTableItemSchema],
      ['LogicalTableList', logicalTableListSchema],
      ['WindowInfo', windowInfoSchema],
      ['ValidationResult', validationResultSchema],
      ['ImageExport', imageResultSchema],
    ] as const)(
      '%s: properties and required set match except known version deltas',
      (name, schema) => {
        const component = specSchema(name);
        expect(declaredKeys(schema).sort()).toEqual(Object.keys(component.properties ?? {}).sort());
        const exceptions = new Set(KNOWN_READ_REQUIREDNESS_EXCEPTIONS[name] ?? []);
        expect(requiredKeys(schema).sort()).toEqual(
          [...(component.required ?? [])].filter((key) => !exceptions.has(key)).sort(),
        );
      },
    );

    it('pins the complete 0.2.6 requiredness exception set', () => {
      expect(KNOWN_READ_REQUIREDNESS_EXCEPTIONS).toEqual({
        ApiRoot: ['apiVersion', 'applicationVersion', 'links'],
        AppInfo: [
          'applicationVersion',
          'edition',
          'build',
          'os',
          'locale',
          'repositoryLocation',
          'logLocation',
        ],
        DashboardItem: ['isActiveSheet', 'isAutoUpdatesPaused', 'containedSheets'],
        DashboardList: ['dashboards'],
        DatasourceItem: ['id', 'luid', 'name', 'caption'],
        DatasourceList: ['datasources'],
        Health: ['status'],
        ProtectedResourceMetadata: ['authorization_servers', 'bearer_methods_supported'],
        Site: ['siteId', 'authenticatedUserId'],
        SiteWorkbookItem: ['id', 'luid', 'name', 'project'],
        SiteWorkbookList: ['workbooks'],
        WorksheetItem: ['isActiveSheet', 'isAutoUpdatesPaused', 'datasources'],
        WorksheetList: ['worksheets'],
        StoryboardItem: ['isActiveSheet'],
        StoryboardList: ['storyboards'],
        WorkbookInventory: ['location', 'worksheets', 'dashboards', 'storyboards'],
        SiteDatasourceItem: ['id', 'luid', 'name', 'caption', 'project'],
        SiteDatasourceList: ['datasources'],
        SummaryData: ['columns', 'rows'],
        LogicalTableItem: ['id', 'caption'],
        LogicalTableList: ['tables'],
        ValidationResult: ['validationIssues'],
        ImageExport: ['width', 'height'],
      });
      for (const [name, exceptions] of Object.entries(KNOWN_READ_REQUIREDNESS_EXCEPTIONS)) {
        const component = specSchema(name);
        expect(exceptions.every((key) => component.required?.includes(key))).toBe(true);
      }
    });

    it.each([
      ['WorksheetItem', worksheetItemSchema],
      ['DashboardItem', dashboardItemSchema],
      ['StoryboardItem', storyboardItemSchema],
    ] as const)('%s accepts a 0.2.4 item without isActiveSheet', (_name, schema) => {
      expect(schema.safeParse({ id: 'sheet-1', name: 'Sheet 1', hidden: false }).success).toBe(
        true,
      );
    });

    it.each([
      ['WorksheetItem', worksheetItemSchema],
      ['DashboardItem', dashboardItemSchema],
      ['StoryboardItem', storyboardItemSchema],
    ] as const)('%s accepts a hidden sheet with index: null', (_name, schema) => {
      expect(
        schema.safeParse({ id: 'sheet-1', name: 'Sheet 1', hidden: true, index: null }).success,
      ).toBe(true);
    });

    it('StoryboardItem accepts storyPointCount: null', () => {
      expect(
        storyboardItemSchema.safeParse({
          id: 'story-1',
          name: 'Story 1',
          hidden: false,
          storyPointCount: null,
        }).success,
      ).toBe(true);
    });
  });

  describe('Problem ↔ problemResponseSchema', () => {
    const problem = specSchema('Problem');

    it('declares every spec property (extras `type`/`detail` are RFC-9457 members additionalProperties admits)', () => {
      const missing = Object.keys(problem.properties ?? {}).filter(
        (key) => !declaredKeys(problemResponseSchema).includes(key),
      );
      expect(missing).toEqual([]);
      const extras = declaredKeys(problemResponseSchema).filter(
        (key) => !(key in (problem.properties ?? {})),
      );
      expect(extras.sort()).toEqual(['detail', 'type']);
    });

    it('PROBLEM_CODES equals the spec x-extensible-enum exactly', () => {
      expect([...PROBLEM_CODES].sort()).toEqual(
        [...(problem.properties?.code?.['x-extensible-enum'] ?? [])].sort(),
      );
    });

    // Deliberately NO requiredness parity: problemResponseSchema keeps every field
    // optional so error extraction fails open on a partially-parseable Problem.
    it('accepts a spec-minimal Problem payload', () => {
      expect(
        problemResponseSchema.safeParse({ code: 'sheet-not-found', status: 404, instance: '/v0/x' })
          .success,
      ).toBe(true);
    });
  });

  describe('routes', () => {
    it.each([
      EXTERNAL_API_ROUTES.health,
      EXTERNAL_API_ROUTES.app,
      EXTERNAL_API_ROUTES.root,
      EXTERNAL_API_ROUTES.workbook,
      EXTERNAL_API_ROUTES.workbookDashboards,
      EXTERNAL_API_ROUTES.workbookDatasources,
      EXTERNAL_API_ROUTES.workbookDocument,
      EXTERNAL_API_ROUTES.workbookDocumentValidate,
      EXTERNAL_API_ROUTES.workbookStoryboards,
      EXTERNAL_API_ROUTES.workbookWorksheets,
      EXTERNAL_API_ROUTES.workbookUndo,
      EXTERNAL_API_ROUTES.workbookRedo,
      EXTERNAL_API_ROUTES.dashboardById,
      EXTERNAL_API_ROUTES.dashboardDocument,
      EXTERNAL_API_ROUTES.storyboardById,
      EXTERNAL_API_ROUTES.storyboardDocument,
      EXTERNAL_API_ROUTES.worksheetById,
      EXTERNAL_API_ROUTES.worksheetDocument,
      EXTERNAL_API_ROUTES.worksheetImage,
      EXTERNAL_API_ROUTES.worksheetSummaryData,
      EXTERNAL_API_ROUTES.worksheetLogicalTables,
      EXTERNAL_API_ROUTES.worksheetLogicalTableData,
      EXTERNAL_API_ROUTES.worksheetDelete,
      EXTERNAL_API_ROUTES.worksheetRename,
      EXTERNAL_API_ROUTES.worksheetSort,
      EXTERNAL_API_ROUTES.worksheetPauseAutoUpdates,
      EXTERNAL_API_ROUTES.worksheetResumeAutoUpdates,
      EXTERNAL_API_ROUTES.dashboardDelete,
      EXTERNAL_API_ROUTES.dashboardRename,
      EXTERNAL_API_ROUTES.dashboardPauseAutoUpdates,
      EXTERNAL_API_ROUTES.dashboardResumeAutoUpdates,
      EXTERNAL_API_ROUTES.storyboardDelete,
      EXTERNAL_API_ROUTES.storyboardRename,
      EXTERNAL_API_ROUTES.workbookGoToSheet,
      EXTERNAL_API_ROUTES.dashboardImage,
      EXTERNAL_API_ROUTES.appOpenFile,
      EXTERNAL_API_ROUTES.workbookSave,
      EXTERNAL_API_ROUTES.workbookWorksheetsNew,
      EXTERNAL_API_ROUTES.workbookDashboardsNew,
      EXTERNAL_API_ROUTES.workbookStoryboardsNew,
      EXTERNAL_API_ROUTES.operations,
      EXTERNAL_API_ROUTES.operationById,
      EXTERNAL_API_ROUTES.site,
      EXTERNAL_API_ROUTES.siteDatasources,
      EXTERNAL_API_ROUTES.siteWorkbooks,
      EXTERNAL_API_ROUTES.openapi,
      EXTERNAL_API_ROUTES.oauthProtectedResource,
    ])('spec documents %s', (route) => {
      expect(Object.keys(spec.paths)).toContain(route);
    });

    it('invokeCommand stays deliberately undocumented (hidden route, owned separately)', () => {
      expect(Object.keys(spec.paths)).not.toContain(EXTERNAL_API_ROUTES.invokeCommand);
    });

    // workbook:exportAs ships in External Client API 0.2.7, but the captured fixture is still 0.2.6
    it('workbook:exportAs is absent until the fixture is recaptured at 0.2.7', () => {
      expect(Object.keys(spec.paths)).not.toContain(EXTERNAL_API_ROUTES.workbookExportAs);
    });
  });

  describe('envelope wire acceptance', () => {
    it('parses a full spec-shaped Operation', () => {
      const parsed = operationEnvelopeSchema.safeParse({
        id: 'op-1',
        kind: 'workbook.document.apply',
        state: 'FAILED',
        createdAt: '2026-07-20T10:00:00Z',
        updatedAt: '2026-07-20T10:00:01Z',
        completedAt: '2026-07-20T10:00:01Z',
        error: { code: 'operation-failed', message: 'nope' },
        warnings: [{ code: 'partial', message: 'one sheet skipped' }],
      });
      expect(parsed.success).toBe(true);
    });

    it('parses a SUCCEEDED Operation result object and serialize-degradation warning', () => {
      const parsed = operationEnvelopeSchema.safeParse({
        id: 'op-1',
        kind: 'command.invoke',
        state: 'SUCCEEDED',
        createdAt: '2026-07-20T10:00:00Z',
        updatedAt: '2026-07-20T10:00:02Z',
        result: { outputParam: 'value' },
        warnings: [
          {
            code: 'output-serialization-failed',
            message: 'Command output could not be serialized.',
            target: 'result',
          },
        ],
      });
      expect(parsed.success).toBe(true);
    });

    it.each([
      ['id', { kind: 'k', state: 's' }],
      ['kind', { id: 'op-1', state: 's' }],
      ['state', { id: 'op-1', kind: 'k' }],
    ])('rejects an Operation missing required `%s`', (_key, payload) => {
      expect(operationEnvelopeSchema.safeParse(payload).success).toBe(false);
    });
  });
});
