import { Document, DOMParser, Element, XMLSerializer } from '@xmldom/xmldom';
import { Err, Ok, Result } from 'ts-results-es';

import type { ValidationIssue } from '../validation/types.js';
import { normalizeParsedXmlName, parsedXmlNamesEqual } from '../xmlElement.js';
import {
  canOmitDefaultStrategy,
  capReason,
  hasDesktopManagedGeometry,
  layoutGeometryDifference,
  quoted,
  zoneLabel,
} from './dashboardLayoutGeometry.js';

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

/** The worksheet a zone shows, or undefined for containers, filters, text and other non-worksheet zones. */
export function worksheetZoneName(zone: Element): string | undefined {
  const name = zone.getAttribute('name');
  const type = zone.getAttribute('type-v2');
  return name && (!type || type === 'visual') ? name : undefined;
}

function worksheetNamesIn(dashboard: Element): string[] {
  const names = new Map<string, string>();
  for (const zone of Array.from(dashboard.getElementsByTagName('zone'))) {
    const name = worksheetZoneName(zone);
    if (name) names.set(normalizeParsedXmlName(name), name);
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
  useNativeViewpointDefaults = false,
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
      if (!useNativeViewpointDefaults) {
        const zoom = doc.createElement('zoom');
        zoom.setAttribute('type', 'entire-view');
        viewpoint.appendChild(zoom);
      }
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
  options: { useNativeViewpointDefaults?: boolean } = {},
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
  synchronizeViewpointsInDocument(
    doc,
    dashboardName,
    worksheetNames,
    options.useNativeViewpointDefaults,
  );
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

/** Prepare once before the POST; returns the first difference in plain words (undefined = match). */
export function createDashboardReadbackDiagnoser(
  candidateXml: string,
  dashboardName: string,
): (readbackXml: string) => string | undefined {
  const expected = dashboardReadbackState(parse(candidateXml), dashboardName);
  if (!expected) throw new Error('Expected an unambiguous dashboard and window.');
  const expectedNames = worksheetNamesIn(expected.dashboard);
  const diagnose = (readbackXml: string): string | undefined => {
    try {
      const actual = dashboardReadbackState(parse(readbackXml), dashboardName);
      if (!actual)
        return `Desktop does not have exactly one dashboard and one dashboard window named ${quoted(dashboardName)}`;
      const authored = authoredContentDifference(expected.dashboard, actual.dashboard);
      if (authored) return authored;
      const actualNames = worksheetNamesIn(actual.dashboard);
      if (actualNames.length !== expectedNames.length)
        return `the dashboard has ${actualNames.length} worksheet zones in Desktop, ${expectedNames.length} submitted`;
      const unexpected = actualNames.find(
        (name) => !expectedNames.some((other) => parsedXmlNamesEqual(name, other)),
      );
      if (unexpected !== undefined)
        return `worksheet ${quoted(unexpected)} is in the dashboard in Desktop but was not submitted`;
      for (const name of expectedNames) {
        const count = actual.viewpoints.filter((viewpoint) =>
          parsedXmlNamesEqual(viewpoint.getAttribute('name') ?? '', name),
        ).length;
        if (count !== 1)
          return `worksheet ${quoted(name)} has ${count} viewpoints in Desktop, expected 1`;
      }
      // Desktop can retain unused viewpoints and reorder them. Each requested view must
      // still be unique and retain the submitted settings, not merely its worksheet name.
      for (const viewpoint of expected.viewpoints) {
        const name = viewpoint.getAttribute('name') ?? '';
        const matches = actual.viewpoints.filter((other) =>
          parsedXmlNamesEqual(other.getAttribute('name') ?? '', name),
        );
        if (matches.length !== 1)
          return `worksheet ${quoted(name)} has ${matches.length} viewpoints in Desktop, expected 1`;
        const difference = authoredContentDifference(viewpoint, matches[0]);
        if (difference) return `worksheet ${quoted(name)} view settings: ${difference}`;
      }
      return undefined;
    } catch (error) {
      return `the readback could not be checked: ${error instanceof Error ? error.message : String(error)}`;
    }
  };
  return (readbackXml) => {
    const difference = diagnose(readbackXml);
    return difference === undefined ? undefined : capReason(difference);
  };
}

function dashboardReadbackState(
  doc: Document,
  dashboardName: string,
): { dashboard: Element; viewpoints: Element[] } | undefined {
  const root = doc.documentElement;
  if (!root || root.tagName !== 'workbook') return undefined;
  const dashboards = children(root, 'dashboards').flatMap((container) =>
    children(container, 'dashboard').filter((dashboard) =>
      parsedXmlNamesEqual(dashboard.getAttribute('name') ?? '', dashboardName),
    ),
  );
  const windows = children(root, 'windows').flatMap((container) =>
    children(container, 'window').filter(
      (window) =>
        window.getAttribute('class') === 'dashboard' &&
        parsedXmlNamesEqual(window.getAttribute('name') ?? '', dashboardName),
    ),
  );
  if (dashboards.length !== 1 || windows.length !== 1) return undefined;
  const containers = children(windows[0], 'viewpoints');
  if (containers.length > 1) return undefined;
  return {
    dashboard: dashboards[0],
    viewpoints: containers.flatMap((container) => children(container, 'viewpoint')),
  };
}

function expandedName(element: Element): string {
  return `${element.namespaceURI ?? ''}:${element.localName ?? element.tagName}`;
}

function elementLabel(element: Element): string {
  if (element.tagName === 'zone') return zoneLabel(element);
  const name = element.getAttribute('name');
  return `<${element.tagName}>${name ? ` ${quoted(name)}` : ''}`;
}

/** Quoted window of `value` around its first difference from `other`. */
function textAround(value: string, other: string): string {
  let at = 0;
  while (at < value.length && value[at] === other[at]) at++;
  const start = Math.max(0, at - 30);
  const end = start + 80;
  return JSON.stringify(
    `${start > 0 ? '…' : ''}${value.slice(start, end)}${end < value.length ? '…' : ''}`,
  );
}

/**
 * Compare authored attributes, ordered layout nodes, styles and text. Allow Desktop
 * to reflow automatic tiled geometry and add defaults/metadata that were not authored.
 * Never allow added/removed/reordered zones or device layouts inside authored collections.
 * Returns the first difference in plain words, or undefined when the actual element contains it.
 */
function authoredContentDifference(expected: Element, actual: Element): string | undefined {
  const label = elementLabel(expected);
  if (expandedName(expected) !== expandedName(actual))
    return `${label}: element is <${actual.tagName}> in Desktop, <${expected.tagName}> submitted`;
  for (const attribute of Array.from(expected.attributes)) {
    if (attribute.namespaceURI === 'http://www.w3.org/2000/xmlns/') continue;
    const localName = attribute.localName ?? attribute.name;
    const present = attribute.namespaceURI
      ? actual.hasAttributeNS(attribute.namespaceURI, localName)
      : actual.hasAttribute(attribute.name);
    if (
      !present &&
      attribute.name === 'layout-strategy-id' &&
      canOmitDefaultStrategy(expected, actual)
    )
      continue;
    const missing = (): string =>
      `${label}: ${attribute.name} is missing in Desktop, ${quoted(attribute.value)} submitted`;
    if (!present) return missing();
    const actualValue = attribute.namespaceURI
      ? actual.getAttributeNS(attribute.namespaceURI, localName)
      : actual.getAttribute(attribute.name);
    if (actualValue === null) return missing();
    const differs = (): string =>
      `${label}: ${attribute.name} is ${quoted(actualValue)} in Desktop, ${quoted(attribute.value)} submitted`;
    if (attribute.name === 'name') {
      if (!parsedXmlNamesEqual(attribute.value, actualValue)) return differs();
    } else if (expected.tagName === 'zone' && ['x', 'y', 'w', 'h'].includes(attribute.name)) {
      if (
        !attribute.value.trim() ||
        !actualValue.trim() ||
        !Number.isInteger(Number(attribute.value)) ||
        !Number.isInteger(Number(actualValue))
      )
        return `${differs()} (not a whole number)`;
      if (hasDesktopManagedGeometry(expected)) {
        if (
          ['w', 'h'].includes(attribute.name) &&
          Number(attribute.value) > 0 &&
          Number(actualValue) <= 0
        )
          return `${differs()} (Desktop-managed size collapsed to zero)`;
      } else if (Math.abs(Number(attribute.value) - Number(actualValue)) > 1) return differs();
    } else if (attribute.value !== actualValue) return differs();
  }
  const text = (element: Element): string => {
    const value = Array.from(element.childNodes)
      .filter((node) => node.nodeType === 3 || node.nodeType === 4)
      .map((node) => node.nodeValue ?? '')
      .join('');
    return element.tagName === 'run' || value.trim() ? value : '';
  };
  if (text(expected) !== text(actual))
    return `${label}: text is ${textAround(text(actual), text(expected))} in Desktop, ${textAround(text(expected), text(actual))} submitted`;
  const expectedChildren = children(expected);
  const expectedTags = new Set(expectedChildren.map(expandedName));
  const actualChildren = children(actual).filter(
    (child) =>
      ['zones', 'devicelayouts'].includes(expected.tagName) ||
      (expected.tagName === 'zone' && child.tagName === 'zone') ||
      expectedTags.has(expandedName(child)),
  );
  if (expectedChildren.length !== actualChildren.length) {
    const countOf = (list: Element[], child: Element): number =>
      list.filter((item) => expandedName(item) === expandedName(child)).length;
    for (const child of [...expectedChildren, ...actualChildren]) {
      const submittedCount = countOf(expectedChildren, child);
      const desktopCount = countOf(actualChildren, child);
      if (submittedCount !== desktopCount)
        return `${label} has ${desktopCount} ${child.tagName === 'zone' ? 'child zones' : `<${child.tagName}> children`} in Desktop, ${submittedCount} submitted`;
    }
  }
  const geometry = layoutGeometryDifference(expected, actual);
  if (geometry) return geometry;
  for (const [index, child] of expectedChildren.entries()) {
    const difference = authoredContentDifference(child, actualChildren[index]);
    if (difference) return difference;
  }
  return undefined;
}

/** Registrations observed in the snapshot, before any native repair during apply. */
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
