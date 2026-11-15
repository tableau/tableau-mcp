import { DOMParser, type Element } from '@xmldom/xmldom';

import { log } from '../../logging/logger.js';
import { worksheetZoneName } from '../validation/rules/dashboardZoneContext.js';
import { parsedXmlNamesEqual } from '../xmlElement.js';

export type ZoneContent = { id?: string; zoneType?: string; worksheet?: string };

// Device layouts arrange the same worksheets in their own zones; only the main layout's ids matter.
export function dashboardZoneContents(root: Element): ZoneContent[] {
  const contents: ZoneContent[] = [];
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType !== 1 || child.nodeName !== 'zones') continue;
    for (const zone of Array.from((child as Element).getElementsByTagName('zone'))) {
      contents.push({
        id: zone.getAttribute('id') || undefined,
        zoneType: zone.getAttribute('type-v2') || undefined,
        worksheet: worksheetZoneName(zone),
      });
    }
  }
  return contents;
}

export function dashboardFragmentZoneContents(fragmentXml: string): ZoneContent[] | undefined {
  try {
    const root = new DOMParser({
      onError: (level, message) => {
        if (level !== 'warning') throw new Error(message);
      },
    }).parseFromString(fragmentXml, 'text/xml').documentElement;
    if (!root || root.tagName !== 'dashboard') return undefined;
    return dashboardZoneContents(root);
  } catch (error) {
    log({
      level: 'debug',
      message: 'Zone id checks skipped: dashboard fragment not parseable',
      logger: 'dashboardCommands',
      data: { error: String(error) },
    });
    return undefined;
  }
}

const zoneRearrangeFix =
  'To rearrange worksheets, move their whole <zone> elements into the new order. In a layout-flow container ' +
  'Desktop places zones in element order, so changing only x, y, w and h does not move them. If ' +
  'that cannot express the change, ask the user before rebuilding the dashboard with ' +
  'run-dashboard-batch replaceExisting. No changes were sent to Tableau.';

// W-24619603: Desktop crashes when an existing zone id changes worksheet.
export function findZoneWorksheetSwap(
  allLive: ZoneContent[],
  allSubmitted: ZoneContent[],
): string | undefined {
  const live = allLive.filter((zone) => zone.id);
  const submitted = allSubmitted.filter((zone) => zone.id);
  const fix = `FIX: keep each zone's id and name together, and give any new zone a new id. ${zoneRearrangeFix}`;
  const crash = 'Desktop crashes when worksheets on an existing dashboard trade zone ids.';
  for (const before of live) {
    if (before.worksheet === undefined) continue;
    const shown = JSON.stringify(before.worksheet);
    const afters = submitted.filter((zone) => zone.id === before.id);
    const container = afters.find((zone) => zone.worksheet === undefined);
    if (container) {
      const zoneType = container.zoneType ? `of type "${container.zoneType}"` : 'with no type-v2';
      return `Zone ${before.id} shows ${shown} in Desktop, but the submitted XML reuses id ${before.id} for a zone ${zoneType}. A worksheet zone's id must stay with that worksheet. ${fix}`;
    }
    for (const after of afters) {
      if (parsedXmlNamesEqual(before.worksheet, after.worksheet!)) continue;
      const moved = submitted.find(
        (zone) =>
          zone.id !== before.id &&
          zone.worksheet !== undefined &&
          parsedXmlNamesEqual(before.worksheet!, zone.worksheet),
      );
      if (moved) {
        return `Zone ${before.id} shows ${shown} in Desktop, but the submitted XML puts ${JSON.stringify(after.worksheet)} in it and moves ${shown} to zone ${moved.id}. ${crash} ${fix}`;
      }
      const movedIn = live.find(
        (zone) =>
          zone.id !== before.id &&
          zone.worksheet !== undefined &&
          parsedXmlNamesEqual(after.worksheet!, zone.worksheet),
      );
      if (movedIn) {
        return `Zone ${before.id} shows ${shown} in Desktop, but the submitted XML moves ${JSON.stringify(after.worksheet)} into it from zone ${movedIn.id}. ${crash} ${fix}`;
      }
    }
  }
  return undefined;
}

// Live testing: renumbering or dropping a worksheet zone's id in a layout-flow container failed in Desktop.
export function findZoneIdChange(
  live: ZoneContent[],
  submitted: ZoneContent[],
): string | undefined {
  for (const before of live) {
    if (before.id === undefined || before.worksheet === undefined) continue;
    if (live.filter((zone) => zone.id === before.id).length > 1) continue;
    const shown = JSON.stringify(before.worksheet);
    const showing = submitted.filter(
      (zone) =>
        zone.worksheet !== undefined && parsedXmlNamesEqual(before.worksheet!, zone.worksheet),
    );
    if (showing.length === 0 || showing.some((zone) => zone.id === before.id)) continue;
    const gives = showing[0].id === undefined ? 'no id' : `id ${showing[0].id}`;
    return (
      `Zone ${before.id} shows ${shown} in Desktop, but the submitted XML gives ${shown} ${gives}. ` +
      "In testing, changing a worksheet's zone id in a layout-flow container made Desktop fail with an internal error and leave the dashboard blank. " +
      `FIX: keep id="${before.id}" on the ${shown} zone; give only new zones new ids. ` +
      zoneRearrangeFix
    );
  }
  return undefined;
}
