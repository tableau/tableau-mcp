/**
 * Vendored-asset completeness invariants.
 *
 * The day-1 Laulima dogfood (2026-07-09) hit "Template 'ww-ou-diff' not found"
 * live because a manual vendor copy from agent-to-tableau-desktop shipped the
 * template's manifest without its XML, and the two loadable template dirs had
 * drifted. These tests make that drift class a CI failure instead of a live one.
 */
import { createHash } from 'crypto';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

import { getDataRoot, getResourcesRoot } from './assets.js';

type ContentManifestResource = { path: string; sha256: string; bytes: number };

function listFileStems(dir: string, suffix: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
    .map((entry) => entry.name.slice(0, -suffix.length))
    .sort();
}

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

function diff(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((name) => !rightSet.has(name));
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

describe('desktop vendored assets', () => {
  const dataRoot = getDataRoot();
  const manifestDir = join(dataRoot, 'template-manifests');
  const templateXmlDir = join(dataRoot, 'data-visualization-templates-xml');
  const legacyTemplatesDir = join(dataRoot, 'templates');

  it('ships XML in BOTH loadable dirs for every template manifest (no orphans)', () => {
    const manifestNames = listFileStems(manifestDir, '.manifest.json');
    const templateXmlNames = new Set(listFileStems(templateXmlDir, '.xml'));
    const legacyTemplateNames = new Set(listFileStems(legacyTemplatesDir, '.xml'));

    expect(manifestNames.length, 'expected vendored template manifests').toBeGreaterThan(0);

    const missingFiles = manifestNames.flatMap((name) => [
      ...(templateXmlNames.has(name) ? [] : [`data-visualization-templates-xml/${name}.xml`]),
      ...(legacyTemplateNames.has(name) ? [] : [`templates/${name}.xml`]),
    ]);

    expect(missingFiles).toEqual([]);
  });

  it('keeps the two loadable template XML directories identical', () => {
    const templateXmlNames = listFileStems(templateXmlDir, '.xml');
    const legacyTemplateNames = listFileStems(legacyTemplatesDir, '.xml');
    const commonNames = templateXmlNames.filter((name) => legacyTemplateNames.includes(name));
    const byteMismatches = commonNames.flatMap((name) => {
      const templateXml = readFileSync(join(templateXmlDir, `${name}.xml`));
      const legacyTemplateXml = readFileSync(join(legacyTemplatesDir, `${name}.xml`));
      return templateXml.equals(legacyTemplateXml)
        ? []
        : [
            {
              name,
              dataVisualizationTemplatesXml: {
                sha256: sha256(templateXml),
                bytes: templateXml.byteLength,
              },
              templates: {
                sha256: sha256(legacyTemplateXml),
                bytes: legacyTemplateXml.byteLength,
              },
            },
          ];
    });

    expect({
      onlyInDataVisualizationTemplatesXml: diff(templateXmlNames, legacyTemplateNames),
      onlyInTemplates: diff(legacyTemplateNames, templateXmlNames),
      byteMismatches,
    }).toEqual({
      onlyInDataVisualizationTemplatesXml: [],
      onlyInTemplates: [],
      byteMismatches: [],
    });
  });

  it('declares every shipped template XML in content-manifest.json (regenerate on sync)', () => {
    // The provenance surface (BundledIntelligenceProvider.getContentManifest) must not
    // under-report shipped content: rerun buildTemplateManifests.ts after any vendor copy.
    const manifest = JSON.parse(readFileSync(join(dataRoot, 'content-manifest.json'), 'utf-8')) as {
      resources: ContentManifestResource[];
    };
    const declared = new Set(manifest.resources.map((r) => r.path));
    const undeclaredXml = listFileStems(templateXmlDir, '.xml')
      .map((name) => `data-visualization-templates-xml/${name}.xml`)
      .filter((p) => !declared.has(p));
    const integrityMismatches = manifest.resources.flatMap((resource) => {
      const bytes = readFileSync(join(dataRoot, resource.path));
      const actual = { sha256: sha256(bytes), bytes: bytes.byteLength };
      return actual.sha256 === resource.sha256 && actual.bytes === resource.bytes
        ? []
        : [{ path: resource.path, expected: resource, actual }];
    });

    expect({ undeclaredXml, integrityMismatches }).toEqual({
      undeclaredXml: [],
      integrityMismatches: [],
    });
  });

  it('ships template XML windows without focus-restoring active/maximized flags', () => {
    const flaggedWindows = [
      ['data-visualization-templates-xml', templateXmlDir],
      ['templates', legacyTemplatesDir],
    ].flatMap(([label, dir]) =>
      readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.xml'))
        .flatMap((entry) => {
          const xml = readFileSync(join(dir, entry.name), 'utf-8');
          return Array.from(xml.matchAll(/<windows\b[\s\S]*?<\/windows>/g)).flatMap((section) =>
            Array.from(section[0].matchAll(/<window\b[^>]*(?:\bactive=|\bmaximized=)[^>]*>/g)).map(
              (match) => `${label}/${entry.name}: ${match[0]}`,
            ),
          );
        }),
    );

    expect(flaggedWindows).toEqual([]);
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
