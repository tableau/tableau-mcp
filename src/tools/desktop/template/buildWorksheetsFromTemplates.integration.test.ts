import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { getTemplateArtifactStore } from '../../../desktop/templates/templateArtifactStore.js';
import { listTemplateCatalog } from '../../../desktop/templates/templatePath.js';
import { resolveTemplateSnapshot } from '../../../desktop/templates/templateSlots.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getBuildWorksheetsFromTemplatesTool } from './buildWorksheetsFromTemplates.js';

const WORKBOOK_FILE = resolve(
  'src/tools/desktop/data-source/__fixtures__/real-superstore-document.twb.xml',
);
const DATASOURCE = 'Sample - Superstore';

type BuildCase = {
  templateName: string;
  title: string;
  fieldMapping: Record<string, string>;
  expectedXml: string[];
};

const cases: BuildCase[] = [
  {
    templateName: 'trend-line-chart',
    title: 'Profit Over Time Integration',
    fieldMapping: {
      profit: '[Sample - Superstore].[sum:Profit:qk]',
      order_date: '[Sample - Superstore].[tmn:Order Date:qk]',
      product_name: '[Sample - Superstore].[none:Category:nk]',
    },
    expectedXml: ['sum:Profit:qk', 'tmn:Order Date:qk', 'none:Category:nk'],
  },
  {
    templateName: 'correlation-bubble-chart',
    title: 'Sales Profit Quantity Bubble Integration',
    fieldMapping: {
      profit: '[Sample - Superstore].[avg:Profit:qk]',
      sales: '[Sample - Superstore].[sum:Sales:qk]',
      quantity: '[Sample - Superstore].[sum:Quantity:qk]',
      customer_name: '[Sample - Superstore].[none:Customer Name:nk]',
    },
    expectedXml: ['avg:Profit:qk', 'sum:Sales:qk', 'sum:Quantity:qk', 'none:Customer Name:nk'],
  },
];

const externalFormulaCases = (['custom', 'bookmark', 'overridable'] as const).flatMap(
  (provenance) =>
    [
      'SCRIPT_REAL // comment&#10; (&quot;return 1&quot;, [Sales])',
      'MODEL_EXTENSION_REAL /* comment */ (&quot;model&quot;, &quot;endpoint&quot;, [Sales])',
      'RAWSQL_REAL // comment&#13;&#10; (&quot;select value&quot;, [Sales])',
      'RAWSQLAGG_REAL /* comment */ (&quot;select value&quot;, [Sales])',
    ].map((formula) => ({ provenance, formula })),
);

describe('build-worksheets-from-templates — live-shaped protected template flow', () => {
  it.each(cases)(
    'lists, resolves, explicitly binds, and constructs $templateName from one top-level templateName',
    async ({ templateName, title, fieldMapping, expectedXml }) => {
      const catalogEntry = listTemplateCatalog().find(
        (entry) => entry.template === templateName && entry.provenance === 'protected',
      );
      expect(catalogEntry).toBeDefined();

      const snapshot = resolveTemplateSnapshot(templateName, { catalogEntry });
      expect(snapshot).not.toBeNull();
      expect(snapshot!.artifact.eligibility.pass1_eligible).toBe(true);
      expect(snapshot!.resolvedManifest?.manifest.slots.length).toBeGreaterThan(0);

      const server = new DesktopMcpServer();
      const tool = getBuildWorksheetsFromTemplatesTool(server);
      expect(Object.keys(tool.paramsSchema)).toContain('templateName');
      expect(Object.keys(tool.paramsSchema)).not.toContain('templates');
      const callback = await Provider.from(tool.callback);
      const result: CallToolResult = await callback(
        {
          workbookFile: WORKBOOK_FILE,
          session: undefined,
          templateName,
          title,
          datasource: DATASOURCE,
          fieldMapping,
        },
        getMockRequestHandlerExtra(),
      );

      expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
      invariant(result.content[0].type === 'text');
      const body = JSON.parse(result.content[0].text) as {
        artifactId: string;
        templateName: string;
        preview: { worksheetName: string; fieldMapping: Record<string, string> };
      };
      expect(body.templateName).toBe(templateName);
      expect(body.preview.worksheetName).toBe(title);
      expect(Object.values(body.preview.fieldMapping).sort()).toEqual(
        Object.values(fieldMapping).sort(),
      );

      const stored = getTemplateArtifactStore(server).consume(body.artifactId, 'offline-test');
      expect(stored.ok).toBe(true);
      if (!stored.ok) return;
      expect(stored.artifact.worksheetXml).not.toMatch(/\{\{field_base_\d+\}\}/);
      for (const expected of expectedXml) {
        expect(stored.artifact.worksheetXml).toContain(expected);
      }
    },
  );

  it.each(externalFormulaCases)(
    'creates no artifact when a $provenance bookmark carrying $formula shadows a protected name',
    { timeout: 30_000 },
    async ({ provenance, formula }) => {
      const originalRepositoryDir = process.env['TABLEAU_REPOSITORY_DIR'];
      const originalTemplatesDir = process.env['TEMPLATES_DIR'];
      const root = mkdtempSync(join(process.cwd(), 'tmp-malicious-template-repository-'));
      const source =
        provenance === 'custom'
          ? join(root, 'Tableau Agent', 'templates')
          : provenance === 'bookmark'
            ? join(root, 'Bookmarks')
            : join(root, 'Tableau Agent', 'templates', '.vendored', 'overridable');
      mkdirSync(source, { recursive: true });
      writeFileSync(
        join(source, 'correlation-bubble-chart.tbm'),
        "<bookmark><datasources><datasource name='d'>" +
          "<column name='[Sales]' datatype='real' role='measure' type='quantitative'/>" +
          "<column name='[Calculation_1]' datatype='real' role='measure' type='quantitative'>" +
          `<calculation class='tableau' formula='${formula}'/>` +
          '</column></datasource></datasources>' +
          '<table><cols>[d].[sum:Sales:qk]</cols></table></bookmark>',
      );
      process.env['TABLEAU_REPOSITORY_DIR'] = root;
      delete process.env['TEMPLATES_DIR'];

      try {
        const server = new DesktopMcpServer();
        const putArtifact = vi.spyOn(getTemplateArtifactStore(server), 'put');
        const tool = getBuildWorksheetsFromTemplatesTool(server);
        const callback = await Provider.from(tool.callback);
        const result = await callback(
          {
            workbookFile: WORKBOOK_FILE,
            session: undefined,
            templateName: 'correlation-bubble-chart',
            title: 'Blocked custom bubble',
            datasource: DATASOURCE,
            fieldMapping: { metric: '[Sample - Superstore].[sum:Sales:qk]' },
          },
          getMockRequestHandlerExtra(),
        );

        expect(result.isError).toBe(true);
        invariant(result.content[0].type === 'text');
        expect(result.content[0].text).toContain(`from ${provenance} is not supported`);
        expect(putArtifact).not.toHaveBeenCalled();
      } finally {
        rmSync(root, { recursive: true, force: true });
        if (originalRepositoryDir === undefined) delete process.env['TABLEAU_REPOSITORY_DIR'];
        else process.env['TABLEAU_REPOSITORY_DIR'] = originalRepositoryDir;
        if (originalTemplatesDir === undefined) delete process.env['TEMPLATES_DIR'];
        else process.env['TEMPLATES_DIR'] = originalTemplatesDir;
      }
    },
  );
});
