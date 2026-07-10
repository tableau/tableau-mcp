/**
 * Vendored-asset completeness invariants.
 *
 * The day-1 Laulima dogfood (2026-07-09) hit "Template 'ww-ou-diff' not found"
 * live because a manual vendor copy from agent-to-tableau-desktop shipped the
 * template's manifest without its XML, and the two loadable template dirs had
 * drifted. These tests make that drift class a CI failure instead of a live one.
 */
import { existsSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

import { getDataRoot, getResourcesRoot } from './assets.js';

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

    expect({
      onlyInDataVisualizationTemplatesXml: diff(templateXmlNames, legacyTemplateNames),
      onlyInTemplates: diff(legacyTemplateNames, templateXmlNames),
    }).toEqual({ onlyInDataVisualizationTemplatesXml: [], onlyInTemplates: [] });
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
