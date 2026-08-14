import {
  Document as XmlDocument,
  DOMParser,
  Element as XmlElement,
  Node as XmlNode,
} from '@xmldom/xmldom';

import type { WorkbookInventory } from '../../../../desktop/externalApi/types.js';

export type EligibleStyleArtifact = {
  kind: 'worksheet' | 'dashboard';
  id: string;
  name: string;
  hidden: boolean;
};

export function eligibleStyleArtifacts(
  inventory: WorkbookInventory,
  workbookXml: string,
): EligibleStyleArtifact[] {
  const document = parseWorkbook(workbookXml);
  const worksheetElements = directCollectionChildren(document, 'worksheets', 'worksheet');
  const dashboardElements = directCollectionChildren(document, 'dashboards', 'dashboard');
  const worksheets = inventory.worksheets ?? [];
  const dashboards = inventory.dashboards ?? [];

  assertUniqueIds('worksheet', worksheets);
  assertUniqueIds('dashboard', dashboards);

  const worksheetsById = groupBy(worksheets, ({ id }) => id);
  const worksheetsByName = groupBy(worksheets, ({ name }) => normalizeDecodedName(name));
  const eligibleWorksheetIds = new Set(
    worksheets.filter(({ hidden }) => !hidden).map(({ id }) => id),
  );
  const visibleDashboards = dashboards.filter(({ hidden }) => !hidden);
  assertUniqueEligibleNames('dashboard', visibleDashboards);

  for (const dashboard of visibleDashboards) {
    const dashboardElement = assertXmlJoin('dashboard', dashboard, dashboardElements);
    const containedIds = dashboard.containedSheets;
    if (containedIds) {
      for (const worksheetId of containedIds) {
        const matches = worksheetsById.get(worksheetId) ?? [];
        if (matches.length === 0) {
          throw new Error(
            `dashboard "${dashboard.name}" (${dashboard.id}) references unknown worksheet id "${worksheetId}"`,
          );
        }
        eligibleWorksheetIds.add(worksheetId);
      }
      const inventoryNames = containedIds.map(
        (worksheetId) => (worksheetsById.get(worksheetId) ?? [])[0].name,
      );
      if (!sameNames(inventoryNames, worksheetZoneNames(dashboardElement))) {
        throw new Error(
          `dashboard "${dashboard.name}" (${dashboard.id}) membership differs between inventory and workbook XML`,
        );
      }
    } else {
      for (const worksheetName of worksheetZoneNames(dashboardElement)) {
        const matches = worksheetsByName.get(normalizeDecodedName(worksheetName)) ?? [];
        if (matches.length !== 1) {
          throw new Error(
            `dashboard "${dashboard.name}" (${dashboard.id}) references worksheet name "${worksheetName}" which matches ${matches.length} workbook inventory entries`,
          );
        }
        eligibleWorksheetIds.add(matches[0].id);
      }
    }
  }

  const eligibleWorksheets = worksheets.filter(({ id }) => eligibleWorksheetIds.has(id));
  assertUniqueEligibleNames('worksheet', eligibleWorksheets);
  for (const worksheet of eligibleWorksheets) {
    assertXmlJoin('worksheet', worksheet, worksheetElements);
  }

  return [
    ...eligibleWorksheets.map(
      ({ id, name, hidden }): EligibleStyleArtifact => ({
        kind: 'worksheet',
        id,
        name,
        hidden,
      }),
    ),
    ...visibleDashboards.map(
      ({ id, name, hidden }): EligibleStyleArtifact => ({
        kind: 'dashboard',
        id,
        name,
        hidden,
      }),
    ),
  ];
}

function assertUniqueEligibleNames(
  kind: 'worksheet' | 'dashboard',
  items: Array<{ name: string }>,
): void {
  const grouped = groupBy(items, ({ name }) => normalizeDecodedName(name));
  for (const matches of grouped.values()) {
    if (matches.length !== 1) {
      throw new Error(
        `${kind} name "${matches[0].name}" identifies ${matches.length} eligible workbook inventory entries`,
      );
    }
  }
}

function sameNames(left: string[], right: string[]): boolean {
  const normalize = (names: string[]): Set<string> =>
    new Set(names.map((name) => normalizeDecodedName(name)));
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  return (
    normalizedLeft.size === normalizedRight.size &&
    [...normalizedLeft].every((name) => normalizedRight.has(name))
  );
}

function parseWorkbook(workbookXml: string): XmlDocument {
  let malformed = false;
  const parser = new DOMParser({
    onError: () => {
      malformed = true;
    },
  });
  let document: XmlDocument;
  try {
    document = parser.parseFromString(workbookXml, 'text/xml');
  } catch {
    malformed = true;
    document = parser.parseFromString('<invalid/>', 'text/xml');
  }
  if (malformed) throw new Error('Cannot select style targets from malformed workbook XML');
  assertWorkbookRoot(document);
  return document;
}

function assertWorkbookRoot(document: XmlDocument): void {
  if (!isUnnamespacedElement(document.documentElement, 'workbook')) {
    throw new Error('Style target selection requires a <workbook> XML document');
  }
}

function directCollectionChildren(
  document: XmlDocument,
  collectionName: string,
  itemName: string,
): XmlElement[] {
  const root = document.documentElement;
  if (!root) throw new Error('Style target selection requires a <workbook> XML document');
  const collection = directElementChildren(root).filter((element) =>
    isUnnamespacedElement(element, collectionName),
  );
  return collection.flatMap((element) =>
    directElementChildren(element).filter((child) => isUnnamespacedElement(child, itemName)),
  );
}

function directElementChildren(parent: XmlNode): XmlElement[] {
  const elements: XmlElement[] = [];
  for (let child = parent.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1) elements.push(child as XmlElement);
  }
  return elements;
}

function assertUniqueIds(kind: 'worksheet' | 'dashboard', items: Array<{ id: string }>): void {
  const grouped = groupBy(items, ({ id }) => id);
  for (const [id, matches] of grouped) {
    if (matches.length !== 1) {
      throw new Error(`${kind} id "${id}" appears ${matches.length} times in workbook inventory`);
    }
  }
}

function assertXmlJoin(
  kind: 'worksheet' | 'dashboard',
  item: { id: string; name: string },
  elements: XmlElement[],
): XmlElement {
  const expectedName = normalizeDecodedName(item.name);
  const matches = elements.filter(
    (element) => normalizeDecodedName(element.getAttribute('name') ?? '') === expectedName,
  );
  if (matches.length === 0) {
    throw new Error(`${kind} "${item.name}" (${item.id}) is missing from workbook XML`);
  }
  if (matches.length !== 1) {
    throw new Error(
      `${kind} "${item.name}" (${item.id}) matches ${matches.length} workbook XML elements`,
    );
  }
  return matches[0];
}

function worksheetZoneNames(dashboard: XmlElement): string[] {
  const names: string[] = [];
  const visit = (parent: XmlNode): void => {
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      if (child.nodeType !== 1) continue;
      const element = child as XmlElement;
      if (isUnnamespacedElement(element, 'zone') && !element.hasAttribute('type-v2')) {
        const name = element.getAttribute('name');
        if (name) names.push(name);
      }
      visit(element);
    }
  };
  visit(dashboard);
  return names;
}

function isUnnamespacedElement(
  element: XmlElement | null,
  expectedName: string,
): element is XmlElement {
  return Boolean(
    element && element.nodeName === expectedName && !element.namespaceURI && !element.prefix,
  );
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const value = key(item);
    grouped.set(value, [...(grouped.get(value) ?? []), item]);
  }
  return grouped;
}

function normalizeDecodedName(value: string): string {
  return value.trim().normalize('NFC');
}
