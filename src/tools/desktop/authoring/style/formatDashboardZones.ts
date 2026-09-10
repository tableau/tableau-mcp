import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { DOMParser, Element as XmlElement, Node as XmlNode } from '@xmldom/xmldom';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { resolveItemByNameOrId } from '../../../../desktop/externalApi/toolUtils.js';
import { resolveSession } from '../../../../desktop/session/sessionResolution.js';
import { withApplyLock } from '../../../../desktop/wrappers/applyMutex.js';
import { sourceSha256 } from '../../../../desktop/wrappers/cacheFingerprint.js';
import { pollReadback } from '../../../../desktop/wrappers/pollReadback.js';
import { decodeXmlEntities } from '../../../../desktop/xmlElement.js';
import {
  ArgsValidationError,
  DesktopCommandExecutionError,
  XmlModificationError,
} from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { artifactNameParam, sessionParam } from '../../params.js';
import { DesktopTool } from '../../tool.js';

const scopeSchema = z.enum(['all', 'containers', 'zone_ids']);
const paramsSchema = {
  session: sessionParam(),
  dashboardName: artifactNameParam('dashboard'),
  cornerRadius: z.number().int().min(0).max(100).describe('Radius in pixels, from 0 to 100.'),
  scope: scopeSchema.describe('Zones to format.'),
  zoneIds: z.array(z.string().trim().min(1).max(255)).min(1).max(64).optional(),
};

export type DashboardZoneFormatRequest = {
  cornerRadius: number;
  scope: z.infer<typeof scopeSchema>;
  zoneIds?: string[];
};

export type FormatDashboardZonesDocumentResult =
  | { ok: true; xml: string; targetZoneIds: string[] }
  | { ok: false; message: string };

type ZoneFormatReceipt = {
  dashboard: string;
  cornerRadius: number;
  zoneIds: string[];
  verified: true;
};

const title = 'Format dashboard';

export const getFormatDashboardZonesTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'format-dashboard-zones',
    title,
    description: 'Set rounded corners on dashboard zones.',
    paramsSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (
      { session, dashboardName, cornerRadius, scope, zoneIds },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute<ZoneFormatReceipt>({
        extra,
        args: { session, dashboardName, cornerRadius, scope, zoneIds },
        callback: async () => {
          const requestError = validateRequest({ cornerRadius, scope, zoneIds });
          if (requestError !== undefined) return new ArgsValidationError(requestError).toErr();

          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) return sessionResult.error.toErr();
          const executor = await extra.getExecutor(sessionResult.value);
          const listed = await executor.listDashboards(extra.signal);
          if (listed.isErr()) return new DesktopCommandExecutionError(listed.error).toErr();
          const resolved = resolveItemByNameOrId(
            'Dashboard',
            dashboardName,
            listed.value.dashboards ?? [],
          );
          if (resolved.isErr()) return resolved.error.toErr();

          const document = await executor.getDashboardDocument(resolved.value.id, extra.signal);
          if (document.isErr()) return new DesktopCommandExecutionError(document.error).toErr();
          const versionError = unsupportedCornerRadiusVersionMessage(
            document.value.applicationVersion,
          );
          if (versionError !== undefined) {
            return new XmlModificationError(versionError).toErr();
          }
          const formatted = formatDashboardZonesDocument(document.value.xml, {
            cornerRadius,
            scope,
            zoneIds,
          });
          if (!formatted.ok) return new ArgsValidationError(formatted.message).toErr();

          if (formatted.xml !== document.value.xml) {
            const sourceHash = sourceSha256(document.value.xml);
            const applied = await withApplyLock(async () => {
              const latest = await executor.getDashboardDocument(resolved.value.id, extra.signal);
              if (latest.isErr()) return { kind: 'error' as const, error: latest.error };
              const latestVersionError = unsupportedCornerRadiusVersionMessage(
                latest.value.applicationVersion,
              );
              if (latestVersionError !== undefined) {
                return { kind: 'unsupported-version' as const, message: latestVersionError };
              }
              if (sourceSha256(latest.value.xml) !== sourceHash) {
                return { kind: 'drift' as const };
              }
              const result = await executor.applyDashboardDocument(
                resolved.value.id,
                formatted.xml,
                extra.signal,
              );
              if (result.isErr()) return { kind: 'error' as const, error: result.error };
              const warnings = result.value.warnings ?? [];
              if (warnings.length > 0) return { kind: 'warnings' as const, warnings };

              const readback = await pollReadback({
                read: async () =>
                  await executor.getDashboardDocument(resolved.value.id, extra.signal),
                settled: ({ xml }) =>
                  hasExactCornerRadius(xml, formatted.targetZoneIds, cornerRadius) &&
                  hasSameDashboardStructure(xml, formatted.xml) &&
                  hasSameDashboardContent(xml, formatted.xml, formatted.targetZoneIds),
                signal: extra.signal,
              });
              if (!readback.ok) return { kind: 'error' as const, error: readback.error };
              return readback.settled
                ? { kind: 'verified' as const }
                : { kind: 'unsettled' as const };
            });
            if (applied.kind === 'error') {
              return new DesktopCommandExecutionError(applied.error).toErr();
            }
            if (applied.kind === 'drift') {
              return new XmlModificationError(
                `Dashboard "${resolved.value.name}" changed while rounded corners were being applied. Re-read and retry.`,
              ).toErr();
            }
            if (applied.kind === 'unsupported-version') {
              return new XmlModificationError(applied.message).toErr();
            }
            if (applied.kind === 'warnings') {
              return new XmlModificationError(
                `Desktop reported document warnings while applying rounded corners to dashboard "${resolved.value.name}": ${applied.warnings.map(({ message }) => message).join('; ')}`,
              ).toErr();
            }
            if (applied.kind === 'unsettled') {
              return new XmlModificationError(
                `Desktop accepted rounded corners for dashboard "${resolved.value.name}", but the exact target zones, dashboard structure or content did not survive readback.`,
              ).toErr();
            }
          }

          return new Ok({
            dashboard: resolved.value.name,
            cornerRadius,
            zoneIds: formatted.targetZoneIds,
            verified: true,
          });
        },
      });
    },
  });
  return tool;
};

export function formatDashboardZonesDocument(
  dashboardXml: string,
  request: DashboardZoneFormatRequest,
): FormatDashboardZonesDocumentResult {
  const requestError = validateRequest(request);
  if (requestError !== undefined) return { ok: false, message: requestError };
  const parsed = parseDashboardZones(dashboardXml);
  if (!parsed.ok) return parsed;

  const requested = new Set(request.zoneIds ?? []);
  const targets = parsed.zones.filter((zone) => {
    if (request.scope === 'all') return true;
    if (request.scope === 'containers') {
      return zone.typeV2 === 'layout-basic' || zone.typeV2 === 'layout-flow';
    }
    return requested.has(zone.id);
  });
  if (request.scope === 'zone_ids') {
    const found = new Set(targets.map(({ id }) => id));
    const missing = (request.zoneIds ?? []).filter((id) => !found.has(id));
    if (missing.length > 0) {
      return { ok: false, message: `Dashboard zone ids were not found: ${missing.join(', ')}.` };
    }
  }
  if (targets.length === 0) {
    return { ok: false, message: `No dashboard zones matched scope "${request.scope}".` };
  }

  const edits: TextEdit[] = [];
  for (const zone of targets) {
    if (zone.selfClosing) {
      return {
        ok: false,
        message: `Dashboard zone "${zone.id}" is self-closing and cannot contain a zone-style.`,
      };
    }
    if (zone.directStyles.length > 1) {
      return {
        ok: false,
        message: `Dashboard zone "${zone.id}" has more than one direct zone-style.`,
      };
    }
    const style = zone.directStyles[0];
    if (style === undefined) {
      edits.push({
        start: zone.closeStart,
        end: zone.closeStart,
        text: renderZoneStyle(request.cornerRadius),
      });
      continue;
    }
    if (style.cornerFormats.length > 1) {
      return {
        ok: false,
        message: `Dashboard zone "${zone.id}" has more than one direct corner-radius format.`,
      };
    }
    const format = style.cornerFormats[0];
    if (format !== undefined) {
      if (format.value === String(request.cornerRadius)) continue;
      edits.push({
        start: format.valueStart,
        end: format.valueEnd,
        text: String(request.cornerRadius),
      });
      continue;
    }
    if (style.selfClosing) {
      const rawStyle = dashboardXml.slice(style.start, style.end);
      const selfClosingSlash = /\/(\s*)>$/.exec(rawStyle);
      if (selfClosingSlash === null) {
        return {
          ok: false,
          message: `Dashboard zone "${zone.id}" has a zone-style that cannot be expanded safely.`,
        };
      }
      edits.push({
        start: style.start + selfClosingSlash.index,
        end: style.start + selfClosingSlash.index + 1,
        text: '',
      });
      edits.push({
        start: style.end,
        end: style.end,
        text: `${renderCornerFormat(request.cornerRadius)}</zone-style>`,
      });
      continue;
    }
    edits.push({
      start: style.closeStart,
      end: style.closeStart,
      text: renderCornerFormat(request.cornerRadius),
    });
  }

  return {
    ok: true,
    xml: applyTextEdits(dashboardXml, edits),
    targetZoneIds: targets.map(({ id }) => id),
  };
}

function hasExactCornerRadius(xml: string, targetZoneIds: string[], radius: number): boolean {
  const parsed = parseDashboardZones(xml);
  if (!parsed.ok) return false;
  const byId = new Map(parsed.zones.map((zone) => [zone.id, zone]));
  return targetZoneIds.every((id) => {
    const zone = byId.get(id);
    if (zone?.directStyles.length !== 1) return false;
    const formats = zone.directStyles[0].cornerFormats;
    return formats.length === 1 && formats[0].value === String(radius);
  });
}

function validateRequest(request: DashboardZoneFormatRequest): string | undefined {
  if (
    !Number.isInteger(request.cornerRadius) ||
    request.cornerRadius < 0 ||
    request.cornerRadius > 100
  ) {
    return 'cornerRadius must be an integer from 0 to 100.';
  }
  const zoneIds = request.zoneIds;
  if (request.scope === 'zone_ids' && (zoneIds === undefined || zoneIds.length === 0)) {
    return 'zoneIds is required when scope is "zone_ids".';
  }
  if (request.scope !== 'zone_ids' && zoneIds !== undefined) {
    return 'zoneIds is only allowed when scope is "zone_ids".';
  }
  if (zoneIds !== undefined && new Set(zoneIds).size !== zoneIds.length) {
    return 'zoneIds must not contain duplicates.';
  }
  return undefined;
}

type TextEdit = { start: number; end: number; text: string };
type CornerFormat = {
  value: string;
  valueStart: number;
  valueEnd: number;
};
type ZoneStyle = {
  start: number;
  openEnd: number;
  closeStart: number;
  end: number;
  selfClosing: boolean;
  cornerFormats: CornerFormat[];
};
type Zone = {
  id: string;
  selfClosing: boolean;
  parentZoneId?: string;
  name?: string;
  typeV2?: string;
  x?: string;
  y?: string;
  w?: string;
  h?: string;
  start: number;
  openEnd: number;
  closeStart: number;
  end: number;
  directStyles: ZoneStyle[];
};
type Frame = {
  name: string;
  start: number;
  openEnd: number;
  zone?: Zone;
  zoneStyle?: ZoneStyle;
};
type Tag = {
  start: number;
  end: number;
  raw: string;
  name: string;
  closing: boolean;
  selfClosing: boolean;
};

function parseDashboardZones(
  xml: string,
): { ok: true; zones: Zone[] } | { ok: false; message: string } {
  const scanned = scanTags(xml);
  if (!scanned.ok) return scanned;
  const zones: Zone[] = [];
  const stack: Frame[] = [];
  let dashboardCount = 0;

  for (const tag of scanned.tags) {
    if (tag.closing) {
      const frame = stack.at(-1);
      if (frame?.name !== tag.name) {
        return { ok: false, message: 'Malformed dashboard: element tags are not balanced.' };
      }
      stack.pop();
      if (frame.zone !== undefined) {
        frame.zone.closeStart = tag.start;
        frame.zone.end = tag.end;
      }
      if (frame.zoneStyle !== undefined) {
        frame.zoneStyle.closeStart = tag.start;
        frame.zoneStyle.end = tag.end;
      }
      continue;
    }

    const parent = stack.at(-1);
    if (tag.name === 'dashboard') dashboardCount += 1;
    const withinDashboard =
      stack.some(({ name }) => name === 'dashboard') || tag.name === 'dashboard';
    if (tag.name === 'zone' && !withinDashboard) {
      return { ok: false, message: 'Malformed dashboard: a zone is outside the dashboard.' };
    }

    const frame: Frame = { name: tag.name, start: tag.start, openEnd: tag.end };
    if (tag.name === 'zone') {
      const id = readAttribute(tag.raw, 'id');
      if (id === undefined || id === '') {
        return { ok: false, message: 'Malformed dashboard: every zone needs an id.' };
      }
      const zone: Zone = {
        id,
        selfClosing: tag.selfClosing,
        parentZoneId: [...stack].reverse().find(({ zone }) => zone !== undefined)?.zone?.id,
        name: readAttribute(tag.raw, 'name'),
        typeV2: readAttribute(tag.raw, 'type-v2'),
        x: readAttribute(tag.raw, 'x'),
        y: readAttribute(tag.raw, 'y'),
        w: readAttribute(tag.raw, 'w'),
        h: readAttribute(tag.raw, 'h'),
        start: tag.start,
        openEnd: tag.end,
        closeStart: tag.end,
        end: tag.end,
        directStyles: [],
      };
      zones.push(zone);
      frame.zone = zone;
    }
    if (tag.name === 'zone-style' && parent?.zone !== undefined) {
      const style: ZoneStyle = {
        start: tag.start,
        openEnd: tag.end,
        closeStart: tag.end,
        end: tag.end,
        selfClosing: tag.selfClosing,
        cornerFormats: [],
      };
      parent.zone.directStyles.push(style);
      frame.zoneStyle = style;
    }
    if (tag.name === 'format' && parent?.zoneStyle !== undefined) {
      const attr = readAttribute(tag.raw, 'attr');
      if (attr === 'corner-radius') {
        if (!tag.selfClosing) {
          return {
            ok: false,
            message: 'Malformed dashboard: corner-radius formats must be self-closing.',
          };
        }
        const value = readAttributeValueSpan(tag.raw, 'value');
        if (value === undefined) {
          return {
            ok: false,
            message:
              'Malformed dashboard: a corner-radius format needs exactly one value attribute.',
          };
        }
        parent.zoneStyle.cornerFormats.push({
          value: value.value,
          valueStart: tag.start + value.start,
          valueEnd: tag.start + value.end,
        });
      }
    }

    if (!tag.selfClosing) stack.push(frame);
  }

  if (stack.length > 0 || dashboardCount !== 1) {
    return { ok: false, message: 'Malformed dashboard: expected one balanced dashboard.' };
  }
  const seen = new Set<string>();
  for (const zone of zones) {
    if (seen.has(zone.id)) {
      return { ok: false, message: `Malformed dashboard: duplicate zone id "${zone.id}".` };
    }
    seen.add(zone.id);
  }
  return { ok: true, zones };
}

function hasSameDashboardStructure(leftXml: string, rightXml: string): boolean {
  const left = parseDashboardZones(leftXml);
  const right = parseDashboardZones(rightXml);
  if (!left.ok || !right.ok) return false;
  return zoneStructureSignature(left.zones) === zoneStructureSignature(right.zones);
}

function zoneStructureSignature(zones: Zone[]): string {
  return JSON.stringify(
    zones.map(({ id, selfClosing, parentZoneId, name, typeV2, x, y, w, h }) => ({
      id,
      selfClosing,
      parentZoneId,
      name,
      typeV2,
      x,
      y,
      w,
      h,
    })),
  );
}

function hasSameDashboardContent(
  readbackXml: string,
  intendedXml: string,
  targetZoneIds: string[],
): boolean {
  const readback = parseDashboardElement(readbackXml);
  const intended = parseDashboardElement(intendedXml);
  if (readback === undefined || intended === undefined) return false;

  const targetZoneStyleIds = new Set(targetZoneIds);
  const radiusOnlyZoneStyleIds = new Set(
    targetZoneIds.filter((id) => {
      const style = directZoneStyle(findZoneElement(intended, id));
      return style !== undefined && isRadiusOnlyStyle(style);
    }),
  );
  for (const id of radiusOnlyZoneStyleIds) {
    const style = directZoneStyle(findZoneElement(readback, id));
    if (style === undefined || !isAllowedDesktopNormalizedRadiusStyle(style)) return false;
  }

  return (
    JSON.stringify(canonicalElement(readback, targetZoneStyleIds, radiusOnlyZoneStyleIds)) ===
    JSON.stringify(canonicalElement(intended, targetZoneStyleIds, radiusOnlyZoneStyleIds))
  );
}

function parseDashboardElement(xml: string): XmlElement | undefined {
  let malformed = false;
  const document = new DOMParser({
    onError: () => {
      malformed = true;
    },
  }).parseFromString(xml, 'text/xml');
  const root = document.documentElement;
  if (malformed || root?.tagName !== 'dashboard') return undefined;
  return root;
}

function canonicalElement(
  element: XmlElement,
  targetZoneStyleIds: Set<string>,
  radiusOnlyZoneStyleIds: Set<string>,
): unknown {
  const attributes: [string, string][] = [];
  for (let index = 0; index < element.attributes.length; index += 1) {
    const attribute = element.attributes.item(index);
    if (attribute !== null) {
      attributes.push([
        attribute.name,
        canonicalAttributeValue(element, attribute.name, attribute.value),
      ]);
    }
  }
  attributes.sort(([left], [right]) => left.localeCompare(right));

  const children: unknown[] = [];
  let directStyle: unknown;
  const zoneId = element.tagName === 'zone' ? (element.getAttribute('id') ?? '') : '';
  for (let child: XmlNode | null = element.firstChild; child !== null; child = child.nextSibling) {
    if (child.nodeType === 1) {
      const childElement = child as XmlElement;
      if (radiusOnlyZoneStyleIds.has(zoneId) && childElement.tagName === 'zone-style') {
        directStyle = canonicalRadiusOnlyStyle(
          childElement,
          targetZoneStyleIds,
          radiusOnlyZoneStyleIds,
        );
      } else if (targetZoneStyleIds.has(zoneId) && childElement.tagName === 'zone-style') {
        children.push(
          canonicalTargetZoneStyle(childElement, targetZoneStyleIds, radiusOnlyZoneStyleIds),
        );
      } else {
        children.push(canonicalElement(childElement, targetZoneStyleIds, radiusOnlyZoneStyleIds));
      }
    } else if ((child.nodeType === 3 || child.nodeType === 4) && child.nodeValue?.trim()) {
      children.push({ text: child.nodeValue });
    }
  }
  return {
    name: element.tagName,
    attributes,
    children,
    ...(directStyle === undefined ? {} : { directStyle }),
  };
}

function canonicalRadiusOnlyStyle(
  style: XmlElement,
  targetZoneStyleIds: Set<string>,
  radiusOnlyZoneStyleIds: Set<string>,
): unknown {
  const cornerFormat = directElementChildren(style).at(-1);
  return {
    name: style.tagName,
    attributes: [] as [string, string][],
    children:
      cornerFormat === undefined
        ? []
        : [canonicalElement(cornerFormat, targetZoneStyleIds, radiusOnlyZoneStyleIds)],
  };
}

function canonicalTargetZoneStyle(
  style: XmlElement,
  targetZoneStyleIds: Set<string>,
  radiusOnlyZoneStyleIds: Set<string>,
): unknown {
  const children = directElementChildren(style);
  const reorderable = ['corner-radius', 'margin', 'background-color'];
  const indexes = reorderable.map((attr) =>
    children.findIndex((child) => isExactFormat(child, attr)),
  );
  const canNormalizeOrder =
    style.attributes.length === 0 &&
    !hasSignificantText(style) &&
    indexes.every((index) => index >= 0) &&
    new Set(indexes).size === reorderable.length &&
    Math.max(...indexes) - Math.min(...indexes) === reorderable.length - 1 &&
    reorderable.every(
      (attr) => children.filter((child) => isExactFormat(child, attr)).length === 1,
    );
  if (!canNormalizeOrder) {
    return canonicalElement(style, targetZoneStyleIds, radiusOnlyZoneStyleIds);
  }
  const normalizedChildren = [
    ...children.slice(0, Math.min(...indexes)),
    ...reorderable.map((attr) => children.find((child) => isExactFormat(child, attr))!),
    ...children.slice(Math.max(...indexes) + 1),
  ];
  return {
    name: style.tagName,
    attributes: [] as [string, string][],
    children: normalizedChildren.map((child) =>
      canonicalElement(child, targetZoneStyleIds, radiusOnlyZoneStyleIds),
    ),
  };
}

function canonicalAttributeValue(element: XmlElement, name: string, value: string): string {
  const isRunFontColor = element.tagName === 'run' && name === 'fontcolor';
  const formatAttr = element.tagName === 'format' ? element.getAttribute('attr') : null;
  const isZoneFormatColor =
    name === 'value' && (formatAttr === 'border-color' || formatAttr === 'background-color');
  return (isRunFontColor || isZoneFormatColor) && /^#[0-9A-Fa-f]{6}$/.test(value)
    ? value.toLowerCase()
    : value;
}

function unsupportedCornerRadiusVersionMessage(
  applicationVersion: string | undefined,
): string | undefined {
  const match = /^\s*(20\d{2})\.(\d+)(?:\.\d+)?\s*$/.exec(applicationVersion ?? '');
  if (match === null) return undefined;
  const year = Number(match[1]);
  const release = Number(match[2]);
  if (year > 2026 || (year === 2026 && release >= 1)) return undefined;
  return `Setting rounded dashboard zones requires Tableau Desktop 2026.1 or newer; this session reports ${applicationVersion}. Upgrade Desktop and retry.`;
}

function findZoneElement(dashboard: XmlElement, id: string): XmlElement | undefined {
  const zones = dashboard.getElementsByTagName('zone');
  for (let index = 0; index < zones.length; index += 1) {
    const zone = zones.item(index);
    if (zone?.getAttribute('id') === id) return zone;
  }
  return undefined;
}

function directZoneStyle(zone: XmlElement | undefined): XmlElement | undefined {
  if (zone === undefined) return undefined;
  const styles = directElementChildren(zone).filter(({ tagName }) => tagName === 'zone-style');
  return styles.length === 1 ? styles[0] : undefined;
}

function directElementChildren(element: XmlElement): XmlElement[] {
  const children: XmlElement[] = [];
  for (let child: XmlNode | null = element.firstChild; child !== null; child = child.nextSibling) {
    if (child.nodeType === 1) children.push(child as XmlElement);
  }
  return children;
}

function isRadiusOnlyStyle(style: XmlElement): boolean {
  const children = directElementChildren(style);
  return (
    style.attributes.length === 0 &&
    !hasSignificantText(style) &&
    children.length === 1 &&
    isExactFormat(children[0], 'corner-radius')
  );
}

function isAllowedDesktopNormalizedRadiusStyle(style: XmlElement): boolean {
  if (style.attributes.length > 0 || hasSignificantText(style)) return false;
  const children = directElementChildren(style);
  if (children.length === 1) return isExactFormat(children[0], 'corner-radius');
  return (
    children.length === 4 &&
    isExactFormat(children[0], 'border-color', '#444444') &&
    isExactFormat(children[1], 'border-style', 'none') &&
    isExactFormat(children[2], 'border-width', '0') &&
    isExactFormat(children[3], 'corner-radius')
  );
}

function isExactFormat(element: XmlElement, attr: string, value?: string): boolean {
  return (
    element.tagName === 'format' &&
    element.attributes.length === 2 &&
    element.getAttribute('attr') === attr &&
    (value === undefined || element.getAttribute('value') === value) &&
    element.hasAttribute('value') &&
    directElementChildren(element).length === 0 &&
    !hasSignificantText(element)
  );
}

function hasSignificantText(element: XmlElement): boolean {
  for (let child: XmlNode | null = element.firstChild; child !== null; child = child.nextSibling) {
    if ((child.nodeType === 3 || child.nodeType === 4) && child.nodeValue?.trim()) return true;
  }
  return false;
}

function scanTags(xml: string): { ok: true; tags: Tag[] } | { ok: false; message: string } {
  const tags: Tag[] = [];
  let cursor = 0;
  while (cursor < xml.length) {
    const start = xml.indexOf('<', cursor);
    if (start === -1) break;
    if (xml.startsWith('<!--', start)) {
      const end = xml.indexOf('-->', start + 4);
      if (end === -1) return { ok: false, message: 'Malformed dashboard: unclosed comment.' };
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', start)) {
      const end = xml.indexOf(']]>', start + 9);
      if (end === -1) return { ok: false, message: 'Malformed dashboard: unclosed CDATA.' };
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith('<?', start)) {
      const end = xml.indexOf('?>', start + 2);
      if (end === -1) return { ok: false, message: 'Malformed dashboard: unclosed instruction.' };
      cursor = end + 2;
      continue;
    }

    const end = findTagEnd(xml, start);
    if (end === -1) return { ok: false, message: 'Malformed dashboard: unclosed element.' };
    const raw = xml.slice(start, end + 1);
    if (raw.startsWith('<!')) {
      cursor = end + 1;
      continue;
    }
    const match = /^<\s*(\/?)\s*([A-Za-z_][\w:.-]*)/.exec(raw);
    if (match === null) {
      return { ok: false, message: 'Malformed dashboard: invalid element tag.' };
    }
    tags.push({
      start,
      end: end + 1,
      raw,
      name: match[2],
      closing: match[1] === '/',
      selfClosing: /\/\s*>$/.test(raw),
    });
    cursor = end + 1;
  }
  return { ok: true, tags };
}

function findTagEnd(xml: string, start: number): number {
  let quote: "'" | '"' | undefined;
  for (let index = start + 1; index < xml.length; index += 1) {
    const character = xml[index];
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === '>') return index;
  }
  return -1;
}

function readAttribute(tag: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const value = new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(['"])(.*?)\\1`, 'i').exec(tag)?.[2];
  return value === undefined ? undefined : decodeXmlEntities(value);
}

function readAttributeValueSpan(
  tag: string,
  name: string,
): { value: string; start: number; end: number } | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...tag.matchAll(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(['"])(.*?)\\1`, 'gi'))];
  if (matches.length !== 1) return undefined;
  const match = matches[0];
  const matchStart = match.index;
  const quote = match[1];
  const rawValue = match[2];
  if (matchStart === undefined || quote === undefined || rawValue === undefined) return undefined;
  const quoteStart = match[0].indexOf(quote);
  if (quoteStart === -1) return undefined;
  const start = matchStart + quoteStart + 1;
  return { value: decodeXmlEntities(rawValue), start, end: start + rawValue.length };
}

function renderZoneStyle(radius: number): string {
  return `<zone-style>${renderCornerFormat(radius)}</zone-style>`;
}

function renderCornerFormat(radius: number): string {
  return `<format attr='corner-radius' value='${radius}' />`;
}

function applyTextEdits(xml: string, edits: TextEdit[]): string {
  const ordered = [...edits].sort((left, right) => right.start - left.start);
  let previousStart = xml.length + 1;
  let result = xml;
  for (const edit of ordered) {
    if (edit.end > previousStart) return xml;
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
    previousStart = edit.start;
  }
  return result;
}
