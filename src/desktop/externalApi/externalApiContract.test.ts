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
 * Fixture provenance: live Desktop `/openapi.json`, `info.version` 0.1.0,
 * captured 2026-07-20.
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

describe('external client API contract (captured openapi fixture)', () => {
  describe('Operation ↔ operationEnvelopeSchema', () => {
    const operation = specSchema('Operation');

    it('declares every spec property', () => {
      const missing = Object.keys(operation.properties ?? {}).filter(
        (key) => !declaredKeys(operationEnvelopeSchema).includes(key),
      );
      expect(missing).toEqual([]);
    });

    it('documents `result` as expected from apiVersion 0.1.1 even if the captured 0.1.0 spec omits it', () => {
      const extras = declaredKeys(operationEnvelopeSchema).filter(
        (key) => !(key in (operation.properties ?? {})),
      );
      const expectedExtras = operation.properties?.result ? [] : ['result'];
      expect(extras).toEqual(expectedExtras);
    });

    it('matches the spec required set exactly', () => {
      expect(requiredKeys(operationEnvelopeSchema).sort()).toEqual(
        [...(operation.required ?? [])].sort(),
      );
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
      ['ValidationResult', validationResultSchema],
    ] as const)('%s: properties and required set match', (name, schema) => {
      const component = specSchema(name);
      expect(declaredKeys(schema).sort()).toEqual(Object.keys(component.properties ?? {}).sort());
      expect(requiredKeys(schema).sort()).toEqual([...(component.required ?? [])].sort());
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
      EXTERNAL_API_ROUTES.dashboardById,
      EXTERNAL_API_ROUTES.dashboardDocument,
      EXTERNAL_API_ROUTES.storyboardById,
      EXTERNAL_API_ROUTES.storyboardDocument,
      EXTERNAL_API_ROUTES.worksheetById,
      EXTERNAL_API_ROUTES.worksheetDocument,
      EXTERNAL_API_ROUTES.worksheetSummaryData,
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
  });

  describe('envelope wire acceptance', () => {
    it('parses a full spec-shaped Operation', () => {
      const parsed = operationEnvelopeSchema.safeParse({
        id: 'op-1',
        kind: 'workbook.document.apply',
        state: 'FAILED',
        createdAt: '2026-07-20T10:00:00Z',
        completedAt: '2026-07-20T10:00:01Z',
        error: { code: 'operation-failed', message: 'nope' },
        warnings: [{ code: 'partial', message: 'one sheet skipped' }],
      });
      expect(parsed.success).toBe(true);
    });

    it('parses a 0.1.1 SUCCEEDED Operation result object and serialize-degradation warning', () => {
      const parsed = operationEnvelopeSchema.safeParse({
        id: 'op-1',
        kind: 'command.invoke',
        state: 'SUCCEEDED',
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
