import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { DOMParser } from '@xmldom/xmldom';
import { Err, Ok } from 'ts-results-es';

import {
  READBACK_POLL_INTERVAL_MS,
  READBACK_POLL_MAX_ATTEMPTS,
} from '../../../../desktop/wrappers/pollReadback.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import {
  formatDashboardZonesDocument,
  getFormatDashboardZonesTool,
} from './formatDashboardZones.js';

const DASHBOARD_XML = `<dashboard name='Executive Overview'>
  <style><style-rule element='dashboard'><format attr='background-color' value='#FFFFFF' /></style-rule></style>
  <zones>
    <zone id='1' name='Sales'>
      <zone-style><format attr='border-color' value='#AAAAAA' /></zone-style>
    </zone>
    <zone h='5000' id='2' type-v2='layout-basic' w='6000'>
      <zone-style><format attr='corner-radius' value='4' /><format attr='padding' value='8' /></zone-style>
      <zone id='3' name='Profit'>
        <zone-style><format attr='border-color' value='#BBBBBB' /></zone-style>
      </zone>
    </zone>
    <zone id='4' type-v2='layout-basic'><zone-style /></zone>
  </zones>
  <simple-id uuid='{dashboard-1}' />
</dashboard>`;

const PRODUCTS_DASHBOARD_XML = `<dashboard name='Products'>
  <zones>
    <zone id='9' type-v2='layout-basic'>
      <zone-style><format attr='padding' value='12' /></zone-style>
      <zone id='10' type-v2='text'><zone-style><format attr='font-size' value='18' /></zone-style></zone>
      <zone id='13' type-v2='text'><zone-style><format attr='font-color' value='#222222' /></zone-style></zone>
      <zone id='11' name='Product Sales'><zone-style><format attr='border-style' value='none' /></zone-style></zone>
      <zone id='12' name='Product Profit'><zone-style><format attr='border-style' value='none' /></zone-style></zone>
    </zone>
  </zones>
</dashboard>`;

const LIVE_COMPOSED_DASHBOARD_XML = `<dashboard enable-sort-zone-taborder='true' name='Rounded Corners VIP' xmlns:user='http://www.tableausoftware.com/xml/user'>
  <style />
  <size maxheight='1000' maxwidth='1400' minheight='1000' minwidth='1400' sizing-mode='fixed' />
  <zones>
    <zone h='100000' id='9' type-v2='layout-basic' w='100000' x='0' y='0'>
      <zone h='8000' id='10' type-v2='text' w='100000' x='0' y='0'>
        <formatted-text>
          <run bold='true' fontalignment='1' fontsize='16'>Rounded Corners — Profit by Sub-Category</run>
        </formatted-text>
        <zone-style>
          <format attr='border-color' value='#000000' />
          <format attr='border-style' value='none' />
          <format attr='border-width' value='0' />
          <format attr='margin' value='4' />
        </zone-style>
      </zone>
      <zone h='92000' id='11' name='Create a horizontal bar chart of SUM(Profit) by Sub-Category.' w='100000' x='0' y='8000'>
        <zone-style>
          <format attr='border-color' value='#000000' />
          <format attr='border-style' value='none' />
          <format attr='border-width' value='0' />
          <format attr='margin' value='4' />
        </zone-style>
      </zone>
    </zone>
  </zones>
  <simple-id uuid='{4706F991-82FE-4308-8293-0A4250ABD2C9}' />
</dashboard>`;

const LIVE_ROUNDED_DASHBOARD_READBACK_XML = `<dashboard enable-sort-zone-taborder='true' name='Rounded Corners VIP' xmlns:user='http://www.tableausoftware.com/xml/user'>
  <style />
  <size maxheight='1000' maxwidth='1400' minheight='1000' minwidth='1400' sizing-mode='fixed' />
  <zones>
    <zone h='100000' id='9' type-v2='layout-basic' w='100000' x='0' y='0'>
      <zone h='8000' id='10' type-v2='text' w='100000' x='0' y='0'>
        <formatted-text>
          <run bold='true' fontalignment='1' fontsize='16'>Rounded Corners — Profit by Sub-Category</run>
        </formatted-text>
        <zone-style>
          <format attr='border-color' value='#000000' />
          <format attr='border-style' value='none' />
          <format attr='border-width' value='0' />
          <format attr='margin' value='4' />
        </zone-style>
      </zone>
      <zone h='92000' id='11' name='Create a horizontal bar chart of SUM(Profit) by Sub-Category.' w='100000' x='0' y='8000'>
        <zone-style>
          <format attr='border-color' value='#000000' />
          <format attr='border-style' value='none' />
          <format attr='border-width' value='0' />
          <format attr='margin' value='4' />
        </zone-style>
      </zone>
      <zone-style>
        <format attr='border-color' value='#444444' />
        <format attr='border-style' value='none' />
        <format attr='border-width' value='0' />
        <format attr='corner-radius' value='18' />
      </zone-style>
    </zone>
  </zones>
  <simple-id uuid='{4706F991-82FE-4308-8293-0A4250ABD2C9}' />
</dashboard>`;

const HIGH_CONTRAST_DASHBOARD_XML = `<dashboard name='Rounded Corners VIP Final'>
  <zones>
    <zone id='9' type-v2='layout-basic'>
      <zone id='10' type-v2='text'>
        <formatted-text><run fontcolor='#18233A'>Native rounded dashboard zones</run></formatted-text>
        <zone-style>
          <format attr='border-color' value='#6C5CE7' />
          <format attr='border-style' value='solid' />
          <format attr='border-width' value='4' />
          <format attr='margin' value='20' />
          <format attr='background-color' value='#FFFFFF' />
        </zone-style>
      </zone>
      <zone id='11' name='Sales by Category'>
        <zone-style>
          <format attr='border-color' value='#6C5CE7' />
          <format attr='border-style' value='solid' />
          <format attr='border-width' value='4' />
          <format attr='margin' value='20' />
          <format attr='background-color' value='#FFFFFF' />
        </zone-style>
      </zone>
      <zone-style>
        <format attr='border-color' value='#444444' />
        <format attr='border-style' value='none' />
        <format attr='border-width' value='0' />
        <format attr='corner-radius' value='18' />
        <format attr='background-color' value='#18233A' />
        <format attr='margin' value='0' />
      </zone-style>
    </zone>
  </zones>
</dashboard>`;

const HIGH_CONTRAST_DASHBOARD_READBACK_XML = `<dashboard name='Rounded Corners VIP Final'>
  <zones>
    <zone id='9' type-v2='layout-basic'>
      <zone id='10' type-v2='text'>
        <formatted-text><run fontcolor='#18233a'>Native rounded dashboard zones</run></formatted-text>
        <zone-style>
          <format attr='border-color' value='#6c5ce7' />
          <format attr='border-style' value='solid' />
          <format attr='border-width' value='4' />
          <format attr='corner-radius' value='36' />
          <format attr='margin' value='20' />
          <format attr='background-color' value='#ffffff' />
        </zone-style>
      </zone>
      <zone id='11' name='Sales by Category'>
        <zone-style>
          <format attr='border-color' value='#6c5ce7' />
          <format attr='border-style' value='solid' />
          <format attr='border-width' value='4' />
          <format attr='corner-radius' value='36' />
          <format attr='margin' value='20' />
          <format attr='background-color' value='#ffffff' />
        </zone-style>
      </zone>
      <zone-style>
        <format attr='border-color' value='#444444' />
        <format attr='border-style' value='none' />
        <format attr='border-width' value='0' />
        <format attr='corner-radius' value='36' />
        <format attr='margin' value='0' />
        <format attr='background-color' value='#18233a' />
      </zone-style>
    </zone>
  </zones>
</dashboard>`;

describe('formatDashboardZonesDocument', () => {
  it('updates only containers, including nested container-owned bytes', () => {
    const result = formatDashboardZonesDocument(DASHBOARD_XML, {
      scope: 'containers',
      cornerRadius: 12,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.targetZoneIds).toEqual(['2', '4']);
    expect(result.xml).toContain(
      "<zone-style><format attr='corner-radius' value='12' /><format attr='padding' value='8' /></zone-style>",
    );
    expect(result.xml).toContain(
      "<zone id='4' type-v2='layout-basic'><zone-style ><format attr='corner-radius' value='12' /></zone-style></zone>",
    );
    expect(result.xml).toContain(
      "<zone id='3' name='Profit'>\n        <zone-style><format attr='border-color' value='#BBBBBB' /></zone-style>",
    );
    expect(result.xml).toContain(
      "<style><style-rule element='dashboard'><format attr='background-color' value='#FFFFFF' /></style-rule></style>",
    );
  });

  it('targets one nested zone by id without changing its parent', () => {
    const result = formatDashboardZonesDocument(DASHBOARD_XML, {
      scope: 'zone_ids',
      zoneIds: ['3'],
      cornerRadius: 9,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.targetZoneIds).toEqual(['3']);
    expect(result.xml).toContain("<format attr='corner-radius' value='4' />");
    expect(result.xml).toContain(
      "<zone-style><format attr='border-color' value='#BBBBBB' /><format attr='corner-radius' value='9' /></zone-style>",
    );
    expect(result.xml.replace("<format attr='corner-radius' value='9' />", '')).toBe(DASHBOARD_XML);
  });

  it('handles the live Products nested-zone shape without touching nested siblings', () => {
    const containers = formatDashboardZonesDocument(PRODUCTS_DASHBOARD_XML, {
      scope: 'containers',
      cornerRadius: 16,
    });
    expect(containers.ok).toBe(true);
    if (!containers.ok) return;
    expect(containers.targetZoneIds).toEqual(['9']);
    expect(containers.xml).toContain(
      "<zone id='10' type-v2='text'><zone-style><format attr='font-size' value='18' /></zone-style></zone>",
    );
    expect(containers.xml).toContain(
      "<zone id='12' name='Product Profit'><zone-style><format attr='border-style' value='none' /></zone-style></zone>",
    );

    const all = formatDashboardZonesDocument(PRODUCTS_DASHBOARD_XML, {
      scope: 'all',
      cornerRadius: 16,
    });
    expect(all.ok).toBe(true);
    if (!all.ok) return;
    expect(all.targetZoneIds).toEqual(['9', '10', '13', '11', '12']);
    expect(all.xml.match(/attr='corner-radius' value='16'/g)).toHaveLength(5);
  });

  it('includes a nested layout-flow zone in container scope', () => {
    const source = `<dashboard name='D'>
  <zones>
    <zone id='20' type-v2='layout-basic'>
      <zone id='21' type-v2='layout-flow'>
        <zone id='22' name='Sales'><zone-style><format attr='margin' value='4' /></zone-style></zone>
        <zone-style><format attr='padding' value='6' /></zone-style>
      </zone>
      <zone-style><format attr='padding' value='8' /></zone-style>
    </zone>
  </zones>
</dashboard>`;
    const result = formatDashboardZonesDocument(source, {
      scope: 'containers',
      cornerRadius: 10,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.targetZoneIds).toEqual(['20', '21']);
    expect(result.xml).toContain(
      "<zone id='21' type-v2='layout-flow'>\n        <zone id='22' name='Sales'><zone-style><format attr='margin' value='4' /></zone-style></zone>\n        <zone-style><format attr='padding' value='6' /><format attr='corner-radius' value='10' /></zone-style>",
    );
    expect(result.xml).toContain(
      "<zone-style><format attr='padding' value='8' /><format attr='corner-radius' value='10' /></zone-style>",
    );
  });

  it('inserts a missing direct zone-style last, after nested zone content', () => {
    const source =
      "<dashboard name='D'><zones><zone id='7' name='Sales'><zone id='8' /></zone></zones></dashboard>";
    const result = formatDashboardZonesDocument(source, {
      scope: 'zone_ids',
      zoneIds: ['7'],
      cornerRadius: 6,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.xml).toBe(
      "<dashboard name='D'><zones><zone id='7' name='Sales'><zone id='8' /><zone-style><format attr='corner-radius' value='6' /></zone-style></zone></zones></dashboard>",
    );
  });

  it('updates only the corner-radius value bytes on an existing format tag', () => {
    const source =
      '<dashboard name="D"><zones><zone id="7" type-v2="worksheet"><zone-style><format vendor-keep="yes" value = "4" attr="corner-radius" future-byte="untouched" /></zone-style></zone></zones></dashboard>';
    const result = formatDashboardZonesDocument(source, {
      scope: 'zone_ids',
      zoneIds: ['7'],
      cornerRadius: 23,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.xml).toBe(
      '<dashboard name="D"><zones><zone id="7" type-v2="worksheet"><zone-style><format vendor-keep="yes" value = "23" attr="corner-radius" future-byte="untouched" /></zone-style></zone></zones></dashboard>',
    );
  });

  it('expands a self-closing zone-style without dropping opening-tag attributes', () => {
    const source =
      "<dashboard name='D'><zones><zone id='7'><zone-style vendor-keep='yes' future-byte=\"untouched\" /></zone></zones></dashboard>";
    const result = formatDashboardZonesDocument(source, {
      scope: 'zone_ids',
      zoneIds: ['7'],
      cornerRadius: 11,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.xml).toBe(
      "<dashboard name='D'><zones><zone id='7'><zone-style vendor-keep='yes' future-byte=\"untouched\" ><format attr='corner-radius' value='11' /></zone-style></zone></zones></dashboard>",
    );
  });

  it('is byte-identical when every target already has the requested radius', () => {
    const first = formatDashboardZonesDocument(DASHBOARD_XML, {
      scope: 'containers',
      cornerRadius: 12,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = formatDashboardZonesDocument(first.xml, {
      scope: 'containers',
      cornerRadius: 12,
    });

    expect(second).toEqual(first);
  });

  it.each([
    [
      'a missing requested id',
      DASHBOARD_XML,
      { scope: 'zone_ids' as const, zoneIds: ['999'], cornerRadius: 8 },
      '999',
    ],
    [
      'duplicate ids in the document',
      DASHBOARD_XML.replace("id='4'", "id='3'"),
      { scope: 'all' as const, cornerRadius: 8 },
      'duplicate zone id',
    ],
    [
      'a zone without an id',
      DASHBOARD_XML.replace(" id='4'", ''),
      { scope: 'all' as const, cornerRadius: 8 },
      'every zone needs an id',
    ],
    [
      'a target with two direct styles',
      DASHBOARD_XML.replace(
        "<zone id='1' name='Sales'>",
        "<zone id='1' name='Sales'><zone-style />",
      ),
      { scope: 'zone_ids' as const, zoneIds: ['1'], cornerRadius: 8 },
      'more than one direct zone-style',
    ],
    [
      'malformed nested zones',
      "<dashboard name='D'><zones><zone id='1'><zone id='2'></zone></zones></dashboard>",
      { scope: 'all' as const, cornerRadius: 8 },
      'Malformed dashboard',
    ],
    [
      'an out-of-range radius',
      DASHBOARD_XML,
      { scope: 'all' as const, cornerRadius: 101 },
      'integer from 0 to 100',
    ],
  ])('fails closed for %s', (_name, source, request, message) => {
    const result = formatDashboardZonesDocument(source, request);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain(message);
  });
});

describe('Desktop-owned dashboard state (captured from live Desktop)', () => {
  afterEach(() => vi.useRealTimers());
  const fixture = (name: string): string =>
    readFileSync(join(__dirname, '__fixtures__', name), 'utf8');
  const BLANK_WITH_PHONE = fixture('native-blank-with-phone.xml');
  const SHEETS_WITH_PHONE = fixture('native-sheets-with-phone.xml');
  const BLANK_ZONE = fixture('native-blank-zone-with-phone.xml');
  const PROBE_BEFORE = fixture('probe-rows-before-all.xml');
  const PROBE_READBACK = fixture('probe-rows-readback-after-all12.xml');
  const NORMALIZED_RADIUS = (radius: number): string =>
    `<zone-style><format attr='border-color' value='#444444' /><format attr='border-style' value='none' /><format attr='border-width' value='0' /><format attr='corner-radius' value='${radius}' /></zone-style>`;
  const run = async (
    args: Parameters<typeof callTool>[0],
    options: Parameters<typeof callTool>[1],
  ): ReturnType<typeof callTool> => {
    vi.useFakeTimers();
    const pending = callTool(args, options);
    await vi.advanceTimersByTimeAsync(READBACK_POLL_INTERVAL_MS * READBACK_POLL_MAX_ATTEMPTS);
    return await pending;
  };

  it('targets default-layout containers only, never the auto-generated Phone layout', () => {
    const result = formatDashboardZonesDocument(SHEETS_WITH_PHONE, {
      scope: 'containers',
      cornerRadius: 10,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.targetZoneIds).toEqual(['4', '7']);
    expect(result.xml.slice(result.xml.indexOf('<devicelayouts>'))).toBe(
      SHEETS_WITH_PHONE.slice(SHEETS_WITH_PHONE.indexOf('<devicelayouts>')),
    );
  });

  it('finds no targets on a blank dashboard whose only zones are in the Phone layout', () => {
    const result = formatDashboardZonesDocument(BLANK_WITH_PHONE, {
      scope: 'containers',
      cornerRadius: 10,
    });

    expect(result).toEqual({
      ok: false,
      message: 'No dashboard zones matched scope "containers".',
    });
  });

  it('does not treat a Phone zone that shares a default-layout id as a duplicate or a target', () => {
    const source = SHEETS_WITH_PHONE.replace("id='4'", "id='2'");
    const result = formatDashboardZonesDocument(source, {
      scope: 'zone_ids',
      zoneIds: ['2'],
      cornerRadius: 10,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.targetZoneIds).toEqual(['2']);
    expect(result.xml.slice(result.xml.indexOf('<devicelayouts>'))).toBe(
      source.slice(source.indexOf('<devicelayouts>')),
    );
  });

  it('still rejects duplicate ids within the default layout', () => {
    const result = formatDashboardZonesDocument(SHEETS_WITH_PHONE.replace("id='5'", "id='3'"), {
      scope: 'all',
      cornerRadius: 10,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('duplicate zone id "3"');
  });

  it('expands a self-closing blank zone into a well-formed zone with one zone-style', () => {
    const result = formatDashboardZonesDocument(BLANK_ZONE, {
      scope: 'zone_ids',
      zoneIds: ['20'],
      cornerRadius: 10,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    let malformed = false;
    const doc = new DOMParser({ onError: () => (malformed = true) }).parseFromString(
      result.xml,
      'text/xml',
    );
    expect(malformed).toBe(false);
    const zone = Array.from(doc.getElementsByTagName('zone')).find(
      (candidate) => candidate.getAttribute('id') === '20',
    )!;
    const styles = Array.from(zone.getElementsByTagName('zone-style'));
    expect(styles).toHaveLength(1);
    const formats = Array.from(styles[0].getElementsByTagName('format'));
    expect(
      formats.map((format) => [format.getAttribute('attr'), format.getAttribute('value')]),
    ).toEqual([['corner-radius', '10']]);
  });

  it('verifies a blank-zone format when Desktop adds border formats to the new style', async () => {
    const formatted = formatDashboardZonesDocument(BLANK_ZONE, {
      scope: 'zone_ids',
      zoneIds: ['20'],
      cornerRadius: 12,
    });
    expect(formatted.ok).toBe(true);
    if (!formatted.ok) return;
    const readbackXml = formatted.xml.replace(
      "<zone-style><format attr='corner-radius' value='12' /></zone-style></zone>",
      `${NORMALIZED_RADIUS(12)}</zone>`,
    );
    expect(readbackXml).not.toBe(formatted.xml);

    const { result, applyDashboardDocument } = await run(
      { dashboardName: 'dashboard-1', cornerRadius: 12, scope: 'zone_ids', zoneIds: ['20'] },
      { source: BLANK_ZONE, readbackXml },
    );

    expect(result.isError).toBe(false);
    expect(applyDashboardDocument).toHaveBeenCalledTimes(1);
  });

  it('verifies scope all on Probe Rows when Desktop writes corner-radius before margin', async () => {
    const { result } = await run(
      { dashboardName: 'dashboard-1', cornerRadius: 12, scope: 'all' },
      { source: PROBE_BEFORE, readbackXml: PROBE_READBACK },
    );

    expect(result.isError).toBe(false);
  });

  it('verifies a container format on a dashboard with a Phone layout and Desktop-moved geometry', async () => {
    const formatted = formatDashboardZonesDocument(SHEETS_WITH_PHONE, {
      scope: 'containers',
      cornerRadius: 10,
    });
    expect(formatted.ok).toBe(true);
    if (!formatted.ok) return;
    const readbackXml = formatted.xml
      .replaceAll(
        "<zone-style><format attr='corner-radius' value='10' /></zone-style>",
        NORMALIZED_RADIUS(10),
      )
      .replace("h='19750' id='3'", "h='19000' id='3'")
      .replace("fixed-size-h='158'", "fixed-size-h='160'")
      .replace("value='8'", "value='6'");

    const { result } = await run(
      { dashboardName: 'dashboard-1', cornerRadius: 10, scope: 'containers' },
      { source: SHEETS_WITH_PHONE, readbackXml },
    );

    expect(result.isError).toBe(false);
  });

  it('fails when the readback drops a target margin', async () => {
    const { result } = await run(
      { dashboardName: 'dashboard-1', cornerRadius: 12, scope: 'all' },
      {
        source: PROBE_BEFORE,
        readbackXml: PROBE_READBACK.replace("<format attr='margin' value='4' />", ''),
      },
    );

    expect(result.isError).toBe(true);
  });

  it('fails when the readback changes a non-target zone style', async () => {
    const targetOnly = {
      dashboardName: 'dashboard-1',
      cornerRadius: 12,
      scope: 'zone_ids' as const,
      zoneIds: ['13'],
    };
    const readback = PROBE_BEFORE.replace("value='8'", "value='12'");
    expect(readback).not.toBe(PROBE_BEFORE);

    const control = await run(targetOnly, { source: PROBE_BEFORE, readbackXml: readback });
    const changed = await run(targetOnly, {
      source: PROBE_BEFORE,
      readbackXml: readback.replace(
        "<format attr='margin' value='4' />",
        "<format attr='margin' value='5' />",
      ),
    });

    expect(control.result.isError).toBe(false);
    expect(changed.result.isError).toBe(true);
  });

  describe('device layout blocks added or dropped by Desktop', () => {
    const PHONE_BLOCK = /<devicelayouts>[\s\S]*<\/devicelayouts>\s*/.exec(SHEETS_WITH_PHONE)![0];
    const WITHOUT_BLOCK = SHEETS_WITH_PHONE.replace(PHONE_BLOCK, '');
    const request = {
      dashboardName: 'dashboard-1',
      cornerRadius: 10,
      scope: 'containers' as const,
    };
    const normalized = (source: string): string => {
      const formatted = formatDashboardZonesDocument(source, {
        scope: 'containers',
        cornerRadius: 10,
      });
      expect(formatted.ok).toBe(true);
      return formatted.ok
        ? formatted.xml.replaceAll(
            "<zone-style><format attr='corner-radius' value='10' /></zone-style>",
            NORMALIZED_RADIUS(10),
          )
        : '';
    };

    it('verifies when the readback gains a block of only auto-generated layouts', async () => {
      const readbackXml = normalized(WITHOUT_BLOCK).replace(
        '<simple-id',
        `${PHONE_BLOCK}<simple-id`,
      );
      expect(readbackXml).toContain('<devicelayouts>');
      const { result } = await run(request, { source: WITHOUT_BLOCK, readbackXml });
      expect(result.isError).toBe(false);
    });

    it('verifies when the readback loses a block of only auto-generated layouts', async () => {
      const { result } = await run(request, {
        source: SHEETS_WITH_PHONE,
        readbackXml: normalized(WITHOUT_BLOCK),
      });
      expect(result.isError).toBe(false);
    });

    it('fails when the readback gains a block with a non-auto-generated layout', async () => {
      const custom = PHONE_BLOCK.replace(" auto-generated='true'", '');
      expect(custom).not.toBe(PHONE_BLOCK);
      const readbackXml = normalized(WITHOUT_BLOCK).replace('<simple-id', `${custom}<simple-id`);
      const { result } = await run(request, { source: WITHOUT_BLOCK, readbackXml });
      expect(result.isError).toBe(true);
    });
  });

  it('fails when a non-target zone-style has its formats swapped', async () => {
    const targetOnly = {
      dashboardName: 'dashboard-1',
      cornerRadius: 12,
      scope: 'zone_ids' as const,
      zoneIds: ['13'],
    };
    const readback = PROBE_BEFORE.replace("value='8'", "value='12'");
    const swapped = readback.replace(
      "<format attr='border-color' value='#000000' />\n            <format attr='border-style' value='none' />",
      "<format attr='border-style' value='none' />\n            <format attr='border-color' value='#000000' />",
    );
    expect(swapped).not.toBe(readback);

    const { result } = await run(targetOnly, { source: PROBE_BEFORE, readbackXml: swapped });

    expect(result.isError).toBe(true);
  });

  describe('custom device layouts', () => {
    const CUSTOM =
      "<dashboard name='D'><zones><zone id='2' type-v2='layout-basic'><zone id='3' name='Sales' /></zone></zones><devicelayouts><devicelayout name='Tablet'><size minheight='700' /><zones><zone id='2' type-v2='layout-basic'><zone-style><format attr='margin' value='8' /><format attr='padding' value='1' /></zone-style></zone></zones></devicelayout></devicelayouts></dashboard>";
    const request = {
      dashboardName: 'dashboard-1',
      cornerRadius: 10,
      scope: 'zone_ids' as const,
      zoneIds: ['2'],
    };
    const formattedReadback = (): string => {
      const formatted = formatDashboardZonesDocument(CUSTOM, {
        scope: 'zone_ids',
        zoneIds: ['2'],
        cornerRadius: 10,
      });
      expect(formatted.ok).toBe(true);
      return formatted.ok
        ? formatted.xml.replace(
            "<zone-style><format attr='corner-radius' value='10' /></zone-style>",
            NORMALIZED_RADIUS(10),
          )
        : '';
    };

    it('verifies an unchanged custom layout', async () => {
      const { result } = await run(request, { source: CUSTOM, readbackXml: formattedReadback() });
      expect(result.isError).toBe(false);
    });

    it('finds the target in the default layout even when a device layout comes first', async () => {
      const move = (xml: string): string => {
        const layouts = /<devicelayouts>.*<\/devicelayouts>/.exec(xml)![0];
        return xml.replace(layouts, '').replace('<zones>', `${layouts}<zones>`);
      };
      const { result } = await run(request, {
        source: move(CUSTOM),
        readbackXml: move(formattedReadback()),
      });
      expect(result.isError).toBe(false);
    });

    it('fails when the readback drops the custom layout', async () => {
      const readback = formattedReadback().replace(/<devicelayouts>.*<\/devicelayouts>/, '');
      const { result } = await run(request, { source: CUSTOM, readbackXml: readback });
      expect(result.isError).toBe(true);
    });

    it('fails when a custom layout zone sharing a target id changes', async () => {
      const readback = formattedReadback().replace("value='8'", "value='9'");
      const { result } = await run(request, { source: CUSTOM, readbackXml: readback });
      expect(result.isError).toBe(true);
    });

    describe('with geometry and layout-cache', () => {
      const GEO =
        "<dashboard name='D'><zones><zone id='2' type-v2='layout-basic' x='0' y='0' w='100000' h='100000'><zone id='3' name='Sales' x='0' y='0' w='50000' h='100000' /><layout-cache cache='a' /></zone></zones><devicelayouts><devicelayout name='Tablet'><size minheight='700' /><zones><zone id='2' type-v2='layout-basic' x='0' y='0' w='100000' h='100000'><zone id='20' name='Sales' x='1000' y='2000' w='100000' h='100000' /><layout-cache cache='b' /></zone></zones></devicelayout></devicelayouts></dashboard>";
      const geoReadback = (): string => {
        const formatted = formatDashboardZonesDocument(GEO, {
          scope: 'zone_ids',
          zoneIds: ['2'],
          cornerRadius: 10,
        });
        expect(formatted.ok).toBe(true);
        return formatted.ok
          ? formatted.xml.replace(
              "<zone-style><format attr='corner-radius' value='10' /></zone-style>",
              NORMALIZED_RADIUS(10),
            )
          : '';
      };
      const change = (xml: string, from: string, to: string): string => {
        expect(xml).toContain(from);
        return xml.replace(from, to);
      };

      it('verifies an unchanged readback', async () => {
        const { result } = await run(request, { source: GEO, readbackXml: geoReadback() });
        expect(result.isError).toBe(false);
      });

      it('fails when only a custom layout zone width changes', async () => {
        const readback = change(
          geoReadback(),
          "id='20' name='Sales' x='1000' y='2000' w='100000'",
          "id='20' name='Sales' x='1000' y='2000' w='0'",
        );
        const { result } = await run(request, { source: GEO, readbackXml: readback });
        expect(result.isError).toBe(true);
      });

      it('fails when a custom layout zone x changes', async () => {
        const readback = change(geoReadback(), "x='1000'", "x='1500'");
        const { result } = await run(request, { source: GEO, readbackXml: readback });
        expect(result.isError).toBe(true);
      });

      it('fails when a custom layout zone y changes', async () => {
        const readback = change(geoReadback(), "y='2000'", "y='2500'");
        const { result } = await run(request, { source: GEO, readbackXml: readback });
        expect(result.isError).toBe(true);
      });

      it('fails when a custom layout layout-cache changes', async () => {
        const readback = change(geoReadback(), "cache='b'", "cache='c'");
        const { result } = await run(request, { source: GEO, readbackXml: readback });
        expect(result.isError).toBe(true);
      });

      it('still ignores default layout geometry and layout-cache changes', async () => {
        let readback = change(
          geoReadback(),
          "id='3' name='Sales' x='0' y='0' w='50000' h='100000'",
          "id='3' name='Sales' x='10' y='20' w='30' h='40'",
        );
        readback = change(readback, "cache='a'", "cache='z'");
        const { result } = await run(request, { source: GEO, readbackXml: readback });
        expect(result.isError).toBe(false);
      });
    });
  });
});

describe('format-dashboard-zones tool', () => {
  afterEach(() => vi.useRealTimers());

  it('exposes only a bounded typed schema', () => {
    const tool = getFormatDashboardZonesTool(new DesktopMcpServer());
    expect(tool.name).toBe('format-dashboard-zones');
    expect(Object.keys(tool.paramsSchema)).toEqual([
      'session',
      'dashboardName',
      'cornerRadius',
      'scope',
      'zoneIds',
    ]);
    expect(JSON.stringify(tool.paramsSchema)).not.toMatch(/xml|file/i);
  });

  it('resolves a dashboard id, applies once, and verifies exact target ids', async () => {
    const { result, applyDashboardDocument } = await callTool({
      dashboardName: 'dashboard-1',
      cornerRadius: 14,
      scope: 'containers',
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toEqual({
      dashboard: 'Executive Overview',
      cornerRadius: 14,
      zoneIds: ['2', '4'],
      verified: true,
    });
    expect(applyDashboardDocument).toHaveBeenCalledTimes(1);
  });

  it('accepts supported Desktop versions for native dashboard corner radius', async () => {
    const { result, applyDashboardDocument } = await callTool(
      {
        dashboardName: 'Executive Overview',
        cornerRadius: 14,
        scope: 'containers',
      },
      { applicationVersion: '2026.1' },
    );

    expect(result.isError).toBe(false);
    expect(applyDashboardDocument).toHaveBeenCalledTimes(1);
  });

  it('rejects released Desktop versions before native dashboard corner radius', async () => {
    const { result, applyDashboardDocument } = await callTool(
      {
        dashboardName: 'Executive Overview',
        cornerRadius: 14,
        scope: 'containers',
      },
      { applicationVersion: '2025.3' },
    );

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('requires Tableau Desktop 2026.1 or newer');
    expect(applyDashboardDocument).not.toHaveBeenCalled();
  });

  it('rechecks the Desktop version under the apply lock before mutation', async () => {
    const { result, applyDashboardDocument } = await callTool(
      {
        dashboardName: 'Executive Overview',
        cornerRadius: 14,
        scope: 'containers',
      },
      { applicationVersion: undefined, latestApplicationVersion: '2025.3.1' },
    );

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('requires Tableau Desktop 2026.1 or newer');
    expect(result.content[0].text).toContain('2025.3.1');
    expect(applyDashboardDocument).not.toHaveBeenCalled();
  });

  it.each([undefined, '', '0.0.0 (0000.26.0818.0746)', 'main', 'development-build'])(
    'allows missing or non-release Desktop version %s for compatibility',
    async (applicationVersion) => {
      const { result, applyDashboardDocument } = await callTool(
        {
          dashboardName: 'Executive Overview',
          cornerRadius: 14,
          scope: 'containers',
        },
        { applicationVersion },
      );

      expect(result.isError).toBe(false);
      expect(applyDashboardDocument).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects duplicate zone ids and invalid scope combinations before any read', async () => {
    const duplicate = await callTool({
      dashboardName: 'Executive Overview',
      cornerRadius: 14,
      scope: 'zone_ids',
      zoneIds: ['2', '2'],
    });
    const ignored = await callTool({
      dashboardName: 'Executive Overview',
      cornerRadius: 14,
      scope: 'all',
      zoneIds: ['2'],
    });

    expect(duplicate.result.isError).toBe(true);
    expect(ignored.result.isError).toBe(true);
    expect(duplicate.getDashboardDocument).not.toHaveBeenCalled();
    expect(ignored.getDashboardDocument).not.toHaveBeenCalled();
  });

  it('skips apply when the target radius already matches', async () => {
    const { result, applyDashboardDocument } = await callTool(
      {
        dashboardName: 'Executive Overview',
        cornerRadius: 4,
        scope: 'zone_ids',
        zoneIds: ['2'],
      },
      { source: DASHBOARD_XML },
    );

    expect(result.isError).toBe(false);
    expect(applyDashboardDocument).not.toHaveBeenCalled();
  });

  it('does not apply stale bytes after the dashboard drifts', async () => {
    const { result, applyDashboardDocument } = await callTool(
      {
        dashboardName: 'Executive Overview',
        cornerRadius: 14,
        scope: 'containers',
      },
      { driftBeforeApply: true },
    );

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('changed while');
    expect(applyDashboardDocument).not.toHaveBeenCalled();
  });

  it('surfaces a readback error after one apply', async () => {
    const { result, applyDashboardDocument } = await callTool(
      {
        dashboardName: 'Executive Overview',
        cornerRadius: 14,
        scope: 'containers',
      },
      { readback: 'error' },
    );

    expect(result.isError).toBe(true);
    expect(applyDashboardDocument).toHaveBeenCalledTimes(1);
  });

  it('rejects document warnings returned by the apply', async () => {
    const { result, applyDashboardDocument } = await callTool(
      {
        dashboardName: 'Executive Overview',
        cornerRadius: 14,
        scope: 'containers',
      },
      { applyDocumentWarning: 'Dropped border formatting from zone 3.' },
    );

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Dropped border formatting from zone 3.');
    expect(applyDashboardDocument).toHaveBeenCalledTimes(1);
  });

  it('fails when readback never settles after one apply', async () => {
    vi.useFakeTimers();
    const resultPromise = callTool(
      {
        dashboardName: 'Executive Overview',
        cornerRadius: 14,
        scope: 'containers',
      },
      { readback: 'unsettled' },
    );
    await vi.advanceTimersByTimeAsync(READBACK_POLL_INTERVAL_MS * READBACK_POLL_MAX_ATTEMPTS);
    const { result, applyDashboardDocument } = await resultPromise;

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('did not survive readback');
    expect(applyDashboardDocument).toHaveBeenCalledTimes(1);
  });

  it('rejects readback that keeps target radii but drops a nested sibling zone', async () => {
    vi.useFakeTimers();
    const resultPromise = callTool(
      {
        dashboardName: 'Executive Overview',
        cornerRadius: 14,
        scope: 'containers',
      },
      { dropNestedZoneOnReadback: true },
    );
    await vi.advanceTimersByTimeAsync(READBACK_POLL_INTERVAL_MS * READBACK_POLL_MAX_ATTEMPTS);
    const { result, applyDashboardDocument } = await resultPromise;

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('dashboard structure');
    expect(applyDashboardDocument).toHaveBeenCalledTimes(1);
  });

  it('rejects readback that keeps target radii and geometry but drops a sibling style', async () => {
    vi.useFakeTimers();
    const resultPromise = callTool(
      {
        dashboardName: 'Executive Overview',
        cornerRadius: 14,
        scope: 'containers',
      },
      { dropSiblingStyleOnReadback: true },
    );
    await vi.advanceTimersByTimeAsync(READBACK_POLL_INTERVAL_MS * READBACK_POLL_MAX_ATTEMPTS);
    const { result, applyDashboardDocument } = await resultPromise;

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('dashboard structure or content');
    expect(applyDashboardDocument).toHaveBeenCalledTimes(1);
  });

  it('accepts semantically identical readback with benign XML reserialization', async () => {
    const { result, applyDashboardDocument } = await callTool(
      {
        dashboardName: 'Executive Overview',
        cornerRadius: 14,
        scope: 'containers',
      },
      { benignReserializationOnReadback: true },
    );

    expect(result.isError).toBe(false);
    expect(applyDashboardDocument).toHaveBeenCalledTimes(1);
  });

  it('holds the shared apply lock until dashboard readback settles', async () => {
    let document = DASHBOARD_XML;
    let readCount = 0;
    let applyCount = 0;
    let releaseFirstReadback!: () => void;
    const firstReadbackGate = new Promise<void>((resolve) => {
      releaseFirstReadback = resolve;
    });
    let reportFirstReadback!: () => void;
    const firstReadbackStarted = new Promise<void>((resolve) => {
      reportFirstReadback = resolve;
    });
    let reportSecondInitialRead!: () => void;
    const secondInitialReadStarted = new Promise<void>((resolve) => {
      reportSecondInitialRead = resolve;
    });
    const getDashboardDocument = vi.fn(async () => {
      readCount += 1;
      if (readCount === 3) {
        reportFirstReadback();
        await firstReadbackGate;
      }
      if (readCount === 4) reportSecondInitialRead();
      return new Ok({ xml: document });
    });
    const applyDashboardDocument = vi.fn(async (_id: string, xml: string) => {
      applyCount += 1;
      document = xml;
      return new Ok({
        command_id: `apply-${applyCount}`,
        status: 'completed',
        result: null,
        warnings: [],
      });
    });
    const executorFunctions = { getDashboardDocument, applyDashboardDocument };

    const first = callTool(
      { dashboardName: 'Executive Overview', cornerRadius: 14, scope: 'containers' },
      { executorFunctions },
    );
    await firstReadbackStarted;
    const second = callTool(
      { dashboardName: 'Executive Overview', cornerRadius: 15, scope: 'containers' },
      { executorFunctions },
    );
    await secondInitialReadStarted;
    await Promise.resolve();
    await Promise.resolve();
    const readsBeforeRelease = getDashboardDocument.mock.calls.length;
    const appliesBeforeRelease = applyDashboardDocument.mock.calls.length;

    releaseFirstReadback();
    const [{ result: firstResult }, { result: secondResult }] = await Promise.all([first, second]);

    expect(readsBeforeRelease).toBe(4);
    expect(appliesBeforeRelease).toBe(1);
    expect(firstResult.isError).toBe(false);
    expect(secondResult.isError).toBe(false);
    expect(getDashboardDocument).toHaveBeenCalledTimes(6);
    expect(applyDashboardDocument).toHaveBeenCalledTimes(2);
  });

  it('accepts the live Desktop normalization of a newly inserted container style', async () => {
    vi.useFakeTimers();
    const resultPromise = callTool(
      {
        dashboardName: 'dashboard-1',
        cornerRadius: 18,
        scope: 'containers',
      },
      {
        source: LIVE_COMPOSED_DASHBOARD_XML,
        readbackXml: LIVE_ROUNDED_DASHBOARD_READBACK_XML,
      },
    );
    await vi.advanceTimersByTimeAsync(READBACK_POLL_INTERVAL_MS * READBACK_POLL_MAX_ATTEMPTS);
    const { result, applyDashboardDocument } = await resultPromise;

    expect(result.isError).toBe(false);
    expect(applyDashboardDocument).toHaveBeenCalledTimes(1);
  });

  it('accepts the live high-contrast scope-all format reordering and hex color casing', async () => {
    const { result, applyDashboardDocument } = await callTool(
      {
        dashboardName: 'dashboard-1',
        cornerRadius: 36,
        scope: 'all',
      },
      {
        source: HIGH_CONTRAST_DASHBOARD_XML,
        readbackXml: HIGH_CONTRAST_DASHBOARD_READBACK_XML,
      },
    );

    expect(result.isError).toBe(false);
    expect(applyDashboardDocument).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'format loss',
      HIGH_CONTRAST_DASHBOARD_READBACK_XML.replace(
        "          <format attr='background-color' value='#ffffff' />\n",
        '',
      ),
    ],
    [
      'format value drift',
      HIGH_CONTRAST_DASHBOARD_READBACK_XML.replace(
        "<format attr='border-width' value='4' />",
        "<format attr='border-width' value='5' />",
      ),
    ],
    ['hex color value drift', HIGH_CONTRAST_DASHBOARD_READBACK_XML.replace('#6c5ce7', '#6c5ce8')],
    [
      'content loss',
      HIGH_CONTRAST_DASHBOARD_READBACK_XML.replace('Native rounded dashboard zones', ''),
    ],
    [
      'duplicate normalized format',
      HIGH_CONTRAST_DASHBOARD_READBACK_XML.replace(
        "          <format attr='margin' value='20' />",
        "          <format attr='margin' value='20' />\n          <format attr='margin' value='20' />",
      ),
    ],
    [
      'extra format attribute',
      HIGH_CONTRAST_DASHBOARD_READBACK_XML.replace(
        "<format attr='margin' value='20' />",
        "<format attr='margin' value='20' vendor='unexpected' />",
      ),
    ],
    [
      'zone-style text',
      HIGH_CONTRAST_DASHBOARD_READBACK_XML.replace(
        "        <zone-style>\n          <format attr='border-color'",
        "        <zone-style>unexpected\n          <format attr='border-color'",
      ),
    ],
    [
      'extra zone-style child',
      HIGH_CONTRAST_DASHBOARD_READBACK_XML.replace(
        "          <format attr='background-color' value='#ffffff' />\n        </zone-style>",
        "          <format attr='background-color' value='#ffffff' />\n          <unexpected />\n        </zone-style>",
      ),
    ],
  ])('rejects %s during high-contrast Desktop normalization', async (_case, readbackXml) => {
    vi.useFakeTimers();
    const resultPromise = callTool(
      {
        dashboardName: 'dashboard-1',
        cornerRadius: 36,
        scope: 'all',
      },
      { source: HIGH_CONTRAST_DASHBOARD_XML, readbackXml },
    );
    await vi.advanceTimersByTimeAsync(READBACK_POLL_INTERVAL_MS * READBACK_POLL_MAX_ATTEMPTS);
    const { result, applyDashboardDocument } = await resultPromise;

    expect(result.isError).toBe(true);
    expect(applyDashboardDocument).toHaveBeenCalledTimes(1);
  });

  it('accepts any order of formats inside a target zone-style', async () => {
    const readbackXml = HIGH_CONTRAST_DASHBOARD_READBACK_XML.replace(
      "          <format attr='border-style' value='solid' />\n          <format attr='border-width' value='4' />",
      "          <format attr='border-width' value='4' />\n          <format attr='border-style' value='solid' />",
    );
    expect(readbackXml).not.toBe(HIGH_CONTRAST_DASHBOARD_READBACK_XML);
    const { result } = await callTool(
      { dashboardName: 'dashboard-1', cornerRadius: 36, scope: 'all' },
      { source: HIGH_CONTRAST_DASHBOARD_XML, readbackXml },
    );

    expect(result.isError).toBe(false);
  });

  it('rejects sibling content loss alongside the live container-style normalization', async () => {
    vi.useFakeTimers();
    const resultPromise = callTool(
      {
        dashboardName: 'dashboard-1',
        cornerRadius: 18,
        scope: 'containers',
      },
      {
        source: LIVE_COMPOSED_DASHBOARD_XML,
        readbackXml: LIVE_ROUNDED_DASHBOARD_READBACK_XML.replace(
          'Rounded Corners — Profit by Sub-Category</run>',
          '</run>',
        ),
      },
    );
    await vi.advanceTimersByTimeAsync(READBACK_POLL_INTERVAL_MS * READBACK_POLL_MAX_ATTEMPTS);
    const { result, applyDashboardDocument } = await resultPromise;

    expect(result.isError).toBe(true);
    expect(applyDashboardDocument).toHaveBeenCalledTimes(1);
  });
});

type ToolArgs = {
  dashboardName: string;
  cornerRadius: number;
  scope: 'all' | 'containers' | 'zone_ids';
  zoneIds?: string[];
};

async function callTool(
  args: ToolArgs,
  options: {
    source?: string;
    readbackXml?: string;
    driftBeforeApply?: boolean;
    readback?: 'error' | 'unsettled';
    applyDocumentWarning?: string;
    dropNestedZoneOnReadback?: boolean;
    dropSiblingStyleOnReadback?: boolean;
    benignReserializationOnReadback?: boolean;
    applicationVersion?: string;
    latestApplicationVersion?: string;
    executorFunctions?: {
      getDashboardDocument: ReturnType<typeof vi.fn>;
      applyDashboardDocument: ReturnType<typeof vi.fn>;
    };
  } = {},
): Promise<{
  result: CallToolResult;
  getDashboardDocument: ReturnType<typeof vi.fn>;
  applyDashboardDocument: ReturnType<typeof vi.fn>;
}> {
  let document = options.source ?? DASHBOARD_XML;
  let reads = 0;
  let applied = false;
  const getDashboardDocument =
    options.executorFunctions?.getDashboardDocument ??
    vi.fn(async () => {
      reads += 1;
      if (options.readback === 'error' && applied) {
        return new Err({ type: 'command-timed-out' as const, error: 'Readback timed out.' });
      }
      if (options.driftBeforeApply && reads === 2) {
        document = document.replace("value='#FFFFFF'", "value='#EEEEEE'");
      }
      return new Ok({
        xml: document,
        applicationVersion:
          reads >= 2
            ? (options.latestApplicationVersion ?? options.applicationVersion)
            : options.applicationVersion,
      });
    });
  const applyDashboardDocument =
    options.executorFunctions?.applyDashboardDocument ??
    vi.fn(async (_id: string, xml: string) => {
      applied = true;
      if (options.readback !== 'unsettled') {
        if (options.readbackXml !== undefined) {
          document = options.readbackXml;
        } else if (options.dropNestedZoneOnReadback) {
          document = xml.replace(
            "      <zone id='3' name='Profit'>\n        <zone-style><format attr='border-color' value='#BBBBBB' /></zone-style>\n      </zone>\n",
            '',
          );
        } else if (options.dropSiblingStyleOnReadback) {
          document = xml.replace(
            "        <zone-style><format attr='border-color' value='#BBBBBB' /></zone-style>\n",
            '',
          );
        } else if (options.benignReserializationOnReadback) {
          document = xml
            .replaceAll("'", '"')
            .replace(
              '<zone h="5000" id="2" type-v2="layout-basic" w="6000">',
              '<zone type-v2="layout-basic" w="6000" id="2" h="5000">',
            )
            .replace(/>\s+</g, '><');
        } else {
          document = xml;
        }
      }
      return new Ok({
        command_id: 'apply-1',
        status: 'completed',
        result: null,
        warnings:
          options.applyDocumentWarning === undefined
            ? []
            : [{ code: 'document-warning', message: options.applyDocumentWarning }],
      });
    });
  const executor = {
    instanceId: 'desktop-instance',
    listDashboards: vi.fn().mockResolvedValue(
      new Ok({
        dashboards: [{ id: 'dashboard-1', name: 'Executive Overview' }],
      }),
    ),
    getDashboardDocument,
    applyDashboardDocument,
  };
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue(executor),
  };
  const tool = getFormatDashboardZonesTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  const result = await callback({ session: '12345', ...args, zoneIds: args.zoneIds }, extra);
  return { result, getDashboardDocument, applyDashboardDocument };
}
