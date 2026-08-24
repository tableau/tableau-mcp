import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { escapeXml } from '../../../../desktop/binder/escape.js';
import { resolveItemByNameOrId } from '../../../../desktop/externalApi/toolUtils.js';
import { normalizeArray, parseXML } from '../../../../desktop/metadata/parser.js';
import { ParsedWindow } from '../../../../desktop/metadata/types.js';
import { resolveSession } from '../../../../desktop/session/sessionResolution.js';
import {
  introducedBlockingValidationIssues,
  runValidation,
} from '../../../../desktop/validation/registry.js';
import { withApplyLock } from '../../../../desktop/wrappers/applyMutex.js';
import { sourceSha256 } from '../../../../desktop/wrappers/cacheFingerprint.js';
import { pollReadback } from '../../../../desktop/wrappers/pollReadback.js';
import {
  ArgsValidationError,
  DesktopCommandExecutionError,
  XmlModificationError,
} from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { sessionParam } from '../../params.js';
import { DesktopTool } from '../../tool.js';

const dashboardSchema = z.object({
  dashboard: z.string().trim().min(1).max(255),
  label: z.string().trim().min(1).max(40).optional(),
});

const paramsSchema = {
  session: sessionParam(),
  dashboards: z.array(dashboardSchema).min(2).max(4),
};

type NavigationTarget = {
  name: string;
  label: string;
  windowUuid: string;
};

export type DashboardNavigationDocumentResult =
  | { ok: true; xml: string }
  | { ok: false; message: string };

type PreparedDashboard = {
  id: string;
  name: string;
  sourceXml: string;
  intendedXml: string;
  links: string[];
};

const title = 'Set dashboard navigation';

export const getSetDashboardNavigationTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'set-dashboard-navigation',
    title,
    description: 'Add a consistent native navigation row to dashboards with a top title band.',
    paramsSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session, dashboards }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { session, dashboards },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) return sessionResult.error.toErr();
          const executor = await extra.getExecutor(sessionResult.value);

          const listed = await executor.listDashboards(extra.signal);
          if (listed.isErr()) return new DesktopCommandExecutionError(listed.error).toErr();
          const workbook = await executor.getWorkbookDocument(extra.signal);
          if (workbook.isErr()) return new DesktopCommandExecutionError(workbook.error).toErr();
          const windowUuids = readDashboardWindowUuids(workbook.value.xml);

          const targets: Array<NavigationTarget & { id: string }> = [];
          for (const request of dashboards) {
            const resolved = resolveItemByNameOrId(
              'Dashboard',
              request.dashboard,
              listed.value.dashboards ?? [],
            );
            if (resolved.isErr()) return resolved.error.toErr();
            const windowUuid = windowUuids.get(normalizeName(resolved.value.name));
            if (!windowUuid) {
              return new ArgsValidationError(
                `Dashboard "${resolved.value.name}" has no resolvable dashboard window UUID. No navigation was applied.`,
              ).toErr();
            }
            targets.push({
              id: resolved.value.id,
              name: resolved.value.name,
              label: request.label ?? resolved.value.name,
              windowUuid,
            });
          }

          const targetNames = targets.map(({ name }) => normalizeName(name));
          if (new Set(targetNames).size !== targetNames.length) {
            return new ArgsValidationError('Navigation dashboards must be distinct.').toErr();
          }

          const prepared: PreparedDashboard[] = [];
          for (const target of targets) {
            const document = await executor.getDashboardDocument(target.id, extra.signal);
            if (document.isErr()) {
              return new DesktopCommandExecutionError(document.error).toErr();
            }
            const transformed = setDashboardNavigationDocument(
              document.value.xml,
              target.name,
              targets,
            );
            if (!transformed.ok) {
              return new ArgsValidationError(
                `Dashboard "${target.name}": ${transformed.message}`,
              ).toErr();
            }
            const introduced = introducedBlockingValidationIssues(
              runValidation(document.value.xml, 'dashboard').issues,
              runValidation(transformed.xml, 'dashboard').issues,
            );
            if (introduced.length > 0) {
              return new ArgsValidationError(
                `Dashboard "${target.name}" failed navigation preflight: ${introduced.map(({ message }) => message).join(' ')}`,
              ).toErr();
            }
            prepared.push({
              id: target.id,
              name: target.name,
              sourceXml: document.value.xml,
              intendedXml: transformed.xml,
              links: targets.filter(({ name }) => name !== target.name).map(({ name }) => name),
            });
          }

          const completed: Array<{ dashboard: string; links: string[]; verified: true }> = [];
          for (const dashboard of prepared) {
            if (!navigationMatches(dashboard.sourceXml, dashboard.intendedXml)) {
              const sourceHash = sourceSha256(dashboard.sourceXml);
              const applied = await withApplyLock(async () => {
                const latest = await executor.getDashboardDocument(dashboard.id, extra.signal);
                if (latest.isErr()) return { kind: 'error' as const, error: latest.error };
                if (sourceSha256(latest.value.xml) !== sourceHash) {
                  return { kind: 'drift' as const };
                }
                const result = await executor.applyDashboardDocument(
                  dashboard.id,
                  dashboard.intendedXml,
                  extra.signal,
                );
                return result.isErr()
                  ? { kind: 'error' as const, error: result.error }
                  : { kind: 'applied' as const };
              });
              if (applied.kind === 'error') {
                return new DesktopCommandExecutionError(applied.error).toErr();
              }
              if (applied.kind === 'drift') {
                return new XmlModificationError(
                  `Dashboard "${dashboard.name}" changed while navigation was being applied. ${completed.length} earlier dashboard(s) may already be updated.`,
                ).toErr();
              }

              const readback = await pollReadback({
                read: async () => await executor.getDashboardDocument(dashboard.id, extra.signal),
                settled: ({ xml }) => navigationMatches(xml, dashboard.intendedXml),
                signal: extra.signal,
              });
              if (!readback.ok) return new DesktopCommandExecutionError(readback.error).toErr();
              if (!readback.settled) {
                return new XmlModificationError(
                  `Desktop accepted navigation for "${dashboard.name}", but the title band or buttons did not survive readback.`,
                ).toErr();
              }
            }
            completed.push({ dashboard: dashboard.name, links: dashboard.links, verified: true });
          }

          return new Ok({ dashboards: completed });
        },
      });
    },
  });
  return tool;
};

export function setDashboardNavigationDocument(
  dashboardXml: string,
  currentDashboard: string,
  targets: NavigationTarget[],
): DashboardNavigationDocumentResult {
  const links = targets.filter(
    ({ name }) => normalizeName(name) !== normalizeName(currentDashboard),
  );
  if (links.length < 1 || links.length > 3) {
    return { ok: false, message: 'Navigation needs one to three other dashboards.' };
  }

  const rootZones = findFirstElement(dashboardXml, 'zones');
  if (!rootZones) return { ok: false, message: 'The dashboard has no root zones container.' };
  const rootInner = dashboardXml.slice(rootZones.contentStart, rootZones.contentEnd);
  const rootChildren = findDirectElements(rootInner, 'zone');
  const layout = rootChildren.find(({ openTag }) =>
    hasAttributeValue(openTag, 'type-v2', 'layout-basic'),
  );
  if (!layout) return { ok: false, message: 'The dashboard has no layout-basic container.' };

  const layoutXml = rootInner.slice(layout.start, layout.end);
  const layoutRoot = findFirstElement(layoutXml, 'zone');
  if (!layoutRoot) return { ok: false, message: 'The dashboard layout is malformed.' };
  const layoutInner = layoutXml.slice(layoutRoot.contentStart, layoutRoot.contentEnd);
  const titleBand = findTitleBand(layoutInner);
  if (!titleBand) {
    return {
      ok: false,
      message: 'A full-width top title band is required so navigation cannot overlap charts.',
    };
  }

  const buttonWidth = 15_000;
  const titleWidth = 100_000 - buttonWidth * links.length;
  const titleHeight = readIntegerAttribute(titleBand.openTag, 'h')!;
  const expectedButtons: NavigationButtonSignature[] = links.map((target, index) => ({
    type: 'dashboard-object',
    x: titleWidth + index * buttonWidth,
    y: 0,
    width: buttonWidth,
    height: titleHeight,
    buttonType: 'text',
    action: `tabdoc:goto-sheet window-id=&quot;${escapeXml(target.windowUuid)}&quot;`,
    caption: escapeXml(target.label),
  }));
  const safety = checkNavigationBandSafety({
    rootInner,
    rootChildren,
    layout,
    layoutInner,
    titleBand,
    titleHeight,
    titleWidth,
    expectedButtons,
  });
  if (!safety.ok) return safety;
  if (safety.exactRequestedNavigation) return { ok: true, xml: dashboardXml };

  const nextTitleTag = upsertAttribute(titleBand.openTag, 'w', String(titleWidth));
  const nextLayoutInner =
    layoutInner.slice(0, titleBand.start) +
    nextTitleTag +
    layoutInner.slice(titleBand.start + titleBand.openTag.length);
  const nextLayoutXml =
    layoutXml.slice(0, layoutRoot.contentStart) +
    nextLayoutInner +
    layoutXml.slice(layoutRoot.contentEnd);

  let nextId = maxZoneId(dashboardXml) + 1;
  const buttons = links
    .map((target, index) => {
      const x = titleWidth + index * buttonWidth;
      return `<zone h='${titleHeight}' id='${nextId++}' type-v2='dashboard-object' w='${buttonWidth}' x='${x}' y='0'><button button-type='text' action='tabdoc:goto-sheet window-id=&quot;${escapeXml(target.windowUuid)}&quot;'><button-visual-state><caption>${escapeXml(target.label)}</caption></button-visual-state></button></zone>`;
    })
    .join('');

  let cursor = 0;
  const rootParts: string[] = [];
  for (const child of rootChildren) {
    rootParts.push(rootInner.slice(cursor, child.start));
    const childXml = rootInner.slice(child.start, child.end);
    if (child === layout) rootParts.push(nextLayoutXml);
    else rootParts.push(childXml);
    cursor = child.end;
  }
  rootParts.push(rootInner.slice(cursor), buttons);
  const nextRootInner = rootParts.join('');

  return {
    ok: true,
    xml:
      dashboardXml.slice(0, rootZones.contentStart) +
      nextRootInner +
      dashboardXml.slice(rootZones.contentEnd),
  };
}

function readDashboardWindowUuids(workbookXml: string): Map<string, string> {
  try {
    const parsed = parseXML(workbookXml);
    return new Map(
      normalizeArray<ParsedWindow>(parsed.workbook?.windows?.window)
        .filter((window) => window['@_class'] === 'dashboard' && window['simple-id']?.['@_uuid'])
        .map((window) => [normalizeName(window['@_name']), window['simple-id']!['@_uuid']]),
    );
  } catch {
    return new Map();
  }
}

type ElementBounds = {
  start: number;
  openEnd: number;
  contentStart: number;
  contentEnd: number;
  end: number;
  openTag: string;
};

type NavigationBandZone = {
  element: ElementBounds;
  xml: string;
  parentage: 'root' | `layout:${number}`;
};

type NavigationBandGeometry = 'clear' | 'overlap' | 'unknown';

function findFirstElement(xml: string, tag: string): ElementBounds | undefined {
  return findDirectElements(xml, tag)[0];
}

function findDirectElements(xml: string, tag: string): ElementBounds[] {
  const token = new RegExp(`<\\/?${tag}(?=\\s|/|>)[^>]*>`, 'g');
  const results: ElementBounds[] = [];
  let depth = 0;
  let current: Omit<ElementBounds, 'contentEnd' | 'end'> | undefined;
  for (const match of xml.matchAll(token)) {
    const start = match.index;
    const text = match[0];
    const closing = text.startsWith('</');
    const selfClosing = /\/\s*>$/.test(text);
    if (!closing) {
      if (depth === 0) {
        current = {
          start,
          openEnd: start + text.length,
          contentStart: start + text.length,
          openTag: text,
        };
      }
      if (selfClosing) {
        if (depth === 0 && current) {
          results.push({ ...current, contentEnd: current.contentStart, end: start + text.length });
          current = undefined;
        }
      } else {
        depth += 1;
      }
      continue;
    }
    depth -= 1;
    if (depth === 0 && current) {
      results.push({ ...current, contentEnd: start, end: start + text.length });
      current = undefined;
    }
  }
  return results;
}

function findElementsAtAnyDepth(
  xml: string,
  tag: string,
  depth = 1,
  offset = 0,
): Array<{ element: ElementBounds; depth: number }> {
  return findDirectElements(xml, tag).flatMap((element) => {
    const shifted = {
      ...element,
      start: element.start + offset,
      openEnd: element.openEnd + offset,
      contentStart: element.contentStart + offset,
      contentEnd: element.contentEnd + offset,
      end: element.end + offset,
    };
    const inner = xml.slice(element.contentStart, element.contentEnd);
    return [
      { element: shifted, depth },
      ...findElementsAtAnyDepth(inner, tag, depth + 1, offset + element.contentStart),
    ];
  });
}

function collectNavigationBandZones(
  rootInner: string,
  rootChildren: ElementBounds[],
  layout: ElementBounds,
  layoutInner: string,
  titleBand: ElementBounds,
): NavigationBandZone[] {
  const rootZones = rootChildren
    .filter((child) => child !== layout)
    .map((element) => ({
      element,
      xml: rootInner.slice(element.start, element.end),
      parentage: 'root' as const,
    }));
  const layoutZones = findElementsAtAnyDepth(layoutInner, 'zone')
    .filter(({ element }) => element.start !== titleBand.start || element.end !== titleBand.end)
    .map(({ element, depth }) => ({
      element,
      xml: layoutInner.slice(element.start, element.end),
      parentage: `layout:${depth}` as const,
    }));
  return [...rootZones, ...layoutZones];
}

function checkNavigationBandSafety({
  rootInner,
  rootChildren,
  layout,
  layoutInner,
  titleBand,
  titleHeight,
  titleWidth,
  expectedButtons,
}: {
  rootInner: string;
  rootChildren: ElementBounds[];
  layout: ElementBounds;
  layoutInner: string;
  titleBand: ElementBounds;
  titleHeight: number;
  titleWidth: number;
  expectedButtons: NavigationButtonSignature[];
}): { ok: true; exactRequestedNavigation: boolean } | { ok: false; message: string } {
  const zones = collectNavigationBandZones(
    rootInner,
    rootChildren,
    layout,
    layoutInner,
    titleBand,
  ).map((zone) => ({
    ...zone,
    geometry: navigationBandGeometry(zone.element.openTag, titleHeight),
  }));
  const existingTopNavigation = zones.filter(
    ({ xml, geometry }) => xml.includes('tabdoc:goto-sheet') && geometry !== 'clear',
  );
  let exactRequestedNavigation = false;
  if (existingTopNavigation.length > 0) {
    const existingButtons = existingTopNavigation.map(({ element, xml }) =>
      readNavigationButton(element.openTag, xml),
    );
    exactRequestedNavigation =
      existingTopNavigation.every(({ parentage }) => parentage === 'root') &&
      readIntegerAttribute(titleBand.openTag, 'w') === titleWidth &&
      existingButtons.every((button) => button !== undefined) &&
      JSON.stringify(existingButtons) === JSON.stringify(expectedButtons);
    if (!exactRequestedNavigation) {
      return {
        ok: false,
        message: 'A different existing navigation row occupies the top title band.',
      };
    }
  }

  const unsafeZone = zones.find(
    (zone) =>
      !(exactRequestedNavigation && existingTopNavigation.includes(zone)) &&
      zone.geometry !== 'clear',
  );
  if (unsafeZone?.geometry === 'unknown') {
    return {
      ok: false,
      message: 'A preserved zone has unknown geometry, so navigation overlap cannot be ruled out.',
    };
  }
  if (unsafeZone) {
    return {
      ok: false,
      message: 'A preserved zone would overlap the generated title or navigation buttons.',
    };
  }
  return { ok: true, exactRequestedNavigation };
}

function navigationMatches(actualXml: string, intendedXml: string): boolean {
  const actual = navigationSignature(actualXml);
  const intended = navigationSignature(intendedXml);
  return actual !== undefined && intended !== undefined && actual === intended;
}

function navigationSignature(xml: string): string | undefined {
  const rootZones = findFirstElement(xml, 'zones');
  if (!rootZones) return undefined;
  const inner = xml.slice(rootZones.contentStart, rootZones.contentEnd);
  const children = findDirectElements(inner, 'zone');
  const layout = children.find(({ openTag }) =>
    hasAttributeValue(openTag, 'type-v2', 'layout-basic'),
  );
  if (!layout) return undefined;
  const layoutXml = inner.slice(layout.start, layout.end);
  const layoutRoot = findFirstElement(layoutXml, 'zone');
  if (!layoutRoot) return undefined;
  const layoutInner = layoutXml.slice(layoutRoot.contentStart, layoutRoot.contentEnd);
  const titleBand = findTitleBand(layoutInner);
  if (!titleBand) return undefined;
  const title = {
    type: readAttribute(titleBand.openTag, 'type-v2'),
    x: readIntegerAttribute(titleBand.openTag, 'x'),
    y: readIntegerAttribute(titleBand.openTag, 'y'),
    width: readIntegerAttribute(titleBand.openTag, 'w'),
    height: readIntegerAttribute(titleBand.openTag, 'h'),
  };
  if (title.width === undefined || title.height === undefined) return undefined;
  const navigationZones = collectNavigationBandZones(
    inner,
    children,
    layout,
    layoutInner,
    titleBand,
  ).filter(
    ({ element, xml: zoneXml }) =>
      zoneXml.includes('tabdoc:goto-sheet') &&
      navigationBandGeometry(element.openTag, title.height!) !== 'clear',
  );
  const buttons = navigationZones.map(({ element, xml: zoneXml }) =>
    readNavigationButton(element.openTag, zoneXml),
  );
  if (buttons.some((button) => button === undefined)) return undefined;
  const validButtons = buttons as NavigationButtonSignature[];
  const safety = checkNavigationBandSafety({
    rootInner: inner,
    rootChildren: children,
    layout,
    layoutInner,
    titleBand,
    titleHeight: title.height,
    titleWidth: title.width,
    expectedButtons: validButtons,
  });
  if (!safety.ok) return undefined;
  return JSON.stringify({
    title,
    buttons: validButtons.map((button, index) => ({
      ...button,
      parentage: navigationZones[index].parentage,
    })),
  });
}

function findTitleBand(layoutInner: string): ElementBounds | undefined {
  return findDirectElements(layoutInner, 'zone').find(({ openTag }) => {
    const kind = readAttribute(openTag, 'type-v2');
    const width = readIntegerAttribute(openTag, 'w');
    const height = readIntegerAttribute(openTag, 'h');
    return (
      (kind === 'text' || kind === 'title') &&
      readIntegerAttribute(openTag, 'x') === 0 &&
      readIntegerAttribute(openTag, 'y') === 0 &&
      width !== undefined &&
      width >= 55_000 &&
      height !== undefined &&
      height >= 4_000 &&
      height <= 15_000
    );
  });
}

function navigationBandGeometry(openTag: string, height: number): NavigationBandGeometry {
  const x = readIntegerAttribute(openTag, 'x');
  const y = readIntegerAttribute(openTag, 'y');
  const width = readIntegerAttribute(openTag, 'w');
  const zoneHeight = readIntegerAttribute(openTag, 'h');
  if (x === undefined || y === undefined || width === undefined || zoneHeight === undefined) {
    return 'unknown';
  }
  return x < 100_000 && x + width > 0 && y < height && y + zoneHeight > 0 ? 'overlap' : 'clear';
}

type NavigationButtonSignature = {
  type: 'dashboard-object';
  x: number;
  y: number;
  width: number;
  height: number;
  buttonType: 'text';
  action: string;
  caption: string;
};

function readNavigationButton(
  openTag: string,
  zoneXml: string,
): NavigationButtonSignature | undefined {
  const x = readIntegerAttribute(openTag, 'x');
  const y = readIntegerAttribute(openTag, 'y');
  const width = readIntegerAttribute(openTag, 'w');
  const height = readIntegerAttribute(openTag, 'h');
  if (
    !hasAttributeValue(openTag, 'type-v2', 'dashboard-object') ||
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined
  ) {
    return undefined;
  }
  const zoneContent = zoneXml.slice(openTag.length).replace(/<\/zone>\s*$/, '');
  const button = /^\s*(<button\b[^>]*>)([\s\S]*?)<\/button>\s*$/.exec(zoneContent);
  if (!button || readAttribute(button[1], 'button-type') !== 'text') return undefined;
  const visual =
    /^\s*<button-visual-state>\s*<caption>([\s\S]*?)<\/caption>\s*<\/button-visual-state>\s*$/.exec(
      button[2],
    );
  const action = readAttribute(button[1], 'action');
  if (!visual || !action) return undefined;
  return {
    type: 'dashboard-object',
    x,
    y,
    width,
    height,
    buttonType: 'text',
    action,
    caption: visual[1],
  };
}

function maxZoneId(xml: string): number {
  return Math.max(
    0,
    ...[...xml.matchAll(/<zone\b[^>]*?\s+id\s*=\s*(['"])(\d+)\1/g)].map((match) =>
      Number(match[2]),
    ),
  );
}

function upsertAttribute(tag: string, name: string, value: string): string {
  const pattern = new RegExp(`(\\s${name}\\s*=\\s*)(['"])(.*?)\\2`, 'i');
  if (pattern.test(tag)) return tag.replace(pattern, `$1'${escapeXml(value)}'`);
  return tag.replace(/\s*\/?\s*>$/, (close) => ` ${name}='${escapeXml(value)}'${close}`);
}

function hasAttributeValue(tag: string, name: string, value: string): boolean {
  return readAttribute(tag, name) === value;
}

function readIntegerAttribute(tag: string, name: string): number | undefined {
  const value = readAttribute(tag, name);
  if (!value || !/^\d+$/.test(value)) return undefined;
  return Number(value);
}

function readAttribute(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}\\s*=\\s*(['"])(.*?)\\1`, 'i').exec(tag)?.[2];
}

function normalizeName(name: string): string {
  return name.trim().normalize('NFC');
}
