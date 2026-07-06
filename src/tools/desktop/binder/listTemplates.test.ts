import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { loadManifests } from '../../../desktop/binder/manifest.js';
import type { Family } from '../../../desktop/binder/manifest-types.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getListTemplatesTool } from './listTemplates.js';

// Exercises the tool against the REAL bundled provider (the data ships in-repo, so this
// stays hermetic) — proving list-templates is a genuine consumer of the milestone-1
// AuthoringIntelligenceProvider seam, not a raw loadManifests() reader.

const allManifests = [...loadManifests().values()];

describe('listTemplatesTool', () => {
  it('should create a tool instance with correct properties', () => {
    const tool = getListTemplatesTool(new DesktopMcpServer());
    expect(tool.name).toBe('list-templates');
    expect(tool.description).toContain('fast-path');
    expect(tool.paramsSchema).toMatchObject({
      family: expect.any(Object),
      fastPathOnly: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({
      title: 'List Bundled Chart Templates',
      readOnlyHint: true,
      openWorldHint: false,
    });
  });

  it('lists the full bundled set with an HONEST bundled-snapshot status', async () => {
    const body = await getBody({});
    expect(body.total).toBe(allManifests.length);
    expect(body.count).toBe(allManifests.length);
    expect(body.templates).toHaveLength(allManifests.length);
    // Freshness is surfaced honestly through the provider seam.
    expect(body.status.kind).toBe('bundled');
    expect(body.status.freshness).toBe('bundled-snapshot');
    expect(body.status.satisfies_exec_freshness).toBe(false);
    expect(body.status.content_version).toMatch(/^\d+\.\d+\.\d+\+content\.\d{4}-\d{2}-\d{2}$/);
  });

  it('summarizes each template with family / slots / fast-path status', async () => {
    const body = await getBody({});
    for (const t of body.templates) {
      expect(typeof t.family).toBe('string');
      expect(typeof t.fast_path_eligible).toBe('boolean');
      expect(Array.isArray(t.slots)).toBe(true);
      for (const s of t.slots) {
        expect(typeof s.slot_id).toBe('string');
        expect(typeof s.kind).toBe('string');
        expect(typeof s.required).toBe('boolean');
        expect(typeof s.bindable).toBe('boolean');
      }
    }
    // Templates come back sorted by name for a stable listing.
    const names = body.templates.map((t) => t.template);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('filters to a single family when family is provided', async () => {
    const expected = allManifests.filter((m) => m.family === 'ranking').map((m) => m.template);
    expect(expected.length).toBeGreaterThan(0); // guard the fixture assumption

    const body = await getBody({ family: 'ranking' });
    expect(body.count).toBe(expected.length);
    expect(body.templates.every((t) => t.family === 'ranking')).toBe(true);
    expect(body.count).toBeLessThan(body.total);
  });

  it('filters to fast-path-eligible templates when fastPathOnly is true', async () => {
    const expectedFastPath = allManifests.filter((m) => m.fast_path_eligible).length;
    expect(expectedFastPath).toBeGreaterThan(0); // guard the fixture assumption

    const body = await getBody({ fastPathOnly: true });
    expect(body.count).toBe(expectedFastPath);
    expect(body.fastPathCount).toBe(expectedFastPath);
    expect(body.templates.every((t) => t.fast_path_eligible)).toBe(true);
  });

  it('rejects an out-of-taxonomy family at the schema layer (fail-open watch-class guard)', async () => {
    // A bare-string family filter would parse a typo and silently return an empty
    // list; the closed z.enum(FAMILY_VALUES) rejects it so the mistake fails closed.
    const tool = getListTemplatesTool(new DesktopMcpServer());
    const schema = z.object(await Provider.from(tool.paramsSchema));
    expect(schema.safeParse({ family: 'timeseries' }).success).toBe(false);
    expect(schema.safeParse({ family: 'time-series' }).success).toBe(true);
    // Both filters are optional — an empty payload lists everything.
    expect(schema.safeParse({}).success).toBe(true);
  });
});

async function getBody(args: { family?: Family; fastPathOnly?: boolean }): Promise<{
  status: {
    kind: string;
    freshness: string;
    satisfies_exec_freshness: boolean;
    content_version: string;
  };
  total: number;
  count: number;
  fastPathCount: number;
  templates: Array<{
    template: string;
    family: string;
    fast_path_eligible: boolean;
    slots: Array<{ slot_id: string; kind: string; required: boolean; bindable: boolean }>;
  }>;
}> {
  const result = await getToolResult(args);
  expect(result.isError).toBe(false);
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text);
}

async function getToolResult(args: {
  family?: Family;
  fastPathOnly?: boolean;
}): Promise<CallToolResult> {
  const tool = getListTemplatesTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  // ShapeOutput requires every key present (values may be undefined), so pass both.
  return await callback(
    { family: args.family, fastPathOnly: args.fastPathOnly },
    getMockRequestHandlerExtra(),
  );
}
