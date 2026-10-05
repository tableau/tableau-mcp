/**
 * Shipped-asset completeness invariants.
 *
 * The day-1 Laulima dogfood (2026-07-09) hit "Template 'ww-ou-diff' not found"
 * live because the product catalog and the apply path disagreed about what was
 * loadable. TBMs are now the sole template artifact, so this suite exercises the
 * runtime catalog directly and keeps the knowledge-corpus coverage.
 */
import { loadRuntimeTemplateCatalogSnapshots } from './templates/runtimeTemplateCatalog.js';

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
    expect(kpi?.snapshot.xml).toContain('<cols />');
    expect(kpi?.snapshot.xml).toContain(
      "<tooltip column='[{{DATASOURCE}}].[attr:{{field_base_1}}:nk]' />",
    );
    expect(kpi?.snapshot.xml).toContain("fontcolor='#898989' fontsize='12'>{{METRIC_NAME}}");
    expect(kpi?.snapshot.xml.match(/value='\{\{VALUE_FORMAT\}\}'/g)).toHaveLength(2);
    expect(kpi?.snapshot.xml).toContain("fontname='Tableau Medium' fontsize='24'");
    expect(kpi?.snapshot.xml).toContain('<run>Æ&#10;</run>');
    expect(kpi?.snapshot.xml).toContain("<format attr='text-align' value='left' />");
    expect(kpi?.snapshot.xml).toContain(
      "<text column='[{{DATASOURCE}}].[sum:{{field_base_2}}:qk]' />",
    );
    expect(kpi?.snapshot.xml).toContain(
      "<text column='[{{DATASOURCE}}].[sum:{{field_base_5}}:qk]' />",
    );
    expect(kpi?.snapshot.xml).toContain(
      "<tooltip column='[{{DATASOURCE}}].[sum:{{field_base_3}}:qk]' />",
    );
    expect(kpi?.snapshot.xml).toContain(
      "<tooltip column='[{{DATASOURCE}}].[sum:{{field_base_4}}:qk]' />",
    );
    expect(kpi?.snapshot.xml).not.toContain(
      "<text column='[{{DATASOURCE}}].[sum:{{field_base_3}}:qk]' />",
    );
    expect(kpi?.snapshot.xml).not.toContain(
      "<text column='[{{DATASOURCE}}].[sum:{{field_base_4}}:qk]' />",
    );
    expect(kpi?.snapshot.xml).toContain('{{COMPARISON_PERIOD_CONTEXT}} | ');
    expect(kpi?.snapshot.xml).not.toContain('PREVIOUS PERIOD | {{COMPARISON_PERIOD_CONTEXT}} | ');
    expect(kpi?.snapshot.xml).toContain('&lt;[{{DATASOURCE}}].[sum:{{field_base_3}}:qk]&gt;');
    expect(kpi?.snapshot.xml).toContain('CHANGE FROM PREVIOUS PERIOD | ');
    expect(kpi?.snapshot.xml).toContain(
      "<run bold='true' fontcolor='{{CHANGE_COLOR}}'>&lt;[{{DATASOURCE}}].[sum:{{field_base_5}}:qk]&gt;</run>",
    );
    expect(kpi?.snapshot.xml).not.toContain('ABSOLUTE CHANGE | ');
    expect(kpi?.snapshot.xml).not.toContain('PREVIOUS VALUE | ');
  });
});
