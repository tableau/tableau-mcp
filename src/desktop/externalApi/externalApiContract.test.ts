import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { startMockExternalApiServer } from './mockExternalApiServer.js';
import {
  apiRootSchema,
  appInfoSchema,
  capabilityMatrixSchema,
  dashboardItemSchema,
  dashboardListSchema,
  dashboardRefreshFailureSchema,
  dashboardRefreshOutcomeSchema,
  dashboardRefreshTargetSchema,
  datasourceItemSchema,
  datasourceListSchema,
  desktopStateSchema,
  dialogActionSchema,
  dialogIdentitySchema,
  dialogListSchema,
  EXTERNAL_API_ROUTES,
  healthSchema,
  imageResultSchema,
  invokeDialogActionRequestSchema,
  invokeDialogActionResultSchema,
  logicalTableItemSchema,
  logicalTableListSchema,
  operationEnvelopeSchema,
  operationErrorSchema,
  operationListSchema,
  operationWarningSchema,
  PROBLEM_CODES,
  problemResponseSchema,
  protectedResourceMetadataSchema,
  showMeOptionSchema,
  showMeOptionsResultSchema,
  showMeWorksheetSchema,
  storyboardItemSchema,
  storyboardListSchema,
  summaryDataSchema,
  validateCalculatedFieldResponseSchema,
  validationResultSchema,
  windowInfoSchema,
  workbookDiagnosticsSchema,
  workbookInventorySchema,
  worksheetDiagnosticsSchema,
  worksheetInvalidFieldSchema,
  worksheetItemSchema,
  worksheetListSchema,
} from './types.js';

/**
 * Contract-intake harness: validates OUR zod schemas against the checked-in
 * `/openapi.json` artifact. When the API owner ships a new spec, overwrite the
 * fixture with it and rerun — every drift (new field, changed requiredness, enum
 * growth, route add/remove) surfaces as a red/green diff instead of a manual reread.
 */

type SpecProperty = {
  $ref?: string;
  type?: string;
  minLength?: number;
  maxLength?: number;
  const?: string;
  enum?: Array<string>;
  items?: SpecProperty;
  required?: Array<string>;
  properties?: Record<string, SpecProperty>;
  allOf?: Array<SpecProperty>;
  'x-extensible-enum'?: Array<string>;
};

type SpecSchema = {
  type?: string;
  description?: string;
  required?: Array<string>;
  properties?: Record<string, SpecProperty>;
  oneOf?: Array<SpecSchema>;
};

const spec = JSON.parse(
  readFileSync(path.join(__dirname, '__fixtures__', 'externalClientApi-openapi.json'), 'utf-8'),
) as {
  info: { version: string };
  paths: Record<string, unknown>;
  components: { schemas: Record<string, SpecSchema> };
};

const specSchema = (name: string): SpecSchema => {
  const schema = spec.components.schemas[name];
  expect(schema, `spec component schema ${name} missing`).toBeDefined();
  return schema;
};

const schemaBranches = (schema: SpecSchema): Array<SpecSchema> => schema.oneOf ?? [schema];

const specPropertyNames = (schema: SpecSchema): Array<string> => [
  ...new Set(schemaBranches(schema).flatMap((branch) => Object.keys(branch.properties ?? {}))),
];

const specRequiredKeys = (schema: SpecSchema): Array<string> => {
  const [first, ...rest] = schemaBranches(schema);
  return (first.required ?? []).filter((key) =>
    rest.every((branch) => branch.required?.includes(key)),
  );
};

const resolveRef = (property: SpecProperty | undefined): SpecProperty | undefined =>
  property?.$ref === undefined
    ? property
    : (specSchema(property.$ref.replace('#/components/schemas/', '')) as SpecProperty);

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
    'isStartPageVisible',
    'isDataSourcePageActive',
    'isPresentationMode',
    'isFocusMode',
  ],
  DashboardItem: ['isActiveSheet', 'isAutoUpdatesPaused', 'containedSheets', 'index', 'type'],
  DashboardList: ['dashboards'],
  DatasourceItem: [
    'id',
    'luid',
    'name',
    'caption',
    'type',
    'isExtract',
    'hasDownloadFilePermission',
  ],
  DatasourceList: ['datasources'],
  Health: ['status'],
  ProtectedResourceMetadata: ['resource', 'bearer_methods_supported'],
  WorksheetItem: ['isActiveSheet', 'isAutoUpdatesPaused', 'datasources', 'index', 'type'],
  WorksheetList: ['worksheets'],
  StoryboardItem: ['isActiveSheet', 'index', 'storyPointCount', 'type'],
  StoryboardList: ['storyboards'],
  WorkbookInventory: ['location', 'worksheets', 'dashboards', 'storyboards'],
  SummaryData: ['columns', 'rows'],
  LogicalTableItem: ['id', 'caption'],
  LogicalTableList: ['tables'],
  ValidationResult: ['validationIssues'],
  ImageExport: ['effectiveMimeType', 'width', 'height'],
};

describe('external client API contract (captured openapi fixture)', () => {
  it('tracks the 0.2.26 producer contract', () => {
    expect(spec.info.version).toBe('0.2.26');
  });

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

  describe('DashboardRefreshOutcome', () => {
    const outcome = specSchema('DashboardRefreshOutcome');

    it('matches the aggregate outcome schema and nested target contracts', () => {
      expect(declaredKeys(dashboardRefreshOutcomeSchema).sort()).toEqual(
        Object.keys(outcome.properties ?? {}).sort(),
      );
      expect(requiredKeys(dashboardRefreshOutcomeSchema).sort()).toEqual(
        [...(outcome.required ?? [])].sort(),
      );
      expect(outcome.properties?.outcome?.enum).toEqual(['COMPLETE', 'PARTIAL', 'FAILED']);

      const refreshedItem = resolveRef(outcome.properties?.refreshed?.items);
      expect(Object.keys(refreshedItem?.properties ?? {}).sort()).toEqual(
        declaredKeys(dashboardRefreshTargetSchema).sort(),
      );
      expect([...(refreshedItem?.required ?? [])].sort()).toEqual(
        requiredKeys(dashboardRefreshTargetSchema).sort(),
      );

      const failedItem = resolveRef(outcome.properties?.failed?.items);
      expect(Object.keys(failedItem?.properties ?? {}).sort()).toEqual(
        declaredKeys(dashboardRefreshFailureSchema).sort(),
      );
      expect([...(failedItem?.required ?? [])].sort()).toEqual(
        requiredKeys(dashboardRefreshFailureSchema).sort(),
      );
    });
  });

  describe('data-first read schemas', () => {
    it.each([
      ['ApiRoot', apiRootSchema],
      ['AppInfo', appInfoSchema],
      ['CapabilityMatrix', capabilityMatrixSchema],
      ['DashboardItem', dashboardItemSchema],
      ['DashboardList', dashboardListSchema],
      ['DatasourceItem', datasourceItemSchema],
      ['DatasourceList', datasourceListSchema],
      ['Health', healthSchema],
      ['ProtectedResourceMetadata', protectedResourceMetadataSchema],
      ['WorksheetItem', worksheetItemSchema],
      ['WorksheetList', worksheetListSchema],
      ['WorksheetInvalidField', worksheetInvalidFieldSchema],
      ['WorkbookDiagnostics', workbookDiagnosticsSchema],
      ['StoryboardItem', storyboardItemSchema],
      ['StoryboardList', storyboardListSchema],
      ['WorkbookInventory', workbookInventorySchema],
      ['SummaryData', summaryDataSchema],
      ['LogicalTableItem', logicalTableItemSchema],
      ['LogicalTableList', logicalTableListSchema],
      ['ShowMeWorksheet', showMeWorksheetSchema],
      ['ShowMeOption', showMeOptionSchema],
      ['ShowMeOptions', showMeOptionsResultSchema],
      ['WindowInfo', windowInfoSchema],
      ['ValidationResult', validationResultSchema],
      ['ImageExport', imageResultSchema],
      ['OperationList', operationListSchema],
      ['ValidateCalculatedFieldResponse', validateCalculatedFieldResponseSchema],
    ] as const)(
      '%s: properties and required set match except known version deltas',
      (name, schema) => {
        const component = specSchema(name);
        expect(declaredKeys(schema).sort()).toEqual(specPropertyNames(component).sort());
        const exceptions = new Set(KNOWN_READ_REQUIREDNESS_EXCEPTIONS[name] ?? []);
        expect(requiredKeys(schema).sort()).toEqual(
          specRequiredKeys(component)
            .filter((key) => !exceptions.has(key))
            .sort(),
        );
      },
    );

    it('pins the complete 0.2.25 requiredness exception set', () => {
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
          'isStartPageVisible',
          'isDataSourcePageActive',
          'isPresentationMode',
          'isFocusMode',
        ],
        DashboardItem: ['isActiveSheet', 'isAutoUpdatesPaused', 'containedSheets', 'index', 'type'],
        DashboardList: ['dashboards'],
        DatasourceItem: [
          'id',
          'luid',
          'name',
          'caption',
          'type',
          'isExtract',
          'hasDownloadFilePermission',
        ],
        DatasourceList: ['datasources'],
        Health: ['status'],
        ProtectedResourceMetadata: ['resource', 'bearer_methods_supported'],
        WorksheetItem: ['isActiveSheet', 'isAutoUpdatesPaused', 'datasources', 'index', 'type'],
        WorksheetList: ['worksheets'],
        StoryboardItem: ['isActiveSheet', 'index', 'storyPointCount', 'type'],
        StoryboardList: ['storyboards'],
        WorkbookInventory: ['location', 'worksheets', 'dashboards', 'storyboards'],
        SummaryData: ['columns', 'rows'],
        LogicalTableItem: ['id', 'caption'],
        LogicalTableList: ['tables'],
        ValidationResult: ['validationIssues'],
        ImageExport: ['effectiveMimeType', 'width', 'height'],
      });
      for (const [name, exceptions] of Object.entries(KNOWN_READ_REQUIREDNESS_EXCEPTIONS)) {
        const component = specSchema(name);
        expect(exceptions.every((key) => specRequiredKeys(component).includes(key))).toBe(true);
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

    it('WorksheetDiagnostics matches the producer shape and complete-status invariant', () => {
      const component = specSchema('WorksheetDiagnostics');
      expect(Object.keys(component.properties ?? {}).sort()).toEqual([
        'invalidFields',
        'message',
        'status',
        'worksheetId',
      ]);
      expect([...(component.required ?? [])].sort()).toEqual(['status', 'worksheetId']);
      expect(
        worksheetDiagnosticsSchema.safeParse({
          worksheetId: 'sheet-1',
          status: 'complete',
          invalidFields: [],
        }).success,
      ).toBe(true);
      expect(
        worksheetDiagnosticsSchema.safeParse({
          worksheetId: 'sheet-1',
          status: 'complete',
        }).success,
      ).toBe(false);
    });
  });

  describe('Problem ↔ problemResponseSchema', () => {
    const problem = specSchema('Problem');

    it('declares every spec property (extras `type`/`detail` are standard RFC-9457 members)', () => {
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

  describe('dialog contracts', () => {
    it.each([
      ['DialogIdentity', dialogIdentitySchema],
      ['DialogList', dialogListSchema],
      ['InvokeDialogActionRequest', invokeDialogActionRequestSchema],
    ] as const)('%s properties and required set match exactly', (name, schema) => {
      const component = specSchema(name);
      expect(declaredKeys(schema).sort()).toEqual(Object.keys(component.properties ?? {}).sort());
      expect(requiredKeys(schema).sort()).toEqual([...(component.required ?? [])].sort());
    });

    it('reuses WindowInfo for every dialog snapshot', () => {
      const dialogList = specSchema('DialogList');
      const dismissResult = specSchema('InvokeDialogActionResult');

      expect(dialogList.properties?.dialogs?.items?.$ref).toBe('#/components/schemas/WindowInfo');
      for (const outcome of dismissResult.oneOf ?? []) {
        expect(outcome.properties?.dialogs?.items?.$ref).toBe('#/components/schemas/WindowInfo');
      }
    });

    it('documents bounded detailed text and its truncation marker', () => {
      const windowInfo = specSchema('WindowInfo');

      expect(windowInfo.properties?.detailedText?.maxLength).toBe(1024 * 1024);
      expect(windowInfo.properties?.detailedTextTruncated?.type).toBe('boolean');
    });

    it('models exact labeled button and semantic close actions', () => {
      const variants = specSchema('DialogAction').oneOf ?? [];
      const byKind = Object.fromEntries(
        variants.map((variant) => [variant.properties?.kind?.const, variant]),
      );

      expect(byKind.button.required?.sort()).toEqual(['kind', 'label']);
      expect(byKind.button.properties?.label?.minLength).toBe(1);
      expect(byKind.close.required).toEqual(['kind']);
      expect(byKind.close.properties?.label).toBe(false);
      expect(dialogActionSchema.safeParse({ kind: 'button', label: 'Discard' }).success).toBe(true);
      expect(dialogActionSchema.safeParse({ kind: 'button' }).success).toBe(false);
      expect(dialogActionSchema.safeParse({ kind: 'button', label: '' }).success).toBe(false);
      expect(dialogActionSchema.safeParse({ kind: 'close' }).success).toBe(true);
      expect(dialogActionSchema.safeParse({ kind: 'close', label: 'X' }).success).toBe(false);
      expect(dialogActionSchema.safeParse({ kind: 'unknown' }).success).toBe(false);
    });

    it('requires an exact returned action in requests and invoked responses', () => {
      const request = specSchema('InvokeDialogActionRequest');
      const outcomes = specSchema('InvokeDialogActionResult').oneOf ?? [];

      expect(request.properties?.dialog?.$ref).toBe('#/components/schemas/DialogIdentity');
      expect(request.properties?.action?.$ref).toBe('#/components/schemas/DialogAction');
      expect(
        invokeDialogActionRequestSchema.safeParse({
          dialog: { objectName: '', title: '', className: '' },
          action: { kind: 'button', label: '' },
        }).success,
      ).toBe(false);
      expect(
        invokeDialogActionRequestSchema.safeParse({
          dialog: { objectName: '', title: '', className: '' },
          action: { kind: 'button', label: ' ' },
        }).success,
      ).toBe(true);
      expect(
        invokeDialogActionRequestSchema.safeParse({
          dialog: { objectName: 'dialog', title: 'Save' },
          action: { kind: 'button', label: 'Discard' },
        }).success,
      ).toBe(false);
      for (const outcome of outcomes.filter(
        (candidate) => candidate.properties?.outcome?.const !== 'no-active-dialog',
      )) {
        expect(outcome.properties?.dialog?.$ref).toBe('#/components/schemas/DialogIdentity');
        expect(outcome.properties?.action?.$ref).toBe('#/components/schemas/DialogAction');
      }
    });

    it('models the exact three outcome branches and their required fields', () => {
      const outcomeSchemas = specSchema('InvokeDialogActionResult').oneOf ?? [];
      const requiredByOutcome = Object.fromEntries(
        outcomeSchemas.map((outcome) => [
          outcome.properties?.outcome?.const,
          [...(outcome.required ?? [])].sort(),
        ]),
      );

      expect(requiredByOutcome).toEqual({
        'no-active-dialog': ['dialogs', 'outcome'],
        dismissed: ['action', 'dialog', 'dialogs', 'outcome'],
        'action-invoked-dialog-remains': ['action', 'dialog', 'dialogs', 'outcome'],
      });

      expect(
        invokeDialogActionResultSchema.safeParse({ outcome: 'no-active-dialog', dialogs: [] })
          .success,
      ).toBe(true);
      expect(
        invokeDialogActionResultSchema.safeParse({
          outcome: 'dismissed',
          dialog: { objectName: 'dialog', title: 'Save', className: 'QMessageBox' },
          action: { kind: 'button', label: 'Discard' },
          dialogs: [],
        }).success,
      ).toBe(true);
      expect(
        invokeDialogActionResultSchema.safeParse({
          outcome: 'action-invoked-dialog-remains',
          dialogs: [],
        }).success,
      ).toBe(false);
    });
  });

  describe('app-state contract', () => {
    const appState = specSchema('AppState');

    it('pins the producer properties, required fields, and shared window references', () => {
      expect(Object.keys(appState.properties ?? {}).sort()).toEqual([
        'activeActivities',
        'blockedBy',
        'blockingWindows',
        'progressWindows',
        'state',
        'uiSnapshotAvailable',
      ]);
      expect([...(appState.required ?? [])].sort()).toEqual([
        'activeActivities',
        'state',
        'uiSnapshotAvailable',
      ]);
      expect(appState.properties?.blockingWindows?.items?.$ref).toBe(
        '#/components/schemas/WindowInfo',
      );
      expect(appState.properties?.progressWindows?.items?.$ref).toBe(
        '#/components/schemas/WindowInfo',
      );
    });

    it('normalizes omitted window arrays and preserves shared dialog action context', () => {
      expect(desktopStateSchema.parse({ state: 'IDLE', uiSnapshotAvailable: true })).toEqual({
        state: 'IDLE',
        uiSnapshotAvailable: true,
        activeActivities: [],
        blockingWindows: [],
        progressWindows: [],
      });

      const parsed = desktopStateSchema.parse({
        state: 'BLOCKED',
        blockedBy: 'MODAL_DIALOG',
        uiSnapshotAvailable: true,
        activeActivities: [],
        blockingWindows: [
          {
            objectName: 'modal',
            title: 'Save changes',
            className: 'QMessageBox',
            detailedTextTruncated: true,
            actions: [{ kind: 'button', label: 'Save' }, { kind: 'close' }],
          },
        ],
      });
      expect(parsed.blockingWindows[0].actions).toEqual([
        { kind: 'button', label: 'Save' },
        { kind: 'close' },
      ]);
      expect(parsed.blockingWindows[0].detailedTextTruncated).toBe(true);
    });

    it('rejects BLOCKED without a cause and IDLE without complete empty evidence', () => {
      expect(
        desktopStateSchema.safeParse({ state: 'BLOCKED', uiSnapshotAvailable: true }).success,
      ).toBe(false);
      expect(
        desktopStateSchema.safeParse({ state: 'IDLE', uiSnapshotAvailable: false }).success,
      ).toBe(false);
      expect(
        desktopStateSchema.safeParse({
          state: 'IDLE',
          uiSnapshotAvailable: true,
          activeActivities: ['QUERYING'],
        }).success,
      ).toBe(false);
    });
  });

  describe('routes', () => {
    it.each([
      EXTERNAL_API_ROUTES.health,
      EXTERNAL_API_ROUTES.app,
      EXTERNAL_API_ROUTES.appDialogs,
      EXTERNAL_API_ROUTES.appState,
      EXTERNAL_API_ROUTES.appInvokeDialogAction,
      EXTERNAL_API_ROUTES.root,
      EXTERNAL_API_ROUTES.workbook,
      EXTERNAL_API_ROUTES.workbookDiagnostics,
      EXTERNAL_API_ROUTES.workbookDashboards,
      EXTERNAL_API_ROUTES.workbookDatasources,
      EXTERNAL_API_ROUTES.workbookDatasource,
      EXTERNAL_API_ROUTES.workbookDatasourceDocument,
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
      EXTERNAL_API_ROUTES.worksheetDiagnostics,
      EXTERNAL_API_ROUTES.worksheetDocument,
      EXTERNAL_API_ROUTES.worksheetImage,
      EXTERNAL_API_ROUTES.worksheetSummaryData,
      EXTERNAL_API_ROUTES.worksheetLogicalTables,
      EXTERNAL_API_ROUTES.worksheetLogicalTableData,
      EXTERNAL_API_ROUTES.worksheetShowMeOptions,
      EXTERNAL_API_ROUTES.worksheetDelete,
      EXTERNAL_API_ROUTES.worksheetRename,
      EXTERNAL_API_ROUTES.worksheetSort,
      EXTERNAL_API_ROUTES.worksheetPauseAutoUpdates,
      EXTERNAL_API_ROUTES.worksheetResumeAutoUpdates,
      EXTERNAL_API_ROUTES.worksheetRefreshNow,
      EXTERNAL_API_ROUTES.dashboardDelete,
      EXTERNAL_API_ROUTES.dashboardRename,
      EXTERNAL_API_ROUTES.dashboardPauseAutoUpdates,
      EXTERNAL_API_ROUTES.dashboardResumeAutoUpdates,
      EXTERNAL_API_ROUTES.storyboardDelete,
      EXTERNAL_API_ROUTES.storyboardRename,
      EXTERNAL_API_ROUTES.storyboardRefreshNow,
      EXTERNAL_API_ROUTES.workbookGoToSheet,
      EXTERNAL_API_ROUTES.workbookExportAs,
      EXTERNAL_API_ROUTES.datasourceRefreshData,
      EXTERNAL_API_ROUTES.datasourceRefreshExtract,
      EXTERNAL_API_ROUTES.dashboardImage,
      EXTERNAL_API_ROUTES.storyboardImage,
      EXTERNAL_API_ROUTES.appOpenFile,
      EXTERNAL_API_ROUTES.workbookSave,
      EXTERNAL_API_ROUTES.workbookWorksheetsNew,
      EXTERNAL_API_ROUTES.workbookDashboardsNew,
      EXTERNAL_API_ROUTES.workbookStoryboardsNew,
      EXTERNAL_API_ROUTES.operations,
      EXTERNAL_API_ROUTES.operationById,
      EXTERNAL_API_ROUTES.openapi,
      EXTERNAL_API_ROUTES.oauthProtectedResource,
      EXTERNAL_API_ROUTES.appToggleDataSourcePage,
      EXTERNAL_API_ROUTES.capabilities,
      EXTERNAL_API_ROUTES.worksheetValidateCalculatedField,
      EXTERNAL_API_ROUTES.worksheetReloadExtension,
      EXTERNAL_API_ROUTES.dashboardReloadExtensions,
    ])('spec documents %s', (route) => {
      expect(Object.keys(spec.paths)).toContain(route);
    });

    it('has a route constant for every spec path and only the hidden invokeCommand beyond it', () => {
      const constants = Object.values(EXTERNAL_API_ROUTES);
      expect(
        Object.keys(spec.paths).filter((route) => !constants.includes(route as never)),
      ).toEqual([]);
      expect(
        constants.filter(
          (route) => !(route in spec.paths) && route !== EXTERNAL_API_ROUTES.invokeCommand,
        ),
      ).toEqual([]);
    });

    it('serves every spec operation from the mock server', async () => {
      const server = await startMockExternalApiServer({ token: 'route-coverage-token' });
      try {
        const unrouted: Array<string> = [];
        for (const [route, item] of Object.entries(spec.paths)) {
          for (const method of Object.keys(item as Record<string, unknown>)) {
            const response = await fetch(`${server.baseUrl}${route.replaceAll(/\{\w+\}/g, 'x')}`, {
              method: method.toUpperCase(),
              headers: { Authorization: 'Bearer route-coverage-token' },
            });
            const problem =
              response.status === 404 ? ((await response.json()) as { code?: string }) : {};
            if (problem.code === 'not-found') {
              unrouted.push(`${method.toUpperCase()} ${route}`);
            }
          }
        }
        expect(unrouted).toEqual([]);
      } finally {
        await server.close();
      }
    });

    it('documents getWorkbookExtensions at 0.2.26', () => {
      const item = spec.paths[EXTERNAL_API_ROUTES.workbookExtensions] as {
        get?: { operationId?: string };
      };
      expect(item.get?.operationId).toBe('getWorkbookExtensions');
    });

    it('documents the new 0.2.25 operations by operationId', () => {
      const operationIds = Object.fromEntries(
        [
          EXTERNAL_API_ROUTES.appToggleDataSourcePage,
          EXTERNAL_API_ROUTES.capabilities,
          EXTERNAL_API_ROUTES.worksheetValidateCalculatedField,
          EXTERNAL_API_ROUTES.worksheetReloadExtension,
          EXTERNAL_API_ROUTES.dashboardReloadExtensions,
        ].map((route) => {
          const item = spec.paths[route] as Record<string, { operationId?: string }>;
          return [route, (item.get ?? item.post)?.operationId];
        }),
      );

      expect(operationIds).toEqual({
        [EXTERNAL_API_ROUTES.appToggleDataSourcePage]: 'toggleDataSourcePage',
        [EXTERNAL_API_ROUTES.capabilities]: 'getCapabilities',
        [EXTERNAL_API_ROUTES.worksheetValidateCalculatedField]: 'validateWorksheetCalculatedField',
        [EXTERNAL_API_ROUTES.worksheetReloadExtension]: 'reloadWorksheetExtension',
        [EXTERNAL_API_ROUTES.dashboardReloadExtensions]: 'reloadDashboardExtensions',
      });
    });

    it('requires an explicit target state for the Data Source page', () => {
      const request = specSchema('ToggleDataSourcePageRequest');

      expect(request.required).toEqual(['isDataSourcePageActive']);
      expect(request.properties?.isDataSourcePageActive?.type).toBe('boolean');
    });

    it('accepts spec-shaped capability, validation, operation list and metadata payloads', () => {
      expect(
        capabilityMatrixSchema.safeParse({
          capabilities: {
            getHealth: { requiresServer: false },
            refreshDatasourceData: { requiresServer: true },
          },
        }).success,
      ).toBe(true);
      expect(
        validateCalculatedFieldResponseSchema.safeParse({
          isValid: false,
          errors: [{ position: 4, length: 2, message: 'Unknown field.' }],
        }).success,
      ).toBe(true);
      expect(
        operationListSchema.safeParse({
          operations: [
            {
              id: 'op-1',
              kind: 'k',
              state: 'RUNNING',
              createdAt: '2026-10-21T10:00:00Z',
              updatedAt: '2026-10-21T10:00:00Z',
              warnings: [],
            },
          ],
          blockingWindows: [],
          progressWindows: [],
        }).success,
      ).toBe(true);
      expect(
        protectedResourceMetadataSchema.safeParse({
          resource: 'http://127.0.0.1:1234',
          bearer_methods_supported: ['header'],
        }).success,
      ).toBe(true);
    });

    it('rejects a validation response missing its verdict or errors', () => {
      expect(validateCalculatedFieldResponseSchema.safeParse({ errors: [] }).success).toBe(false);
      expect(validateCalculatedFieldResponseSchema.safeParse({ isValid: true }).success).toBe(
        false,
      );
    });

    it('documents the individual datasource operation contracts', () => {
      const metadata = spec.paths[EXTERNAL_API_ROUTES.workbookDatasource] as {
        get?: { operationId?: string };
      };
      const document = spec.paths[EXTERNAL_API_ROUTES.workbookDatasourceDocument] as {
        get?: { operationId?: string };
        post?: { operationId?: string };
      };

      expect(metadata.get?.operationId).toBe('getWorkbookDatasource');
      expect(document.get?.operationId).toBe('getDatasourceDocument');
      expect(document.post?.operationId).toBe('applyDatasourceDocument');
    });

    it('documents workbook and worksheet diagnostics with the shared aggregate response', () => {
      const paths = spec.paths as Record<
        string,
        {
          get?: {
            operationId?: string;
            responses?: Record<string, { content?: Record<string, { schema?: SpecProperty }> }>;
          };
        }
      >;

      expect(paths[EXTERNAL_API_ROUTES.workbookDiagnostics]?.get?.operationId).toBe(
        'getWorkbookDiagnostics',
      );
      expect(
        paths[EXTERNAL_API_ROUTES.workbookDiagnostics]?.get?.responses?.['200']?.content?.[
          'application/json'
        ]?.schema?.$ref,
      ).toBe('#/components/schemas/WorkbookDiagnostics');
      expect(paths[EXTERNAL_API_ROUTES.worksheetDiagnostics]?.get?.operationId).toBe(
        'getWorksheetDiagnostics',
      );
      expect(
        paths[EXTERNAL_API_ROUTES.worksheetDiagnostics]?.get?.responses?.['200']?.content?.[
          'application/json'
        ]?.schema?.$ref,
      ).toBe('#/components/schemas/WorkbookDiagnostics');
      expect(specSchema('Operation').properties?.diagnostics?.$ref).toBe(
        '#/components/schemas/WorkbookDiagnostics',
      );
    });

    it('invokeCommand stays deliberately undocumented (hidden route, owned separately)', () => {
      expect(Object.keys(spec.paths)).not.toContain(EXTERNAL_API_ROUTES.invokeCommand);
    });

    it('documents the dialog routes with their exact request and response schemas', () => {
      const paths = spec.paths as Record<
        string,
        {
          get?: {
            responses?: Record<string, { content?: Record<string, { schema?: SpecProperty }> }>;
          };
          post?: {
            summary?: string;
            requestBody?: { content?: Record<string, { schema?: SpecProperty }> };
            responses?: Record<string, { content?: Record<string, { schema?: SpecProperty }> }>;
          };
        }
      >;

      expect(
        paths[EXTERNAL_API_ROUTES.appDialogs]?.get?.responses?.['200']?.content?.[
          'application/json'
        ]?.schema?.$ref,
      ).toBe('#/components/schemas/DialogList');
      expect(paths[EXTERNAL_API_ROUTES.appInvokeDialogAction]?.post?.summary).toBe(
        'Invoke an active dialog action',
      );
      expect(
        paths[EXTERNAL_API_ROUTES.appInvokeDialogAction]?.post?.requestBody?.content?.[
          'application/json'
        ]?.schema?.$ref,
      ).toBe('#/components/schemas/InvokeDialogActionRequest');
      expect(
        paths[EXTERNAL_API_ROUTES.appInvokeDialogAction]?.post?.responses?.['200']?.content?.[
          'application/json'
        ]?.schema?.$ref,
      ).toBe('#/components/schemas/InvokeDialogActionResult');
      expect(
        Object.keys(paths[EXTERNAL_API_ROUTES.appInvokeDialogAction]?.post?.responses ?? {}),
      ).toContain('409');
    });

    it('documents the app-state read with the shared AppState response', () => {
      const path = spec.paths[EXTERNAL_API_ROUTES.appState] as {
        get?: {
          operationId?: string;
          responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>;
        };
      };

      expect(path.get?.operationId).toBe('getAppState');
      expect(path.get?.responses?.['200']?.content?.['application/json']?.schema?.$ref).toBe(
        '#/components/schemas/AppState',
      );
    });

    it('documents worksheet refresh-now as a bodyless Operation route', () => {
      const pathItem = spec.paths[EXTERNAL_API_ROUTES.worksheetRefreshNow] as {
        post?: {
          operationId?: string;
          requestBody?: unknown;
          responses?: Record<string, unknown>;
        };
      };
      expect(Object.keys(pathItem)).toEqual(['post']);
      expect(pathItem.post?.operationId).toBe('refreshWorksheetNow');
      expect(pathItem.post).not.toHaveProperty('requestBody');
      expect(pathItem.post?.responses).toHaveProperty(
        '200.content.application/json.schema.$ref',
        '#/components/schemas/Operation',
      );
      expect(pathItem.post?.responses).toHaveProperty(
        '202.$ref',
        '#/components/responses/Accepted',
      );
      expect(pathItem.post?.responses).toHaveProperty(
        '404.content.application/problem+json.schema.$ref',
        '#/components/schemas/Problem',
      );
      expect(pathItem.post?.responses).toHaveProperty(
        '404.description',
        expect.stringContaining('sheet-not-found'),
      );
    });

    it('documents storyboard refresh-now as a bodyless Operation route', () => {
      const pathItem = spec.paths[EXTERNAL_API_ROUTES.storyboardRefreshNow] as {
        post?: {
          operationId?: string;
          requestBody?: unknown;
          responses?: Record<string, unknown>;
        };
      };

      expect(Object.keys(pathItem)).toEqual(['post']);
      expect(pathItem.post?.operationId).toBe('refreshStoryboardNow');
      expect(pathItem.post).not.toHaveProperty('requestBody');
      expect(pathItem.post?.responses).toHaveProperty('200.content.application/json.schema.allOf', [
        { $ref: '#/components/schemas/Operation' },
        {
          type: 'object',
          properties: {
            result: { $ref: '#/components/schemas/StoryboardRefreshOutcome' },
          },
        },
      ]);
      expect(pathItem.post?.responses).toHaveProperty(
        '202.$ref',
        '#/components/responses/Accepted',
      );
      expect(pathItem.post?.responses).toHaveProperty(
        '404.content.application/problem+json.schema.$ref',
        '#/components/schemas/Problem',
      );
      expect(pathItem.post?.responses).toHaveProperty(
        '404.description',
        expect.stringContaining('sheet-not-found'),
      );
    });

    it('documents bodyless dashboard refresh with its typed aggregate Operation result', () => {
      const pathItem = spec.paths[EXTERNAL_API_ROUTES.dashboardRefreshNow] as {
        post?: {
          operationId?: string;
          requestBody?: unknown;
          responses?: {
            '200'?: {
              content?: {
                'application/json'?: {
                  schema?: {
                    allOf?: Array<SpecProperty>;
                  };
                };
              };
            };
            '202'?: { $ref?: string };
            '404'?: {
              content?: { 'application/problem+json'?: { schema?: { $ref?: string } } };
              description?: string;
            };
          };
        };
      };

      expect(Object.keys(pathItem)).toEqual(['post']);
      expect(pathItem.post?.operationId).toBe('refreshDashboardNow');
      expect(pathItem.post).not.toHaveProperty('requestBody');
      expect(
        pathItem.post?.responses?.['200']?.content?.['application/json']?.schema?.allOf,
      ).toEqual([
        { $ref: '#/components/schemas/Operation' },
        {
          type: 'object',
          properties: {
            result: { $ref: '#/components/schemas/DashboardRefreshOutcome' },
          },
        },
      ]);
      expect(pathItem.post?.responses?.['202']?.$ref).toBe('#/components/responses/Accepted');
      expect(
        pathItem.post?.responses?.['404']?.content?.['application/problem+json']?.schema?.$ref,
      ).toBe('#/components/schemas/Problem');
      expect(pathItem.post?.responses?.['404']?.description).toContain('sheet-not-found');
    });

    it('documents the worksheet Show Me option discovery contract', () => {
      const pathItem = spec.paths[EXTERNAL_API_ROUTES.worksheetShowMeOptions] as {
        get?: {
          operationId?: string;
          parameters?: Array<{
            name?: string;
            in?: string;
            required?: boolean;
            schema?: SpecProperty;
          }>;
          responses?: Record<string, unknown>;
        };
      };

      expect(Object.keys(pathItem)).toEqual(['get']);
      expect(pathItem.get?.operationId).toBe('getWorksheetShowMeOptions');
      expect(pathItem.get?.parameters).toEqual([
        expect.objectContaining({
          name: 'id',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        }),
        expect.objectContaining({
          name: 'dataSource',
          in: 'query',
          required: false,
          schema: { type: 'string' },
        }),
        expect.objectContaining({
          name: 'fieldsSelectedInSchemaViewer',
          in: 'query',
          required: false,
          schema: { type: 'array', items: { type: 'string' } },
        }),
        expect.objectContaining({
          name: 'selectionMode',
          in: 'query',
          required: false,
          schema: { type: 'string', enum: ['ambient', 'explicit'] },
        }),
        { $ref: '#/components/parameters/UserAgent' },
      ]);
      expect(Object.keys(pathItem.get?.responses ?? {})).toEqual([
        '200',
        '202',
        '400',
        '401',
        '404',
        '421',
        '500',
        '503',
      ]);
      expect(pathItem.get?.responses).toHaveProperty(
        '200.content.application/json.schema.$ref',
        '#/components/schemas/ShowMeOptions',
      );
      expect(pathItem.get?.responses).toHaveProperty('202.$ref', '#/components/responses/Accepted');
      expect(pathItem.get?.responses).toHaveProperty(
        '400.content.application/problem+json.schema.$ref',
        '#/components/schemas/Problem',
      );
      expect(pathItem.get?.responses).toHaveProperty(
        '400.description',
        expect.stringContaining('invalid-query-parameter'),
      );
      expect(pathItem.get?.responses).toHaveProperty(
        '404.content.application/problem+json.schema.$ref',
        '#/components/schemas/Problem',
      );
      expect(pathItem.get?.responses).toHaveProperty(
        '404.description',
        expect.stringContaining('sheet-not-found'),
      );
    });

    it('projects observable Show Me apply rejections', () => {
      const pathItem = spec.paths['/v0/workbook/worksheets/{id}:showMe'] as {
        post?: {
          operationId?: string;
          responses?: Record<string, unknown>;
        };
      };

      expect(pathItem.post?.operationId).toBe('showMeWorksheet');
      expect(pathItem.post?.responses).toHaveProperty(
        '409.content.application/problem+json.schema.$ref',
        '#/components/schemas/Problem',
      );
      expect(pathItem.post?.responses).toHaveProperty(
        '409.description',
        expect.stringMatching(/show-me-not-applicable.*show-me-unavailable/),
      );
      expect(PROBLEM_CODES).toEqual(
        expect.arrayContaining(['show-me-not-applicable', 'show-me-unavailable']),
      );
    });
  });

  describe('Show Me option discovery provenance', () => {
    it('preserves native option ordering and the worksheet identity shape', () => {
      const result = specSchema('ShowMeOptions');

      expect(result.properties?.worksheet?.$ref).toBe('#/components/schemas/ShowMeWorksheet');
      expect(result.properties?.options?.type).toBe('array');
      expect(result.properties?.options?.items?.$ref).toBe('#/components/schemas/ShowMeOption');
      expect(result.description).toContain('native order');
    });

    it('keeps showMeType runtime-extensible and exposes only native applicability evidence', () => {
      const option = specSchema('ShowMeOption');
      const showMeType = option.properties?.showMeType;

      expect(showMeType?.$ref).toBe('#/components/schemas/ShowMeType');
      expect(showMeOptionSchema.shape.showMeType.safeParse('a-future-type').success).toBe(true);
      expect(Object.keys(option.properties ?? {})).toEqual([
        'showMeType',
        'isApplicable',
        'vizHasRequiredFields',
        'dataSourceHasRequiredFields',
        'helpUrl',
      ]);
      expect(option.properties).not.toHaveProperty('recommendation');
      expect(option.properties).not.toHaveProperty('rating');
      expect(option.properties).not.toHaveProperty('isDefault');
    });
  });

  describe('Show Me mock identity boundary', () => {
    it('accepts hidden canonical identities and declared instances while rejecting captions and fabricated instances', async () => {
      const server = await startMockExternalApiServer({
        token: 'show-me-contract-token',
        workbookXml: `<workbook><datasources>
          <datasource name="federated.hidden" caption="Hidden Source">
            <column name="[Hidden Sales]" caption="Hidden Sales" datatype="real" role="measure" type="quantitative" hidden="true" />
          </datasource>
        </datasources><worksheets><worksheet name="Hidden"><table><view>
          <datasource-dependencies datasource="federated.hidden">
            <column-instance name="[custom:Hidden Sales:qk]" column="[Hidden Sales]" />
          </datasource-dependencies>
        </view></table></worksheet></worksheets></workbook>`,
      });
      const request = async (field: string): Promise<Response> =>
        await fetch(
          `${server.baseUrl}/v0/workbook/worksheets/sheet-sales/showMe?${new URLSearchParams({ fieldsSelectedInSchemaViewer: field })}`,
          { headers: { Authorization: 'Bearer show-me-contract-token' } },
        );

      try {
        expect((await request('[federated.hidden].[Hidden Sales]')).status).toBe(200);
        expect((await request('[federated.hidden].[custom:Hidden Sales:qk]')).status).toBe(200);
        expect((await request('[Hidden Source].[Hidden Sales]')).status).toBe(400);
        expect((await request('[federated.hidden].[sum:Hidden Sales:qk]')).status).toBe(400);
      } finally {
        await server.close();
      }
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
