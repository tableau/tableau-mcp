/**
 * Shipped-asset completeness invariants.
 *
 * The day-1 Laulima dogfood (2026-07-09) hit "Template 'ww-ou-diff' not found"
 * live because the product catalog and the apply path disagreed about what was
 * loadable. TBMs are now the sole template artifact, so this suite exercises the
 * runtime catalog directly and keeps the knowledge-corpus coverage.
 */
import { existsSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

import { getDataRoot, getResourcesRoot } from './assets.js';
import { loadRuntimeTemplateCatalogSnapshots } from './templates/runtimeTemplateCatalog.js';

function countFilesRecursively(dir: string, suffix: string): number {
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      count += countFilesRecursively(join(dir, entry.name), suffix);
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      count += 1;
    }
  }
  return count;
}

describe('desktop vendored assets', () => {
  const runtimeCatalog = loadRuntimeTemplateCatalogSnapshots();

  it('loads the full shipped TBM corpus into coherent runtime snapshots', () => {
    expect(runtimeCatalog.size).toBeGreaterThanOrEqual(133);
    const incoherent = [...runtimeCatalog].flatMap(([template, value]) =>
      value.snapshot.template === template &&
      value.descriptor.template === template &&
      value.snapshot.xml.includes('<workbook')
        ? []
        : [template],
    );
    expect(incoherent).toEqual([]);
  });

  it('derives runtime XML windows without focus-restoring active/maximized flags', () => {
    const flaggedWindows = [...runtimeCatalog].flatMap(([template, { snapshot }]) =>
      Array.from(snapshot.xml.matchAll(/<windows\b[\s\S]*?<\/windows>/g)).flatMap((section) =>
        Array.from(section[0].matchAll(/<window\b[^>]*(?:\bactive=|\bmaximized=)[^>]*>/g)).map(
          (match) => `${template}: ${match[0]}`,
        ),
      ),
    );

    expect(flaggedWindows).toEqual([]);
  });

  it('keeps the generic Insights KPI visually aligned with the donor bookmark', () => {
    const kpi = loadRuntimeTemplateCatalogSnapshots({
      automaticOnly: true,
      additionalTemplates: ['insights__kpi'],
    }).get('insights__kpi');

    expect(kpi).toBeDefined();
    expect(kpi?.snapshot.xml).toContain("<mark class='Text' />");
    expect(kpi?.snapshot.xml).not.toContain("<zoom type='entire-view' />");
    expect(kpi?.snapshot.xml).toContain('<cols>[{{DATASOURCE}}].[none:{{field_base_1}}:nk]</cols>');
    expect(kpi?.snapshot.xml).toContain("fontcolor='#898989' fontsize='12'>{{METRIC_NAME}}");
    expect(kpi?.snapshot.xml).toContain("value='{{VALUE_FORMAT}}'");
    expect(kpi?.snapshot.xml).toContain("fontname='Tableau Medium' fontsize='24'");
    expect(kpi?.snapshot.xml).toContain('<run>Æ&#10;</run>');
    expect(kpi?.snapshot.xml).toContain("<format attr='text-align' value='left' />");
    expect(kpi?.snapshot.xml).toContain('PREVIOUS PERIOD | {{COMPARISON_PERIOD_CONTEXT}} | ');
    expect(kpi?.snapshot.xml).toContain('&lt;[{{DATASOURCE}}].[sum:{{field_base_3}}:qk]&gt;');
    expect(kpi?.snapshot.xml).toContain('CHANGE FROM PREVIOUS PERIOD | ');
    expect(kpi?.snapshot.xml).not.toContain('ABSOLUTE CHANGE | ');
    expect(kpi?.snapshot.xml).not.toContain('PREVIOUS VALUE | ');
  });

  it('vendors a non-trivial knowledge corpus', () => {
    // The pre-sync snapshot was 16 stale files; the canonical corpus is ~90.
    // A floor of 80 catches a regression to a partial copy without pinning
    // the exact count on every upstream knowledge addition.
    // Under vitest, getResourcesRoot() candidates may not exist (safeDirname is
    // src/utils); fall back to the source-tree resources root beside the repo root.
    const resourcesRoot = existsSync(getResourcesRoot())
      ? getResourcesRoot()
      : resolve(getDataRoot(), '..', '..', '..', 'resources', 'desktop');
    const knowledgeDir = join(resourcesRoot, 'knowledge');
    expect(countFilesRecursively(knowledgeDir, '.md')).toBeGreaterThanOrEqual(80);
  });
});
