import { z } from 'zod';

import { DesktopMcpServer } from '../../../../server.desktop.js';
import { Provider } from '../../../../utils/provider.js';

/**
 * The template enum is built at MODULE LOAD from an asset-backed listing. Two ways
 * that can go wrong, and both would take the whole binary down rather than one call:
 * the listing returns nothing (z.enum([]) throws), or the listing itself throws (no
 * embedded assets, a corrupt SEA manifest). Both must degrade to a free string.
 */

const listing = { mode: 'empty' as 'empty' | 'throws' };

vi.mock('../../../../desktop/templates/templatePath.js', () => ({
  listTemplateNames: (): string[] => {
    if (listing.mode === 'throws') {
      throw new Error("SEA asset listing 'asset-manifest.json' is missing or unreadable");
    }
    return [];
  },
  readTemplate: (): string | null => null,
  getTemplatePath: (): string => '',
  getTemplatesDir: (): string => '',
}));

async function loadTaskSpecSchema(): Promise<z.ZodTypeAny> {
  vi.resetModules();
  const { getBuildAndApplyWorksheetTool } = await import('./buildAndApplyWorksheet.js');
  const tool = getBuildAndApplyWorksheetTool(new DesktopMcpServer());
  const paramsSchema = (await Provider.from(tool.paramsSchema)) as Record<string, z.ZodTypeAny>;
  return paramsSchema['taskSpec']!;
}

const SPEC = { worksheetName: 'Sheet 1', fields: ['[DS].[sum:Sales:qk]'] };

describe('build-and-apply-worksheet template enum fallback', () => {
  it('loads and accepts any template string when the listing is empty', async () => {
    listing.mode = 'empty';
    const schema = await loadTaskSpecSchema();
    expect(schema.safeParse({ ...SPEC, template: 'anything-at-all' }).success).toBe(true);
  });

  it('loads and accepts any template string when the listing throws', async () => {
    listing.mode = 'throws';
    const schema = await loadTaskSpecSchema();
    expect(schema.safeParse({ ...SPEC, template: 'anything-at-all' }).success).toBe(true);
  });
});
