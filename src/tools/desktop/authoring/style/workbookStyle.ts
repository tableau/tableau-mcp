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
    const changed =
      artifact.kind === 'worksheet'
        ? styleWorksheet(element, artifact, stylePack, findingCollector)
        : styleDashboard(element, stylePack);
    if (changed) {
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
  let changed = insertCanonicalWorksheetTitle(worksheet, stylePack);
  for (const layout of directChildren(worksheet, 'layout-options')) {
    for (const title of directChildren(layout, 'title')) {
      for (const formattedText of directChildren(title, 'formatted-text')) {
        for (const run of directChildren(formattedText, 'run')) {
          changed =
            setExistingAttribute(run, 'fontname', stylePack.typography.titleFont) || changed;
          changed = setExistingColorAttribute(run, 'fontcolor', stylePack.palette.text) || changed;
        }
      }
    }
  }

  for (const table of directChildren(worksheet, 'table')) {
    for (const style of directChildren(table, 'style')) {
      for (const styleRule of directChildren(style, 'style-rule')) {
        for (const format of directChildren(styleRule, 'format')) {
          const attr = unnamespacedAttribute(format, 'attr')?.value;
          if (attr === 'font-family') {
            changed =
              setExistingAttribute(format, 'value', stylePack.typography.bodyFont) || changed;
          } else if (attr === 'color') {
            changed = setExistingColorAttribute(format, 'value', stylePack.palette.text) || changed;
          } else if (
            attr === 'background-color' &&
            unnamespacedAttribute(styleRule, 'element')?.value === 'table'
          ) {
            changed =
              setExistingColorAttribute(format, 'value', stylePack.palette.background) || changed;
          }
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
                if (replacement !== undefined && !sameHexColor(to.value, replacement)) {
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
              if (text && !sameHexColor(text.nodeValue ?? '', replacements[index])) {
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

function insertCanonicalWorksheetTitle(
  worksheet: XmlElement,
  stylePack: TableauStylePackV2,
): boolean {
  const tables = directChildren(worksheet, 'table');
  const name = unnamespacedAttribute(worksheet, 'name')?.value;
  if (
    name === undefined ||
    normalizeName(name) === '' ||
    directChildren(worksheet, 'layout-options').length !== 0 ||
    tables.length !== 1 ||
    hasDirectNamespacedCollision(worksheet, 'layout-options') ||
    hasDirectNamespacedCollision(worksheet, 'table')
  ) {
    return false;
  }
  const document = worksheet.ownerDocument;
  if (!document) return false;
  const layout = document.createElement('layout-options');
  const title = document.createElement('title');
  const formattedText = document.createElement('formatted-text');
  const run = document.createElement('run');
  run.setAttribute('fontcolor', stylePack.palette.text);
  run.setAttribute('fontname', stylePack.typography.titleFont);
  run.appendChild(document.createTextNode('<Sheet Name>'));
  formattedText.appendChild(run);
  title.appendChild(formattedText);
  layout.appendChild(title);
  worksheet.insertBefore(layout, tables[0]);
  return true;
}

function styleDashboard(dashboard: XmlElement, stylePack: TableauStylePackV2): boolean {
  let changed = false;
  for (const run of dashboardTitleRuns(dashboard)) {
    changed = setExistingAttribute(run, 'fontname', stylePack.typography.titleFont) || changed;
    changed = setExistingColorAttribute(run, 'fontcolor', stylePack.palette.text) || changed;
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
    message: `brandPrimary ${stylePack.palette.brandPrimary} is not yet automated by apply-workbook-style; no workbook XML was invented`,
  });
  findings.add({
    code: 'currency-format-unsupported',
    message: `Currency format ${stylePack.formats.currency} is not yet automated by apply-workbook-style; no workbook XML was invented`,
  });
  findings.add({
    code: 'date-format-unsupported',
    message: `Date format ${stylePack.formats.date} is not yet automated by apply-workbook-style; no workbook XML was invented`,
  });
  findings.add({
    code: 'time-format-unsupported',
    message: `Time format ${stylePack.formats.time} is not yet automated by apply-workbook-style; no workbook XML was invented`,
  });
  findings.add({
    code: 'fiscal-quarter-format-unsupported',
    message: `Fiscal quarter format ${stylePack.formats.fiscalQuarter} is not yet automated by apply-workbook-style; no workbook XML was invented`,
  });
  findings.add({
    code: 'fiscal-year-format-unsupported',
    message: `Fiscal year format ${stylePack.formats.fiscalYear} is not yet automated by apply-workbook-style; no workbook XML was invented`,
  });
  findings.add({
    code: 'fiscal-year-quarter-format-unsupported',
    message: `Fiscal year-quarter format ${stylePack.formats.fiscalYearQuarter} is not yet automated by apply-workbook-style; no workbook XML was invented`,
  });

  const dashboardTargets = targets.filter(({ artifact }) => artifact.kind === 'dashboard');
  if (dashboardTargets.length > 0) {
    findings.add({
      code: 'dashboard-outer-padding-unsupported',
      message: `Dashboard outer padding ${stylePack.dashboard.outerPadding} is not yet automated by apply-workbook-style; no workbook XML was invented`,
    });
    findings.add({
      code: 'dashboard-inner-spacing-unsupported',
      message: `Dashboard inner spacing ${stylePack.dashboard.innerSpacing} is not yet automated by apply-workbook-style; no workbook XML was invented`,
    });
    findings.add({
      code: 'dashboard-title-alignment-unsupported',
      message: `Dashboard title alignment ${stylePack.dashboard.titleAlignment} is not yet automated by apply-workbook-style; no workbook XML was invented`,
    });
  }
  const styledDashboardIds = dashboardTargets
    .filter(({ element }) => directChildren(element, 'style').some(hasMeaningfulStyleContent))
    .map(({ artifact }) => artifact.id);
  if (styledDashboardIds.length > 0) {
    findings.add({
      code: 'dashboard-style-unsupported',
      message: `${styledDashboardIds.length} eligible dashboards have existing styling that is not yet automated by apply-workbook-style; existing workbook XML was preserved`,
      ...boundedArtifactSummary(styledDashboardIds),
    });
  }

  if (hasGlobalDatasourceStyle(document)) {
    findings.add({
      code: 'global-datasource-style-unsupported',
      message:
        'Existing global datasource styles are not yet automated by apply-workbook-style; existing workbook XML was preserved',
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

function dashboardTitleRuns(dashboard: XmlElement): XmlElement[] {
  const dashboardName = normalizeName(unnamespacedAttribute(dashboard, 'name')?.value ?? '');
  if (dashboardName === '') return [];
  const matches: XmlElement[] = [];
  for (const zones of directChildren(dashboard, 'zones')) {
    for (const layoutZone of directChildren(zones, 'zone')) {
      if (unnamespacedAttribute(layoutZone, 'type-v2')?.value !== 'layout-basic') continue;
      for (const textZone of directChildren(layoutZone, 'zone')) {
        if (unnamespacedAttribute(textZone, 'type-v2')?.value !== 'text') continue;
        for (const formattedText of directChildren(textZone, 'formatted-text')) {
          const runs = directChildren(formattedText, 'run');
          const text = normalizeName(runs.map((run) => run.textContent ?? '').join(''));
          if (text === dashboardName) matches.push(...runs);
        }
      }
    }
  }
  return matches;
}

function hasMeaningfulStyleContent(style: XmlElement): boolean {
  for (let index = 0; index < style.attributes.length; index += 1) {
    const attribute = style.attributes.item(index);
    if (attribute && attribute.name !== 'xmlns' && attribute.prefix !== 'xmlns') return true;
  }
  for (let child: XmlNode | null = style.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1 || child.nodeType === 7) return true;
    if ((child.nodeType === 3 || child.nodeType === 4) && (child.nodeValue ?? '').trim() !== '') {
      return true;
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

function setExistingColorAttribute(element: XmlElement, name: string, value: string): boolean {
  const attribute = unnamespacedAttribute(element, name);
  if (!attribute || sameHexColor(attribute.value, value)) return false;
  attribute.value = value;
  return true;
}

function sameHexColor(left: string, right: string): boolean {
  return (
    left === right ||
    (/^#[0-9a-f]{6}$/i.test(left) &&
      /^#[0-9a-f]{6}$/i.test(right) &&
      left.toLowerCase() === right.toLowerCase())
  );
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

function hasDirectNamespacedCollision(parent: XmlNode, localName: string): boolean {
  for (let child = parent.firstChild; child; child = child.nextSibling) {
    if (child.nodeType !== 1) continue;
    const element = child as XmlElement;
    if (element.localName === localName && !isUnnamespacedElement(element, localName)) return true;
  }
  return false;
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
