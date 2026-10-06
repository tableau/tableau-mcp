import { Document, DOMParser, Element, XMLSerializer } from '@xmldom/xmldom';
import { Err, Ok, Result } from 'ts-results-es';

import type { ValidationIssue } from '../validation/types.js';
import { normalizeParsedXmlName, parsedXmlNamesEqual } from '../xmlElement.js';

function parse(xml: string): Document {
  return new DOMParser({
    onError: (level, message) => {
      if (level !== 'warning') throw new Error(message);
    },
  }).parseFromString(xml, 'text/xml');
}

function children(element: Element, tag?: string): Element[] {
  return Array.from(element.childNodes).filter(
    (node): node is Element => node.nodeType === 1 && (!tag || node.nodeName === tag),
  );
}

/** Includes device layouts; a sheet repeated across layouts needs only one viewpoint. */
export function dashboardWorksheetNames(dashboardXml: string): string[] {
  let doc: Document;
  try {
    doc = parse(dashboardXml);
  } catch {
    // The validation funnel reports malformed cached fragments before dispatch.
    return [];
  }
  return worksheetNamesIn(doc.documentElement!);
}

function worksheetNamesIn(dashboard: Element): string[] {
  const names = new Map<string, string>();
  for (const zone of Array.from(dashboard.getElementsByTagName('zone'))) {
    const name = zone.getAttribute('name');
    const type = zone.getAttribute('type-v2');
    if (name && (!type || type === 'visual')) names.set(normalizeParsedXmlName(name), name);
  }
  return [...names.values()];
}

/** Register dashboard views in the same workbook document as its worksheet zones. */
export function synchronizeDashboardViewpoints(
  workbookXml: string,
  dashboardName: string,
  worksheetNames: string[],
): { xml: string; changed: boolean } {
  const doc = parse(workbookXml);
  const changed = synchronizeViewpointsInDocument(doc, dashboardName, worksheetNames);
  return {
    xml: changed ? new XMLSerializer().serializeToString(doc) : workbookXml,
    changed,
  };
}

function synchronizeViewpointsInDocument(
  doc: Document,
  dashboardName: string,
  worksheetNames: string[],
): boolean {
  const root = doc.documentElement;
  if (!root || root.tagName !== 'workbook') throw new Error('Expected a workbook document.');
  let windows = children(root, 'windows')[0];
  if (!windows) {
    windows = doc.createElement('windows');
    root.appendChild(windows);
  }
  let window = children(windows, 'window').find(
    (element) =>
      element.getAttribute('class') === 'dashboard' &&
      parsedXmlNamesEqual(element.getAttribute('name') ?? '', dashboardName),
  );
  if (!window) {
    window = doc.createElement('window');
    window.setAttribute('class', 'dashboard');
    window.setAttribute('name', dashboardName);
    windows.appendChild(window);
  }
  const containers = children(window, 'viewpoints');
  const existing = containers.flatMap((container) => children(container, 'viewpoint'));
  const desired = [
    ...new Map(worksheetNames.map((name) => [normalizeParsedXmlName(name), name])).values(),
  ];
  if (
    containers.length === 1 &&
    children(window)[0] === containers[0] &&
    existing.length === desired.length &&
    desired.every((name) =>
      existing.some((vp) => parsedXmlNamesEqual(vp.getAttribute('name') ?? '', name)),
    )
  )
    return false;

  const viewpoints = doc.createElement('viewpoints');
  for (const name of desired) {
    const retained = existing.find((vp) =>
      parsedXmlNamesEqual(vp.getAttribute('name') ?? '', name),
    );
    if (retained) {
      viewpoints.appendChild(retained);
    } else {
      const viewpoint = doc.createElement('viewpoint');
      viewpoint.setAttribute('name', name);
      const zoom = doc.createElement('zoom');
      zoom.setAttribute('type', 'entire-view');
      viewpoint.appendChild(zoom);
      viewpoints.appendChild(viewpoint);
    }
  }
  for (const container of containers) window.removeChild(container);
  window.insertBefore(viewpoints, children(window)[0] ?? null);
  return true;
}

/** Replace only the target dashboard; preserve the order of all unrelated XML children. */
export function composeDashboardWorkbook(
  workbookXml: string,
  dashboardName: string,
  dashboardXml: string,
): Result<{ xml: string; worksheetNames: string[] }, ValidationIssue[]> {
  const doc = parse(workbookXml);
  const root = doc.documentElement;
  const fragment = parse(dashboardXml).documentElement;
  if (
    !root ||
    root.tagName !== 'workbook' ||
    fragment?.tagName !== 'dashboard' ||
    !parsedXmlNamesEqual(fragment.getAttribute('name') ?? '', dashboardName)
  ) {
    throw new Error('Expected a workbook and matching dashboard fragment.');
  }
  let dashboards = children(root, 'dashboards')[0];
  if (!dashboards) {
    dashboards = doc.createElement('dashboards');
    root.insertBefore(dashboards, children(root, 'windows')[0] ?? null);
  }
  const matchingDashboards = children(dashboards, 'dashboard').filter((element) =>
    parsedXmlNamesEqual(element.getAttribute('name') ?? '', dashboardName),
  );
  const matchingWindows = children(root, 'windows').flatMap((windows) =>
    children(windows, 'window').filter(
      (window) =>
        window.getAttribute('class') === 'dashboard' &&
        parsedXmlNamesEqual(window.getAttribute('name') ?? '', dashboardName),
    ),
  );
  if (matchingDashboards.length > 1 || matchingWindows.length > 1) {
    return Err([
      {
        ruleId: 'dashboard-membership-identity',
        severity: 'error',
        message: `Dashboard "${dashboardName}" has ambiguous dashboard or window identity.`,
        suggestion: 'Resolve the duplicate dashboard or window before applying this layout.',
      },
    ]);
  }
  const existing = matchingDashboards[0];
  const worksheetNames = worksheetNamesIn(fragment);
  const liveNames = new Set(
    children(root, 'worksheets').flatMap((worksheets) =>
      children(worksheets, 'worksheet').map((worksheet) =>
        normalizeParsedXmlName(worksheet.getAttribute('name') ?? ''),
      ),
    ),
  );
  const previousNames = new Set(
    (existing ? worksheetNamesIn(existing) : []).map(normalizeParsedXmlName),
  );
  const missing = worksheetNames.filter(
    (name) =>
      !liveNames.has(normalizeParsedXmlName(name)) &&
      !previousNames.has(normalizeParsedXmlName(name)),
  );
  if (missing.length > 0) {
    return Err(
      missing.map((name) => ({
        ruleId: 'dashboard-zones-reference-included-worksheets',
        severity: 'error',
        message: `Dashboard "${dashboardName}" introduces a zone referencing missing worksheet "${name}".`,
        suggestion: 'Use an existing worksheet name or remove the zone before applying.',
      })),
    );
  }
  const replacement = doc.importNode(fragment, true);
  const existingId = existing && children(existing, 'simple-id')[0];
  if (existingId && children(replacement, 'simple-id').length === 0) {
    replacement.appendChild(existingId.cloneNode(true));
  }
  if (existing) dashboards.replaceChild(replacement, existing);
  else dashboards.appendChild(replacement);
  synchronizeViewpointsInDocument(doc, dashboardName, worksheetNames);
  return Ok({ xml: new XMLSerializer().serializeToString(doc), worksheetNames });
}

export function dashboardMembershipMatches(
  workbookXml: string,
  dashboardName: string,
  worksheetNames: string[],
): boolean {
  try {
    const doc = parse(workbookXml);
    const dashboard = Array.from(doc.getElementsByTagName('dashboard')).find((element) =>
      parsedXmlNamesEqual(element.getAttribute('name') ?? '', dashboardName),
    );
    if (!dashboard) return false;
    const actual = worksheetNamesIn(dashboard);
    // Desktop can retain viewpoints for removed zones (including their zoom settings).
    // They are not active worksheet membership; every requested zone must have a view,
    // but retained, unused views do not mean the apply failed.
    const window = Array.from(doc.getElementsByTagName('window')).find(
      (element) =>
        element.getAttribute('class') === 'dashboard' &&
        parsedXmlNamesEqual(element.getAttribute('name') ?? '', dashboardName),
    );
    if (!window) return false;
    const viewpoints = children(window, 'viewpoints').flatMap((vp) => children(vp, 'viewpoint'));
    return (
      actual.length === worksheetNames.length &&
      actual.every((name) =>
        worksheetNames.some((expected) => parsedXmlNamesEqual(name, expected)),
      ) &&
      worksheetNames.every((name) =>
        viewpoints.some((vp) => parsedXmlNamesEqual(vp.getAttribute('name') ?? '', name)),
      )
    );
  } catch {
    return false;
  }
}

/** A surgical dashboard POST cannot create missing window registrations. */
export function unregisteredDashboardWorksheets(
  workbookXml: string,
  dashboardName: string,
  worksheetNames: string[],
): string[] {
  const root = parse(workbookXml).documentElement;
  if (!root || root.tagName !== 'workbook') throw new Error('Expected a workbook document.');
  const windows = children(root, 'windows').flatMap((container) =>
    children(container, 'window').filter(
      (window) =>
        window.getAttribute('class') === 'dashboard' &&
        parsedXmlNamesEqual(window.getAttribute('name') ?? '', dashboardName),
    ),
  );
  if (windows.length !== 1) return worksheetNames;
  const registered = new Set(
    children(windows[0], 'viewpoints').flatMap((container) =>
      children(container, 'viewpoint').map((viewpoint) =>
        normalizeParsedXmlName(viewpoint.getAttribute('name') ?? ''),
      ),
    ),
  );
  return worksheetNames.filter((name) => !registered.has(normalizeParsedXmlName(name)));
}

/** The workbook endpoint appends actions. Dashboard-only writes must not resubmit them. */
export function omitWorkbookActions(workbookXml: string): string {
  const doc = parse(workbookXml);
  const root = doc.documentElement;
  if (!root || root.tagName !== 'workbook') throw new Error('Expected a workbook document.');
  for (const actions of children(root, 'actions')) root.removeChild(actions);
  return new XMLSerializer().serializeToString(doc);
}
