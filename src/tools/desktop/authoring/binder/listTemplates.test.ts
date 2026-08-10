import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

import {
  listTemplateCatalog,
  readBookmarkFromCatalogEntry,
} from '../../../../desktop/templates/templatePath.js';
import { createTemplateRuntimeSnapshot } from '../../../../desktop/templates/templateRuntimeSnapshot.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getListTemplatesTool } from './listTemplates.js';

const BOOKMARK =
  "<?xml version='1.0'?><bookmark version='10.1'>" +
  '<datasources>' +
  "<datasource name='federated.secret' caption='Donor Datasource Secret'>" +
  "<column name='[Donor Measure Secret]' datatype='real' role='measure' type='quantitative'/>" +
  "<column name='[Donor Dimension Secret]' datatype='string' role='dimension' type='nominal'/>" +
  '</datasource>' +
  '</datasources>' +
  '<table>' +
  '<rows>[federated.secret].[none:Donor Dimension Secret:nk]</rows>' +
  '<cols>[federated.secret].[sum:Donor Measure Secret:qk]</cols>' +
  '</table>' +
  '</bookmark>';

const PASS1_BLOCKED_BOOKMARK = BOOKMARK.replace(
  '</table>',
  "<column-instance column='[Donor Measure Secret]' derivation='Sum' " +
    "name='[sum:Donor Measure Secret:qk]' pivot='key' type='quantitative'>" +
    "<table-calc ordering-type='Field' ordering-field='[federated.secret].[Donor Dimension Secret]'/>" +
    '</column-instance></table>',
);

describe('list-templates', () => {
  const originalTemplatesDir = process.env['TEMPLATES_DIR'];
  const temporaryRoots: string[] = [];

  afterEach(() => {
    if (originalTemplatesDir === undefined) delete process.env['TEMPLATES_DIR'];
    else process.env['TEMPLATES_DIR'] = originalTemplatesDir;
    for (const root of temporaryRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function catalog(names: string[]): void {
    const root = mkdtempSync(join(process.cwd(), 'tmp-list-templates-'));
    temporaryRoots.push(root);
    for (const name of names) writeFileSync(join(root, `${name}.tbm`), BOOKMARK);
    process.env['TEMPLATES_DIR'] = root;
  }

  it('is a read-only, caller-neutral catalog tool', () => {
    const tool = getListTemplatesTool(new DesktopMcpServer());
    expect(tool.name).toBe('list-templates');
    expect(tool.description).toBe('Search available worksheet templates.');
    expect(tool.paramsSchema).toMatchObject({
      query: expect.any(Object),
      cursor: expect.any(Object),
      limit: expect.any(Object),
      includeSlots: expect.any(Object),
      pass1EligibleOnly: expect.any(Object),
    });
    expect(tool.paramsSchema).not.toHaveProperty('family');
    expect(tool.paramsSchema).not.toHaveProperty('fastPathOnly');
    expect(tool.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    });
  });

  it('searches template IDs and paginates in deterministic ID order', async () => {
    catalog(['zeta-chart', 'beta-chart', 'alpha-chart']);

    const first = await getBody({ limit: 2 });
    expect(first.total).toBe(3);
    expect(first.candidateCount).toBe(3);
    expect(first.scanned).toBe(2);
    expect(first.templates.map((template: { template: string }) => template.template)).toEqual([
      'alpha-chart',
      'beta-chart',
    ]);
    expect(first.nextCursor).toBe('beta-chart');

    const second = await getBody({ limit: 2, cursor: first.nextCursor });
    expect(second.templates.map((template: { template: string }) => template.template)).toEqual([
      'zeta-chart',
    ]);
    expect(second.nextCursor).toBeNull();

    const searched = await getBody({ query: 'BETA', limit: 10 });
    expect(searched.templates.map((template: { template: string }) => template.template)).toEqual([
      'beta-chart',
    ]);
  });

  it('finds and ranks template IDs from natural chart-shape queries', async () => {
    catalog([
      'magnitude-horizontal-bar',
      'ranking-ordered-bar',
      'ranking-ordered-column',
      'spatial-choropleth-map',
    ]);

    const horizontal = await getBody({ query: 'ranked horizontal bar', limit: 4 });
    expect(horizontal.templates[0].template).toBe('ranking-ordered-bar');

    const vertical = await getBody({ query: 'ranked vertical bar', limit: 4 });
    expect(vertical.templates[0].template).toBe('ranking-ordered-column');

    const map = await getBody({ query: 'choropleth map filled state', limit: 4 });
    expect(map.templates[0].template).toBe('spatial-choropleth-map');
  });

  it('prefers whole-token matches over broader ID substrings', async () => {
    catalog([
      'connected-scatterplot',
      'correlation-scatter-plot-chart',
      'specialized__connected-scatter',
    ]);

    const wholeToken = await getBody({ query: 'scatter', limit: 10 });
    expect(wholeToken.templates.map((template: { template: string }) => template.template)).toEqual(
      ['correlation-scatter-plot-chart'],
    );

    const exact = await getBody({ query: 'connected-scatterplot', limit: 10 });
    expect(exact.templates.map((template: { template: string }) => template.template)).toEqual([
      'connected-scatterplot',
    ]);

    const compoundToken = await getBody({ query: 'scatterplot', limit: 10 });
    expect(
      compoundToken.templates.map((template: { template: string }) => template.template),
    ).toEqual(['connected-scatterplot']);
  });

  it('hides the specialized rate choropleth behind the canonical map for a generic query', async () => {
    catalog([
      'spatial-choropleth-map',
      'spatial__choropleth__map-rates-or-ratios-by-region',
      'spatial__hexbin-map__aggregate-geography-into-equal-hex-cells',
    ]);

    const generic = await getBody({ query: 'choropleth map', limit: 10 });
    expect(generic.templates.map((template: { template: string }) => template.template)).toEqual([
      'spatial-choropleth-map',
    ]);

    const shortGeneric = await getBody({ query: 'choropleth', limit: 10 });
    expect(
      shortGeneric.templates.map((template: { template: string }) => template.template),
    ).toEqual(['spatial-choropleth-map']);

    const explicit = await getBody({
      query: 'spatial__choropleth__map-rates-or-ratios-by-region',
      limit: 10,
    });
    expect(explicit.templates.map((template: { template: string }) => template.template)).toEqual([
      'spatial__choropleth__map-rates-or-ratios-by-region',
    ]);

    const specialized = await getBody({ query: 'hexbin map', limit: 10 });
    expect(specialized.templates[0].template).toBe(
      'spatial__hexbin-map__aggregate-geography-into-equal-hex-cells',
    );

    const rateSpecialized = await getBody({ query: 'rate choropleth', limit: 10 });
    expect(rateSpecialized.templates[0].template).toBe(
      'spatial__choropleth__map-rates-or-ratios-by-region',
    );
  });

  it('returns factual compact provenance and computed eligibility without structural internals', async () => {
    catalog(['safe-bar']);

    const body = await getBody({});
    expect(body.templates).toEqual([
      {
        template: 'safe-bar',
        provenance: 'dev-override',
        overridesLowerPrecedence: false,
        pass1_eligible: true,
        pass1_blockers: [],
        slot_signature: {
          total: 2,
          required: 2,
          kinds: ['categorical', 'quantitative'],
          required_slots: [
            {
              slot_id: 'field_base_1',
              kind: 'categorical',
            },
            {
              slot_id: 'field_base_2',
              kind: 'quantitative',
            },
          ],
        },
      },
    ]);
    expect(JSON.stringify(body)).not.toMatch(
      /Donor Measure Secret|Donor Dimension Secret|Donor Datasource Secret|<bookmark|<worksheet|formula/i,
    );
  });

  it('returns bounded structural slot facts for one requested detail row', async () => {
    catalog(['safe-bar']);

    const result = await getToolResult({ includeSlots: true, limit: 1 });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(Buffer.byteLength(result.content[0].text, 'utf-8')).toBeLessThanOrEqual(12_288);
    const body = JSON.parse(result.content[0].text);
    expect(body.templates[0].slots).toEqual([
      expect.objectContaining({
        slot_id: 'field_base_1',
        kind: 'categorical',
        derivation: 'none',
        required: true,
        role: ['rows'],
      }),
      expect.objectContaining({
        slot_id: 'field_base_2',
        kind: 'quantitative',
        derivation: 'sum',
        required: true,
        role: ['cols'],
      }),
    ]);
    expect(result.content[0].text).not.toMatch(
      /Donor Measure Secret|Donor Dimension Secret|Donor Datasource Secret|template_field|hint|formula|<bookmark|<worksheet/i,
    );
  });

  it('defaults a detail lookup to one result when limit is omitted', async () => {
    catalog(['safe-bar']);

    const result = await getToolResult({ query: 'safe-bar', includeSlots: true });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.templates).toHaveLength(1);
    expect(body.templates[0].slots).toHaveLength(2);
  });

  it('returns semantic roles for neutral geo slots from a real choropleth TBM', async () => {
    delete process.env['TEMPLATES_DIR'];

    const body = await getBody({
      query: 'spatial-choropleth-map',
      includeSlots: true,
      limit: 1,
    });

    expect(body.templates).toHaveLength(1);
    expect(body.templates[0].slots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slot_id: 'field_base_2',
          kind: 'geo',
          semantic_role: '[Country].[ISO3166_2]',
        }),
        expect.objectContaining({
          slot_id: 'field_base_3',
          kind: 'geo',
          semantic_role: '[State].[Name]',
        }),
      ]),
    );
  });

  it('includes required slot IDs and semantic roles in a compact real-template result', async () => {
    delete process.env['TEMPLATES_DIR'];

    const body = await getBody({ query: 'spatial-choropleth-map', limit: 1 });

    expect(body.templates[0].slot_signature.required_slots).toEqual(
      expect.arrayContaining([
        {
          slot_id: 'field_base_1',
          kind: 'quantitative',
        },
        {
          slot_id: 'field_base_2',
          kind: 'geo',
          semantic_role: '[Country].[ISO3166_2]',
        },
        {
          slot_id: 'field_base_3',
          kind: 'geo',
          semantic_role: '[State].[Name]',
        },
      ]),
    );
  });

  it('filters on eligibility computed from the TBM instead of catalog policy', async () => {
    const root = mkdtempSync(join(process.cwd(), 'tmp-list-templates-eligibility-'));
    temporaryRoots.push(root);
    writeFileSync(join(root, 'eligible.tbm'), BOOKMARK);
    writeFileSync(join(root, 'blocked.tbm'), PASS1_BLOCKED_BOOKMARK);
    process.env['TEMPLATES_DIR'] = root;

    const all = await getBody({ limit: 10 });
    expect(all.templates.map((template: { template: string }) => template.template)).toEqual([
      'blocked',
      'eligible',
    ]);
    expect(
      all.templates.find((template: { template: string }) => template.template === 'blocked'),
    ).toMatchObject({
      pass1_eligible: false,
      pass1_blockers: [expect.stringContaining('unresolved-table-calc-bareRefs')],
    });

    const eligibleOnly = await getBody({ limit: 10, pass1EligibleOnly: true });
    expect(
      eligibleOnly.templates.map((template: { template: string }) => template.template),
    ).toEqual(['eligible']);
  });

  it('examines only the requested candidate page when filtering for pass-1 eligibility', async () => {
    catalog(Array.from({ length: 51 }, (_, index) => `chart-${String(index).padStart(2, '0')}`));
    let resolutions = 0;
    const tool = getListTemplatesTool(new DesktopMcpServer(), {
      listCatalog: () => listTemplateCatalog(),
      resolve: (entry) => {
        resolutions += 1;
        const bookmark = readBookmarkFromCatalogEntry(entry);
        return bookmark === null ? null : createTemplateRuntimeSnapshot(entry.template, bookmark);
      },
    });

    const first = await getBodyFromTool(tool, { limit: 1, pass1EligibleOnly: true });
    expect(resolutions).toBe(1);
    expect(first).toMatchObject({ candidateCount: 51, scanned: 1, count: 1 });
    expect(first.nextCursor).toBe('chart-00');

    const second = await getBodyFromTool(tool, {
      limit: 1,
      cursor: first.nextCursor,
      pass1EligibleOnly: true,
    });
    expect(resolutions).toBe(2);
    expect(second).toMatchObject({ candidateCount: 51, scanned: 1, count: 1 });
    expect(second.nextCursor).toBe('chart-01');
  });

  it('advances an eligibility-filtered page even when its examined candidate is ineligible', async () => {
    const root = mkdtempSync(join(process.cwd(), 'tmp-list-templates-filtered-page-'));
    temporaryRoots.push(root);
    writeFileSync(join(root, 'blocked.tbm'), PASS1_BLOCKED_BOOKMARK);
    writeFileSync(join(root, 'eligible.tbm'), BOOKMARK);
    process.env['TEMPLATES_DIR'] = root;

    const first = await getBody({ limit: 1, pass1EligibleOnly: true });
    expect(first).toMatchObject({ candidateCount: 2, scanned: 1, count: 0 });
    expect(first.templates).toEqual([]);
    expect(first.nextCursor).toBe('blocked');

    const second = await getBody({
      limit: 1,
      cursor: first.nextCursor,
      pass1EligibleOnly: true,
    });
    expect(second).toMatchObject({ candidateCount: 2, scanned: 1, count: 1 });
    expect(second.templates.map((template: { template: string }) => template.template)).toEqual([
      'eligible',
    ]);
    expect(second.nextCursor).toBeNull();
  });

  it('rejects unbounded detail and a cursor outside the filtered result', async () => {
    catalog(['alpha-chart', 'beta-chart']);

    const unbounded = await getToolResult({ includeSlots: true, limit: 2 });
    expect(unbounded.isError).toBe(true);
    expect(unbounded.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('includeSlots requires limit=1'),
    });

    const badCursor = await getToolResult({ cursor: 'missing-chart' });
    expect(badCursor.isError).toBe(true);
    expect(badCursor.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Invalid template cursor'),
    });
  });

  it('keeps compact pages under the response byte limit', async () => {
    catalog(
      Array.from(
        { length: 50 },
        (_, index) => `chart-${String(index).padStart(2, '0')}-${'x'.repeat(140)}`,
      ),
    );

    const result = await getToolResult({ limit: 50 });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(Buffer.byteLength(result.content[0].text, 'utf-8')).toBeLessThanOrEqual(16_384);
    const body = JSON.parse(result.content[0].text);
    expect(body.count).toBeGreaterThan(0);
    expect(body.nextCursor).not.toBeNull();
  });

  it('reports invalid winning entries without exposing a lower-tier fallback', async () => {
    const root = mkdtempSync(join(process.cwd(), 'tmp-list-templates-repository-'));
    temporaryRoots.push(root);
    mkdirSync(join(root, 'Tableau Agent', 'templates', '.vendored', 'overridable'), {
      recursive: true,
    });
    writeFileSync(
      join(root, 'Tableau Agent', 'templates', '.vendored', 'overridable', 'shared.tbm'),
      BOOKMARK,
    );
    writeFileSync(join(root, 'Tableau Agent', 'templates', 'shared.tbm'), '<broken/>');
    delete process.env['TEMPLATES_DIR'];
    const originalRepositoryDir = process.env['TABLEAU_REPOSITORY_DIR'];
    process.env['TABLEAU_REPOSITORY_DIR'] = root;
    try {
      const body = await getBody({ query: 'shared' });
      expect(body.templates).toEqual([]);
      expect(body.diagnostics.templates).toEqual([
        {
          template: 'shared',
          provenance: 'custom',
          issue: 'invalid-or-unreadable',
        },
      ]);
    } finally {
      if (originalRepositoryDir === undefined) delete process.env['TABLEAU_REPOSITORY_DIR'];
      else process.env['TABLEAU_REPOSITORY_DIR'] = originalRepositoryDir;
    }
  });

  it('bounds malformed-name diagnostics without hiding valid templates', async () => {
    const root = mkdtempSync(join(process.cwd(), 'tmp-list-templates-malformed-names-'));
    temporaryRoots.push(root);
    writeFileSync(join(root, '.tbm'), BOOKMARK);
    for (let index = 0; index < 24; index += 1) {
      writeFileSync(join(root, `bad\\name-${String(index).padStart(2, '0')}.tbm`), BOOKMARK);
    }
    writeFileSync(join(root, 'valid.tbm'), BOOKMARK);
    process.env['TEMPLATES_DIR'] = root;

    const body = await getBody({ limit: 1 });
    expect(body.templates.map((template: { template: string }) => template.template)).toEqual([
      'valid',
    ]);
    expect(body.diagnostics).toMatchObject({ count: 25, returned: 20, truncated: true });
    expect(body.diagnostics.templates).toHaveLength(20);
    expect(body.diagnostics.templates[0]).toMatchObject({ issue: 'invalid-name' });
  });
});

type ListArgs = {
  query?: string;
  cursor?: string;
  limit?: number;
  includeSlots?: boolean;
  pass1EligibleOnly?: boolean;
};

async function getBody(args: ListArgs): Promise<any> {
  const result = await getToolResult(args);
  expect(result.isError).toBe(false);
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text);
}

async function getBodyFromTool(
  tool: ReturnType<typeof getListTemplatesTool>,
  args: ListArgs,
): Promise<any> {
  const callback = await Provider.from(tool.callback);
  const result = await callback(args as never, getMockRequestHandlerExtra());
  expect(result.isError).toBe(false);
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text);
}

async function getToolResult(args: ListArgs): Promise<CallToolResult> {
  const tool = getListTemplatesTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(args as never, getMockRequestHandlerExtra());
}
