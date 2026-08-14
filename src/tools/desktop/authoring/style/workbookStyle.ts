import {
  Attr as XmlAttr,
  Document as XmlDocument,
  DOMParser,
  Element as XmlElement,
  Node as XmlNode,
  Text as XmlText,
  XMLSerializer,
} from '@xmldom/xmldom';

import type { EligibleStyleArtifact } from './eligibleArtifacts.js';
import type { TableauStylePackV2 } from './stylePack.js';

export type WorkbookStyleFindingCode =
  | 'brand-primary-unsupported'
  | 'currency-format-unsupported'
  | 'date-format-unsupported'
  | 'time-format-unsupported'
  | 'fiscal-quarter-format-unsupported'
  | 'fiscal-year-format-unsupported'
  | 'fiscal-year-quarter-format-unsupported'
  | 'dashboard-outer-padding-unsupported'
  | 'dashboard-inner-spacing-unsupported'
  | 'dashboard-title-alignment-unsupported'
  | 'dashboard-style-unsupported'
  | 'global-datasource-style-unsupported'
  | 'avoid-pie-charts-advisory'
  | 'label-calculated-data-advisory'
  | 'categorical-palette-arity-mismatch'
  | 'sequential-palette-arity-mismatch'
  | 'diverging-palette-arity-mismatch'
  | 'findings-truncated';

export type WorkbookStyleFinding = {
  code: WorkbookStyleFindingCode;
  message: string;
  eligibleArtifactIds?: string[];
  affectedArtifactCount?: number;
  omittedEligibleArtifactCount?: number;
};

export type WorkbookStyleResult = {
  workbookXml: string;
  changedEligibleIds: string[];
  unchangedEligibleIds: string[];
  findings: WorkbookStyleFinding[];
};

const MAX_FINDINGS = 32;

export function applyWorkbookStyle(
  workbookXml: string,
  stylePack: TableauStylePackV2,
  eligibleArtifacts: EligibleStyleArtifact[],
): WorkbookStyleResult {
  const document = parseWorkbook(workbookXml);
  const worksheets = collectionChildren(document, 'worksheets', 'worksheet');
  const dashboards = collectionChildren(document, 'dashboards', 'dashboard');
  assertUniqueEligibleArtifacts(eligibleArtifacts);
  const targets = eligibleArtifacts.map((artifact) => ({
    artifact,
    element: joinArtifact(artifact, artifact.kind === 'worksheet' ? worksheets : dashboards),
  }));
  const changedIds: string[] = [];
  const findingCollector = new FindingCollector();

  for (const { artifact, element } of targets) {
    if (
      artifact.kind === 'worksheet' &&
      styleWorksheet(element, artifact, stylePack, findingCollector)
    ) {
      changedIds.push(artifact.id);
    }
  }
  addPackFindings(document, targets, stylePack, findingCollector);

  const changed = new Set(changedIds);
  return {
    workbookXml: new XMLSerializer().serializeToString(document),
    changedEligibleIds: changedIds,
    unchangedEligibleIds: eligibleArtifacts
      .filter(({ id }) => !changed.has(id))
      .map(({ id }) => id),
    findings: findingCollector.toArray(),
  };
}

function styleWorksheet(
  worksheet: XmlElement,
  artifact: EligibleStyleArtifact,
  stylePack: TableauStylePackV2,
  findings: FindingCollector,
): boolean {
  let changed = false;
  for (const layout of directChildren(worksheet, 'layout-options')) {
    for (const title of directChildren(layout, 'title')) {
      for (const formattedText of directChildren(title, 'formatted-text')) {
        for (const run of directChildren(formattedText, 'run')) {
          changed =
            setExistingAttribute(run, 'fontname', stylePack.typography.titleFont) || changed;
          changed = setExistingAttribute(run, 'fontcolor', stylePack.palette.text) || changed;
        }
      }
    }
  }

  for (const table of directChildren(worksheet, 'table')) {
    for (const style of directChildren(table, 'style')) {
      for (const styleRule of directChildren(style, 'style-rule')) {
        for (const format of directChildren(styleRule, 'format')) {
          const attr = unnamespacedAttribute(format, 'attr')?.value;
          const target =
            attr === 'font-family'
              ? stylePack.typography.bodyFont
              : attr === 'color'
                ? stylePack.palette.text
                : attr === 'background-color' &&
                    unnamespacedAttribute(styleRule, 'element')?.value === 'table'
                  ? stylePack.palette.background
                  : undefined;
          if (target !== undefined)
            changed = setExistingAttribute(format, 'value', target) || changed;
        }

        if (unnamespacedAttribute(styleRule, 'element')?.value !== 'mark') continue;
        for (const encoding of directChildren(styleRule, 'encoding')) {
          if (unnamespacedAttribute(encoding, 'attr')?.value !== 'color') continue;
          const type = unnamespacedAttribute(encoding, 'type')?.value;
          if (type === 'palette') {
            const maps = directChildren(encoding, 'map');
            const colors = distinctMapColors(maps);
            if (colors && colors.length === stylePack.palette.categorical.length) {
              const replacements = new Map(
                colors.map((color, index) => [
                  color.toLowerCase(),
                  stylePack.palette.categorical[index],
                ]),
              );
              for (const map of maps) {
                const to = unnamespacedAttribute(map, 'to');
                if (!to) continue;
                const replacement = replacements.get(to.value.toLowerCase());
                if (replacement !== undefined && to.value !== replacement) {
                  to.value = replacement;
                  changed = true;
                }
              }
            } else if (maps.length > 0) {
              findings.addArity('categorical-palette-arity-mismatch', artifact.id);
            }
          }

          if (type !== 'custom-interpolated') continue;
          for (const palette of directChildren(encoding, 'color-palette')) {
            if (unnamespacedAttribute(palette, 'custom')?.value !== 'true') continue;
            const paletteType = unnamespacedAttribute(palette, 'type')?.value;
            const colors = directChildren(palette, 'color');
            const replacements =
              paletteType === 'ordered-sequential' &&
              colors.length === stylePack.palette.sequential.length
                ? stylePack.palette.sequential
                : paletteType === 'ordered-diverging' && colors.length === 3
                  ? [
                      stylePack.palette.diverging.negative,
                      stylePack.palette.diverging.midpoint,
                      stylePack.palette.diverging.positive,
                    ]
                  : undefined;
            if (
              paletteType === 'ordered-sequential' &&
              colors.length !== stylePack.palette.sequential.length
            ) {
              findings.addArity('sequential-palette-arity-mismatch', artifact.id);
            }
            if (paletteType === 'ordered-diverging' && colors.length !== 3) {
              findings.addArity('diverging-palette-arity-mismatch', artifact.id);
            }
            if (!replacements || !colors.every(isExactColorLeaf)) continue;
            colors.forEach((color, index) => {
              const text = color.firstChild;
              if (text && text.nodeValue !== replacements[index]) {
                (text as XmlText).data = replacements[index];
                changed = true;
              }
            });
          }
        }
      }
    }
  }
  return changed;
}

function addPackFindings(
  document: XmlDocument,
  targets: Array<{ artifact: EligibleStyleArtifact; element: XmlElement }>,
  stylePack: TableauStylePackV2,
  findings: FindingCollector,
): void {
  findings.add({
    code: 'brand-primary-unsupported',
    message: `brandPrimary ${stylePack.palette.brandPrimary} is unsupported in v1; no XML was invented`,
  });
  findings.add({
    code: 'currency-format-unsupported',
    message: `Currency format ${stylePack.formats.currency} is unsupported in v1`,
  });
  findings.add({
    code: 'date-format-unsupported',
    message: `Date format ${stylePack.formats.date} is unsupported in v1`,
  });
  findings.add({
    code: 'time-format-unsupported',
    message: `Time format ${stylePack.formats.time} is unsupported in v1`,
  });
  findings.add({
    code: 'fiscal-quarter-format-unsupported',
    message: `Fiscal quarter format ${stylePack.formats.fiscalQuarter} is unsupported in v1`,
  });
  findings.add({
    code: 'fiscal-year-format-unsupported',
    message: `Fiscal year format ${stylePack.formats.fiscalYear} is unsupported in v1`,
  });
  findings.add({
    code: 'fiscal-year-quarter-format-unsupported',
    message: `Fiscal year-quarter format ${stylePack.formats.fiscalYearQuarter} is unsupported in v1`,
  });

  const dashboardTargets = targets.filter(({ artifact }) => artifact.kind === 'dashboard');
  if (dashboardTargets.length > 0) {
    findings.add({
      code: 'dashboard-outer-padding-unsupported',
      message: `Dashboard outer padding ${stylePack.dashboard.outerPadding} is unsupported in v1`,
    });
    findings.add({
      code: 'dashboard-inner-spacing-unsupported',
      message: `Dashboard inner spacing ${stylePack.dashboard.innerSpacing} is unsupported in v1`,
    });
    findings.add({
      code: 'dashboard-title-alignment-unsupported',
      message: `Dashboard title alignment ${stylePack.dashboard.titleAlignment} is unsupported in v1`,
    });
  }
  const styledDashboardIds = dashboardTargets
    .filter(({ element }) => directChildren(element, 'style').length > 0)
    .map(({ artifact }) => artifact.id);
  if (styledDashboardIds.length > 0) {
    findings.add({
      code: 'dashboard-style-unsupported',
      message: `${styledDashboardIds.length} eligible dashboards have existing styling; dashboard styling is unsupported in v1`,
      ...boundedArtifactSummary(styledDashboardIds),
    });
  }

  if (hasGlobalDatasourceStyle(document)) {
    findings.add({
      code: 'global-datasource-style-unsupported',
      message: 'Existing global datasource styles are unsupported in v1 and were preserved',
    });
  }
  if (stylePack.advisoryRules.avoidPieCharts) {
    findings.add({
      code: 'avoid-pie-charts-advisory',
      message: 'Avoiding pie charts is advisory only; no semantic chart rewrite was attempted',
    });
  }
  if (stylePack.advisoryRules.labelCalculatedData) {
    findings.add({
      code: 'label-calculated-data-advisory',
      message: 'Labeling calculated data is advisory only; no semantic field rewrite was attempted',
    });
  }
}

function hasGlobalDatasourceStyle(document: XmlDocument): boolean {
  const root = document.documentElement;
  if (!root) return false;
  for (const datasources of directChildren(root, 'datasources')) {
    for (const datasource of directChildren(datasources, 'datasource')) {
      if (directChildren(datasource, 'style').length > 0) return true;
    }
  }
  return false;
}

class FindingCollector {
  private readonly findings: WorkbookStyleFinding[] = [];
  private readonly keys = new Set<string>();
  private readonly arityArtifactIds = new Map<PaletteArityFindingCode, Set<string>>();

  add(finding: WorkbookStyleFinding): void {
    const key = finding.code;
    if (this.keys.has(key)) return;
    this.keys.add(key);
    this.findings.push(finding);
  }

  addArity(code: PaletteArityFindingCode, artifactId: string): void {
    const artifactIds = this.arityArtifactIds.get(code) ?? new Set<string>();
    artifactIds.add(artifactId);
    this.arityArtifactIds.set(code, artifactIds);
  }

  toArray(): WorkbookStyleFinding[] {
    const arityFindings = PALETTE_ARITY_FINDING_CODES.flatMap((code) => {
      const artifactIds = [...(this.arityArtifactIds.get(code) ?? [])];
      if (artifactIds.length === 0) return [];
      return [
        {
          code,
          message: `${artifactIds.length} eligible worksheets skipped ${arityRuleLabel(code)} because palette arity did not match`,
          ...boundedArtifactSummary(artifactIds),
        },
      ];
    });
    const combined = [...arityFindings, ...this.findings];
    if (combined.length <= MAX_FINDINGS) return combined;
    return [
      ...combined.slice(0, MAX_FINDINGS - 1),
      {
        code: 'findings-truncated',
        message: `Style findings were truncated at ${MAX_FINDINGS}`,
      },
    ];
  }
}

type PaletteArityFindingCode = Extract<
  WorkbookStyleFindingCode,
  | 'categorical-palette-arity-mismatch'
  | 'sequential-palette-arity-mismatch'
  | 'diverging-palette-arity-mismatch'
>;

const PALETTE_ARITY_FINDING_CODES: PaletteArityFindingCode[] = [
  'categorical-palette-arity-mismatch',
  'sequential-palette-arity-mismatch',
  'diverging-palette-arity-mismatch',
];

const MAX_FINDING_ARTIFACT_IDS = 8;

function boundedArtifactSummary(
  artifactIds: string[],
): Pick<
  WorkbookStyleFinding,
  'eligibleArtifactIds' | 'affectedArtifactCount' | 'omittedEligibleArtifactCount'
> {
  const omitted = Math.max(0, artifactIds.length - MAX_FINDING_ARTIFACT_IDS);
  return {
    eligibleArtifactIds: artifactIds.slice(0, MAX_FINDING_ARTIFACT_IDS),
    affectedArtifactCount: artifactIds.length,
    ...(omitted > 0 ? { omittedEligibleArtifactCount: omitted } : {}),
  };
}

function arityRuleLabel(code: PaletteArityFindingCode): string {
  if (code === 'categorical-palette-arity-mismatch') return 'categorical palette replacement';
  if (code === 'sequential-palette-arity-mismatch') return 'sequential palette replacement';
  return 'diverging palette replacement';
}

function distinctMapColors(maps: XmlElement[]): string[] | undefined {
  const colors: string[] = [];
  const seen = new Set<string>();
  for (const map of maps) {
    const to = unnamespacedAttribute(map, 'to');
    if (!to) return undefined;
    const normalized = to.value.toLowerCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      colors.push(to.value);
    }
  }
  return colors;
}

function isExactColorLeaf(color: XmlElement): boolean {
  return (
    color.attributes.length === 0 &&
    color.childNodes.length === 1 &&
    (color.firstChild?.nodeType === 3 || color.firstChild?.nodeType === 4)
  );
}

function setExistingAttribute(element: XmlElement, name: string, value: string): boolean {
  const attribute = unnamespacedAttribute(element, name);
  if (!attribute || attribute.value === value) return false;
  attribute.value = value;
  return true;
}

function parseWorkbook(workbookXml: string): XmlDocument {
  let malformed = false;
  const parser = new DOMParser({ onError: () => (malformed = true) });
  let document: XmlDocument;
  try {
    document = parser.parseFromString(workbookXml, 'text/xml');
  } catch {
    malformed = true;
    document = parser.parseFromString('<invalid/>', 'text/xml');
  }
  if (malformed) throw new Error('Cannot apply workbook style to malformed workbook XML');
  if (!isUnnamespacedElement(document.documentElement, 'workbook')) {
    throw new Error('Workbook styling requires a <workbook> XML document');
  }
  return document;
}

function collectionChildren(
  document: XmlDocument,
  collectionName: string,
  itemName: string,
): XmlElement[] {
  const root = document.documentElement;
  if (!root) throw new Error('Workbook styling requires a <workbook> XML document');
  return directChildren(root, collectionName).flatMap((collection) =>
    directChildren(collection, itemName),
  );
}

function joinArtifact(artifact: EligibleStyleArtifact, elements: XmlElement[]): XmlElement {
  const name = normalizeName(artifact.name);
  const matches = elements.filter(
    (element) => normalizeName(unnamespacedAttribute(element, 'name')?.value ?? '') === name,
  );
  if (matches.length === 0) {
    throw new Error(
      `${artifact.kind} "${artifact.name}" (${artifact.id}) is missing from workbook XML`,
    );
  }
  if (matches.length !== 1) {
    throw new Error(
      `${artifact.kind} "${artifact.name}" (${artifact.id}) matches ${matches.length} workbook XML elements`,
    );
  }
  return matches[0];
}

function assertUniqueEligibleArtifacts(artifacts: EligibleStyleArtifact[]): void {
  const ids = new Set<string>();
  const namesByKind = new Set<string>();
  for (const artifact of artifacts) {
    if (ids.has(artifact.id)) {
      throw new Error(`eligible artifact id "${artifact.id}" appears more than once`);
    }
    ids.add(artifact.id);
    const nameKey = `${artifact.kind}\u0000${normalizeName(artifact.name)}`;
    if (namesByKind.has(nameKey)) {
      throw new Error(
        `${artifact.kind} name "${artifact.name}" identifies more than one eligible artifact`,
      );
    }
    namesByKind.add(nameKey);
  }
}

function directChildren(parent: XmlNode, name: string): XmlElement[] {
  const matches: XmlElement[] = [];
  for (let child = parent.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1 && isUnnamespacedElement(child as XmlElement, name)) {
      matches.push(child as XmlElement);
    }
  }
  return matches;
}

function unnamespacedAttribute(element: XmlElement, name: string): XmlAttr | null {
  const attribute = element.getAttributeNode(name);
  return attribute && !attribute.namespaceURI && !attribute.prefix ? attribute : null;
}

function isUnnamespacedElement(element: XmlElement | null, name: string): element is XmlElement {
  return Boolean(element && element.nodeName === name && !element.namespaceURI && !element.prefix);
}

function normalizeName(name: string): string {
  return name.trim().normalize('NFC');
}
