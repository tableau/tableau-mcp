import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { deriveFastPathBlockers, loadManifests } from '../../../desktop/binder/manifest.js';
import type { Family, TemplateManifest } from '../../../desktop/binder/manifest-types.js';
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
    expect(tool.description).toBe('List chart templates.');
    expect(tool.paramsSchema).toMatchObject({
      family: expect.any(Object),
      fastPathOnly: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({
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

  it('exposes slot purpose and examples together in template summaries', async () => {
    const body = await getBody({});
    const ranking = body.templates.find((t) => t.template === 'ranking-ordered-bar');
    expect(ranking).toBeDefined();

    expect(ranking!.slots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slot_id: 'region',
          purpose: expect.stringContaining('ranked horizontal bar'),
          examples: expect.arrayContaining(['Country', 'Product Line']),
        }),
        expect.objectContaining({
          slot_id: 'sales',
          purpose: expect.stringContaining('bar length'),
          examples: expect.arrayContaining(['Points', 'Revenue']),
        }),
      ]),
    );
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

  it('derives an honest fast_path_blocker for ineligible templates the manifest left empty', async () => {
    const ineligibleEmpty: Pick<
      TemplateManifest,
      'readiness' | 'fast_path_eligible' | 'fast_path_blockers' | 'portability_evidence'
    > = {
      readiness: 'YELLOW',
      fast_path_eligible: false,
      fast_path_blockers: [],
      portability_evidence: { fixture_bind: true, render_verified: 'none' },
    };
    expect(deriveFastPathBlockers(ineligibleEmpty)).toEqual([
      'This template has not passed live render verification.',
    ]);
  });

  it('translates every explicit blocker code into user-facing guidance', () => {
    const reasons = {
      HARDCODED_FILTER_MEMBERS:
        'This template contains fixed filter values that may not exist in the current data.',
      GENERATED_GEO_REQUIRED:
        'This template requires Tableau-generated geographic fields that the binder cannot create.',
      PSEUDO_FIELD_REQUIRED:
        'This template requires a Tableau-generated pseudo-field that the binder cannot bind.',
      PARAMETER_REQUIRED:
        'This template requires a workbook parameter that the binder cannot create or bind.',
      NO_DATASOURCE_PLACEHOLDER:
        'This template has no datasource placeholder that can be replaced safely.',
      DATASET_SPECIFIC_FORMULA:
        'This template contains a formula tied to a specific dataset and cannot be safely reused automatically.',
    } as const;

    for (const [code, reason] of Object.entries(reasons)) {
      expect(
        deriveFastPathBlockers({
          readiness: 'YELLOW',
          fast_path_eligible: false,
          fast_path_blockers: [code as TemplateManifest['fast_path_blockers'][number]],
          portability_evidence: { fixture_bind: true, render_verified: 'live-2026-07-06' },
        }),
      ).toEqual([reason]);
    }
  });

  it('derives fixture-bind and readiness causes recorded by the manifest', () => {
    expect(
      deriveFastPathBlockers({
        readiness: 'YELLOW',
        fast_path_eligible: false,
        fast_path_blockers: [],
        portability_evidence: { fixture_bind: false, render_verified: 'live-2026-07-06' },
      }),
    ).toEqual(['This template could not bind all required fields in the portability test.']);
    expect(
      deriveFastPathBlockers({
        readiness: 'RED',
        fast_path_eligible: false,
        fast_path_blockers: [],
        portability_evidence: { fixture_bind: true, render_verified: 'live-2026-07-06' },
      }),
    ).toEqual(['This template is marked not ready for use.']);
  });

  it('returns no invented reason when an ineligible flag has no recorded cause', () => {
    expect(
      deriveFastPathBlockers({
        readiness: 'YELLOW',
        fast_path_eligible: false,
        fast_path_blockers: [],
        portability_evidence: { fixture_bind: true, render_verified: 'live-2026-07-06' },
      }),
    ).toEqual([]);
  });

  it('derives no blocker for a fast-path-eligible template', () => {
    const eligible: Pick<
      TemplateManifest,
      'readiness' | 'fast_path_eligible' | 'fast_path_blockers' | 'portability_evidence'
    > = {
      readiness: 'GREEN',
      fast_path_eligible: true,
      fast_path_blockers: [],
      portability_evidence: { fixture_bind: true, render_verified: 'live-2026-07-06' },
    };
    expect(deriveFastPathBlockers(eligible)).toEqual([]);
  });

  it('every bundled ineligible template has a recorded or derivable cause', () => {
    const ineligible = allManifests.filter((m) => !m.fast_path_eligible);
    expect(ineligible.length).toBeGreaterThan(0);
    for (const m of ineligible) {
      const blockers = deriveFastPathBlockers(m);
      expect(blockers.length, `${m.template} must surface a blocker`).toBeGreaterThan(0);
      expect(
        blockers.some((reason) =>
          m.fast_path_blockers.includes(reason as TemplateManifest['fast_path_blockers'][number]),
        ),
        `${m.template} must not expose a raw blocker code`,
      ).toBe(false);
    }
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
    slots: Array<{
      slot_id: string;
      kind: string;
      required: boolean;
      bindable: boolean;
      purpose?: string;
      examples?: string[];
    }>;
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
