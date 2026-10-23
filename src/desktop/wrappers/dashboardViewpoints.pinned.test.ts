import { readFileSync } from 'fs';
import { join } from 'path';

import { createDashboardReadbackDiagnoser } from './dashboardViewpoints.js';

// Fragments and readbacks are copied byte for byte from the live Desktop probe. Desktop rewrites a
// pinned child's w to round((fixed-size + margins) * 100000 / dashboard px), so the stored w differs
// from the submitted one by more than the +-1 per-zone tolerance.
const fixture = (name: string): string =>
  readFileSync(join(__dirname, '__fixtures__', 'dashboard-fill', name), 'utf8');
const sheets = ['Total Revenue', 'Revenue by Product per Period'];
const wrap = (dashboard: string): string =>
  `<workbook><dashboards>${dashboard}</dashboards><windows><window class="dashboard" name="Dashboard 1"><viewpoints>${sheets.map((name) => `<viewpoint name='${name}' />`).join('')}</viewpoints></window></windows></workbook>`;
const diagnoseXml = (submitted: string, readback: string): string | undefined =>
  createDashboardReadbackDiagnoser(wrap(submitted), 'Dashboard 1')(wrap(readback));
const diagnose = (name: string): string | undefined =>
  diagnoseXml(fixture(`${name}.fragment.xml`), fixture(`${name}.readback.xml`));

describe('pinned flow children are judged by the flow check, not their stored w', () => {
  it.each(['wide30', 'thirds', 'stalew30'])('passes %s with the w Desktop rewrote', (name) => {
    expect(diagnose(name)).toBeUndefined();
  });

  it.each(['wideexact30', 'fixed30', 'example30'])('still passes %s', (name) => {
    expect(diagnose(name)).toBeUndefined();
  });

  it('fails when Desktop ignored fixed-size and split 50/50', () => {
    const readback = fixture('wide30.readback.xml')
      .replace("w='30015' x='0'", "w='50000' x='0'")
      .replace("w='69985' x='30015'", "w='50000' x='50000'");
    expect(readback).toContain("w='50000' x='50000'");
    const result = diagnoseXml(fixture('wide30.fragment.xml'), readback);
    expect(result).toContain('zone 3 ("horz")');
    expect(result).toContain('does not match the allocation');
  });

  it("still compares w per zone when is-fixed is 'false'", () => {
    const off = (xml: string): string => xml.replaceAll("is-fixed='true'", "is-fixed='false'");
    expect(
      diagnoseXml(off(fixture('wide30.fragment.xml')), off(fixture('wide30.readback.xml'))),
    ).toBe('zone 5 ("Total Revenue"): w is "30015" in Desktop, "30000" submitted');
  });

  it('still compares w per zone for a pinned child the user hid', () => {
    // Flow skips the hidden child, so the visible one pins to the full 1366px and only the hidden zone's w differs.
    const hide = (xml: string): string =>
      xml
        .replace("name='Total Revenue'", "hidden-by-user='true' name='Total Revenue'")
        .replace(/w='(?:70000|69985)' x='30(?:000|015)'/, "w='100000' x='0'")
        .replace("fixed-size='956'", "fixed-size='1366'");
    const result = diagnoseXml(
      hide(fixture('wide30.fragment.xml')),
      hide(fixture('wide30.readback.xml')),
    );
    expect(result).toBe('zone 5 ("Total Revenue"): w is "30015" in Desktop, "30000" submitted');
  });

  it('still compares w per zone when the flow check cannot model a sibling', () => {
    const noPin = (xml: string): string =>
      xml
        .replace(" fixed-size='956' is-fixed='true'", '')
        .replace("fixed-size='956' ", '')
        .replace(" is-fixed='true' name='Revenue by", " name='Revenue by");
    const result = diagnoseXml(
      noPin(fixture('wide30.fragment.xml')),
      noPin(fixture('wide30.readback.xml')),
    );
    expect(result).toBe('zone 5 ("Total Revenue"): w is "30015" in Desktop, "30000" submitted');
  });

  const pair = (
    kind: string,
    size: number,
    zones: [string, string, string, string, string][],
  ): string => {
    const flowAttrs =
      kind === 'basic' ? "type-v2='layout-basic'" : "param='horz' type-v2='layout-flow'";
    const children = zones
      .map(
        ([id, name, w, x, fixed]) =>
          `<zone h='100000' id='${id}' name='${name}' w='${w}' x='${x}' y='0' fixed-size='${fixed}' is-fixed='true' />`,
      )
      .join('');
    return `<dashboard name='Dashboard 1'><style /><size maxheight='${size}' maxwidth='${size}' minheight='${size}' minwidth='${size}' /><zones><zone h='100000' id='4' type-v2='layout-basic' w='100000' x='0' y='0'><zone h='100000' id='3' ${flowAttrs} w='100000' x='0' y='0'>${children}</zone></zone></zones></dashboard>`;
  };

  it('keeps comparing w per zone for pinned layout-basic children', () => {
    // Only the per-zone compare sees these: the basic container accepts the pins' normalized layout.
    const submitted = pair('basic', 1000, [
      ['5', 'Total Revenue', '30000', '0', '300'],
      ['6', 'Revenue by Product per Period', '60000', '30000', '600'],
    ]);
    const readback = pair('basic', 1000, [
      ['5', 'Total Revenue', '33333', '0', '300'],
      ['6', 'Revenue by Product per Period', '66667', '33333', '600'],
    ]);
    expect(diagnoseXml(submitted, readback)).toBe(
      'zone 5 ("Total Revenue"): w is "33333" in Desktop, "30000" submitted',
    );
  });

  it('rejects a pinned flow child whose w collapsed to zero after the flow check passes', () => {
    const dashboard = (a: string[], b: string[]): string =>
      pair('flow', 100, [
        ['5', 'Total Revenue', a[0]!, a[1]!, '1'],
        ['6', 'Revenue by Product per Period', b[0]!, b[1]!, '99'],
      ]).replace('<zones>', "<zones is-pixels='true'>");
    const result = diagnoseXml(
      dashboard(['1', '0'], ['99', '1']),
      dashboard(['0', '0'], ['99', '0']),
    );
    expect(result).toBe(
      'zone 5 ("Total Revenue"): w is "0" in Desktop, "1" submitted (Desktop-managed size collapsed to zero)',
    );
  });

  it('keeps a bare fixed-size on the per-zone compare', () => {
    const bare = (xml: string): string =>
      xml.replaceAll(" is-fixed='true'", '').replaceAll("is-fixed='true' ", '');
    const result = diagnoseXml(
      bare(fixture('wide30.fragment.xml')),
      bare(fixture('wide30.readback.xml')),
    );
    expect(result).toBe('zone 5 ("Total Revenue"): w is "30015" in Desktop, "30000" submitted');
  });

  it('still rejects a pinned flow child Desktop collapsed to zero', () => {
    const readback = fixture('wide30.readback.xml').replace("w='30015'", "w='0'");
    expect(diagnoseXml(fixture('wide30.fragment.xml'), readback)).toContain(
      'child widths are [0, 69985]',
    );
  });

  // With a layout-cache on each child the flow check can model the flow; only the pin test keeps w compared.
  it.each([
    ["is-fixed='1' fixed-size", " is-fixed='1'"],
    ['a bare fixed-size', ''],
  ])('keeps comparing w per zone for %s', (_label, pin) => {
    const modeled = (xml: string): string =>
      xml
        .replaceAll(" is-fixed='true'", pin)
        .replaceAll("is-fixed='true' ", pin ? "is-fixed='1' " : '')
        .replace(
          /(<zone [^>]*?fixed-size='(\d+)'[^>]*?) \/>/g,
          (_zone, open, size) =>
            `${open}><layout-cache fixed-size-w='${size}' type-h='fixed' type-w='fixed' /></zone>`,
        );
    const result = diagnoseXml(
      modeled(fixture('wide30.fragment.xml')),
      modeled(fixture('wide30.readback.xml')),
    );
    expect(result).toBe('zone 5 ("Total Revenue"): w is "30015" in Desktop, "30000" submitted');
  });
});
