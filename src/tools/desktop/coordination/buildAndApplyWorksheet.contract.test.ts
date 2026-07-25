import { normalizeObjectSchema } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';
import { z } from 'zod';

import { listTemplateNames } from '../../../desktop/templates/templatePath.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { Provider } from '../../../utils/provider.js';
import { getBuildAndApplyWorksheetTool } from './buildAndApplyWorksheet.js';

/**
 * Schema-contract tests for build-and-apply-worksheet. Deliberately in their own
 * file: the main suite mocks templates/templatePath.js, which makes the template
 * vocabulary unavailable at module load. Here the real module is used, so the
 * enum branch is exercised.
 */

async function getTaskSpecSchema(): Promise<z.ZodTypeAny> {
  const tool = getBuildAndApplyWorksheetTool(new DesktopMcpServer());
  const paramsSchema = (await Provider.from(tool.paramsSchema)) as Record<string, z.ZodTypeAny>;
  return paramsSchema['taskSpec']!;
}

const MINIMAL_SPEC = {
  worksheetName: 'Sheet 1',
  template: 'ranking-ordered-bar',
  fields: ['[Sample - Superstore].[sum:Sales:qk]'],
};

describe('build-and-apply-worksheet taskSpec contract', () => {
  it('accepts the minimal spec the implementation actually reads', async () => {
    const schema = await getTaskSpecSchema();
    expect(schema.safeParse(MINIMAL_SPEC).success).toBe(true);
  });

  // The dead worksheetFile/type fields were `z.string().optional()` /
  // `z.enum([...]).optional()`, and optional() still REJECTS an explicit null —
  // which is exactly what the agent sent. 14 production calls died with -32602
  // before the callback ran.
  it('accepts an explicit null worksheetFile (the shape production actually sent)', async () => {
    const schema = await getTaskSpecSchema();
    const result = schema.safeParse({ ...MINIMAL_SPEC, worksheetFile: null });
    expect(result.success).toBe(true);
  });

  it('accepts an explicit null type', async () => {
    const schema = await getTaskSpecSchema();
    expect(schema.safeParse({ ...MINIMAL_SPEC, type: null }).success).toBe(true);
  });

  it('accepts both dead fields as null together', async () => {
    const schema = await getTaskSpecSchema();
    const result = schema.safeParse({ ...MINIMAL_SPEC, worksheetFile: null, type: null });
    expect(result.success).toBe(true);
  });

  it('strips the dead fields rather than forwarding them', async () => {
    const schema = await getTaskSpecSchema();
    const result = schema.safeParse({ ...MINIMAL_SPEC, worksheetFile: null, type: null });
    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty('worksheetFile');
    expect(result.data).not.toHaveProperty('type');
  });

  it('still accepts an old caller that passes the dead fields with real values', async () => {
    const schema = await getTaskSpecSchema();
    const result = schema.safeParse({
      ...MINIMAL_SPEC,
      worksheetFile: '/cache/worksheet-1.xml',
      type: 'chart',
    });
    expect(result.success).toBe(true);
  });
});

describe('build-and-apply-worksheet template contract', () => {
  it('advertises the real template vocabulary as an enum on the served tools/list surface', async () => {
    const tool = getBuildAndApplyWorksheetTool(new DesktopMcpServer());
    const paramsSchema = await Provider.from(tool.paramsSchema);
    const obj = normalizeObjectSchema(paramsSchema as never);
    const json = toJsonSchemaCompat(obj!, {
      strictUnions: true,
      pipeStrategy: 'input',
    } as never) as {
      properties: { taskSpec: { properties: { template?: { enum?: string[] } } } };
    };
    const names = listTemplateNames();
    expect(names.length).toBeGreaterThan(0);
    expect(json.properties.taskSpec.properties.template?.enum).toEqual(names);
  });

  it('rejects the template ids the agent invented', async () => {
    const schema = await getTaskSpecSchema();
    for (const invented of [
      'symbol_map',
      'line',
      'map',
      'map-symbol',
      'symbol-map',
      'line-chart',
      'bar',
      'bar_chart',
      'pie',
    ]) {
      const result = schema.safeParse({ ...MINIMAL_SPEC, template: invented });
      expect(result.success, `expected "${invented}" to be rejected`).toBe(false);
    }
  });

  it('accepts every template the server can actually read', async () => {
    const schema = await getTaskSpecSchema();
    for (const name of listTemplateNames()) {
      const result = schema.safeParse({ ...MINIMAL_SPEC, template: name });
      expect(result.success, `expected "${name}" to be accepted`).toBe(true);
    }
  });

  it('keeps template optional (the tool raises its own actionable error when absent)', async () => {
    const schema = await getTaskSpecSchema();
    const { template: _omitted, ...withoutTemplate } = MINIMAL_SPEC;
    expect(schema.safeParse(withoutTemplate).success).toBe(true);
  });
});
