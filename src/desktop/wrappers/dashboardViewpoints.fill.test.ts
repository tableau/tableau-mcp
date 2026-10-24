import { readFileSync } from 'fs';
import { join } from 'path';

import { createDashboardReadbackDiagnoser } from './dashboardViewpoints.js';

// Fragments and readbacks are copied byte for byte from the live Desktop probe (1000x800 fixed dashboard).
const fixture = (name: string): string =>
  readFileSync(join(__dirname, '__fixtures__', 'dashboard-fill', name), 'utf8');
const sheets = ['Total Revenue', 'Revenue by Product per Period'];
const wrap = (dashboard: string): string =>
  `<workbook><dashboards>${dashboard}</dashboards><windows><window class="dashboard" name="Dashboard 1"><viewpoints>${sheets.map((name) => `<viewpoint name='${name}' />`).join('')}</viewpoints></window></windows></workbook>`;
const diagnoseXml = (submitted: string, readback: string): string | undefined =>
  createDashboardReadbackDiagnoser(wrap(submitted), 'Dashboard 1')(wrap(readback));
const diagnose = (name: string): string | undefined =>
  diagnoseXml(fixture(`${name}.fragment.xml`), fixture(`${name}.readback.xml`));

const explain =
  "(px; each child's margins add to its fixed-size, and the total fills the 1000px container)";
const lead = 'Desktop sized unpinned zones to their content. FIX: pin every child of zone 3';
const pins = (a: number, b: number): string =>
  `${lead}: zone 5 is-fixed='true' fixed-size='${a}', zone 6 is-fixed='true' fixed-size='${b}' ${explain}`;
const fill = (widths: string, rest: string): string =>
  `zone 3 ("horz"): child widths are [${widths}] in Desktop and do not fill the 100000 units (1000px) available. ${rest}`;

describe('fill failure names the pins that fix it', () => {
  it('splits 30/70 for plain sheets', () => {
    expect(diagnose('plain30')).toBe(fill('13000, 26200', pins(300, 700)));
  });

  it('splits 50/50 for plain sheets', () => {
    expect(diagnose('plain50')).toBe(fill('13000, 26200', pins(500, 500)));
  });

  it('carries the fix on the allocation failure when scalable sizes were overridden', () => {
    expect(diagnose('scalable30')).toBe(
      `zone 3 ("horz"): child widths are [13000, 26200] in Desktop, which does not match the allocation of the submitted [30000, 70000] in 100000 units (1000px). ${pins(300, 700)}`,
    );
  });

  it('keeps the pinned child and gives the rest to the plain one', () => {
    expect(diagnose('onefixed')).toBe(fill('30000, 26200', pins(300, 700)));
  });

  it('passes once every child is pinned', () => {
    expect(diagnose('fixed30')).toBeUndefined();
  });

  it('passes a vertical flow that fills with Desktop split', () => {
    expect(diagnose('vplain25')).toBeUndefined();
  });

  // The readback adds border formats the check rejects separately, so submit the same four Desktop wrote.
  const desktopStyle = fixture('fixedmargin30.readback.xml').match(
    /<zone-style>[\s\S]*?<\/zone-style>/,
  )![0];

  it('passes pinned children whose fixed-size plus margins fills the container', () => {
    const submitted = fixture('fixedmargin30.fragment.xml').replaceAll(
      /<zone-style>[\s\S]*?<\/zone-style>/g,
      desktopStyle,
    );
    expect(submitted).toContain("value='#444444'");
    expect(diagnoseXml(submitted, fixture('fixedmargin30.readback.xml'))).toBeUndefined();
  });

  it('subtracts each child margins from its footprint', () => {
    // plain30's pair with Desktop's own four formats (margin 4) added to both zones.
    const submitted = fixture('plain30.fragment.xml').replaceAll(
      /(<zone h='100000' id='[56]'[^>]*?) \/>/g,
      `$1>${desktopStyle}</zone>`,
    );
    // Desktop adds each zone's margins to its content width: 130+8 and 262+8 px.
    const readback = fixture('plain30.readback.xml')
      .replaceAll('<layout-cache', `${desktopStyle}<layout-cache`)
      .replace("w='13000' x='0'", "w='13800' x='0'")
      .replace("w='26200' x='13000'", "w='27000' x='13800'");
    expect(diagnoseXml(submitted, readback)).toBe(fill('13800, 27000', pins(292, 692)));
  });

  it('gives no fix when the dashboard size is automatic, so no px can be computed', () => {
    const automatic = (xml: string): string =>
      xml.replace(/<size [^>]*\/>/, "<size sizing-mode='automatic' />");
    expect(
      diagnoseXml(
        automatic(fixture('plain30.fragment.xml')),
        automatic(fixture('plain30.readback.xml')),
      ),
    ).toBe(
      'zone 3 ("horz"): child widths are [13000, 26200] in Desktop, which does not match the allocation of the submitted [30000, 70000] in 100000 units',
    );
  });

  it('gives no fix when a child has no id', () => {
    const noId = (xml: string): string => xml.replace("id='6' ", '');
    const reason = diagnoseXml(
      noId(fixture('plain30.fragment.xml')),
      noId(fixture('plain30.readback.xml')),
    );
    expect(reason).toContain('child widths are [13000, 26200]');
    expect(reason).not.toContain('FIX');
  });

  // Derived from r88b-onefixed-1: the pinned zone 5 carries a fixed cache, the plain zone 6 a scalable one.
  it('gives no fix when only a pinned child has a fixed cache', () => {
    const readback = fixture('onefixed.readback.xml')
      .replace(
        /(<zone fixed-size='300'[^>]*?) \/>/,
        "$1><layout-cache fixed-size-w='300' type-h='fixed' type-w='fixed' /></zone>",
      )
      .replace(
        "fixed-size-w='262' type-h='fixed' type-w='fixed'",
        "minwidth='262' type-h='fixed' type-w='scalable'",
      );
    const reason = diagnoseXml(fixture('onefixed.fragment.xml'), readback);
    expect(reason).toContain('child widths are [30000, 26200]');
    expect(reason).not.toContain('FIX');
  });

  // Derived from r88v-vplain25-1: both sheets sized by content (type-h fixed), heights short of the 800px container.
  it('splits a vertical flow by height', () => {
    const readback = fixture('vplain25.readback.xml')
      .replace("h='76000' id='5'", "h='18750' id='5'")
      .replace("minheight='171' type-h='scalable'", "fixed-size-h='150' type-h='fixed'")
      .replace("w='100000' x='0' y='76000'", "w='100000' x='0' y='18750'");
    expect(diagnoseXml(fixture('vplain25.fragment.xml'), readback)).toBe(
      `zone 3 ("vert"): child heights are [18750, 24000] in Desktop and do not fill the 100000 units (800px) available. ${lead}: zone 5 is-fixed='true' fixed-size='200', zone 6 is-fixed='true' fixed-size='600' (px; each child's margins add to its fixed-size, and the total fills the 800px container)`,
    );
  });

  // Derived from r88b-onefixed-1: zone 5 submitted at w=50000 while its fixed-size stays 300.
  it('keeps a pinned child at its fixed-size even when its submitted share differs', () => {
    const submitted = fixture('onefixed.fragment.xml')
      .replace("w='30000' x='0'", "w='50000' x='0'")
      .replace("w='70000' x='30000'", "w='50000' x='50000'");
    expect(diagnoseXml(submitted, fixture('onefixed.readback.xml'))).toBe(
      fill('30000, 26200', pins(300, 700)),
    );
  });

  // Derived from r88b-onefixed-1 with Desktop's margin-4 formats on the pinned zone 5 (308px footprint).
  it('counts the margins of a pinned child', () => {
    const style = (xml: string): string =>
      xml.replace(/(<zone [^>]*id='5'[^>]*?) \/>/, `$1>${desktopStyle}</zone>`);
    const readback = style(fixture('onefixed.readback.xml'))
      .replace("w='30000' x='0'", "w='30800' x='0'")
      .replace("w='26200' x='30000'", "w='26200' x='30800'");
    expect(diagnoseXml(style(fixture('onefixed.fragment.xml')), readback)).toBe(
      fill('30800, 26200', pins(300, 692)),
    );
  });

  // Derived from r88-plain30-1 with Desktop's margin-4 formats on the flow, leaving a 992px container.
  it('counts the margins of the flow itself', () => {
    const margin = (xml: string): string =>
      xml.replace(/(<zone [^>]*id='3'[^>]*?)>/, `$1>${desktopStyle}`);
    const readback = margin(fixture('plain30.readback.xml'))
      .replace("w='13000' x='0' y='0'", "w='13000' x='400' y='400'")
      .replace("w='26200' x='13000' y='0'", "w='26200' x='13400' y='400'");
    expect(diagnoseXml(margin(fixture('plain30.fragment.xml')), readback)).toBe(
      `zone 3 ("horz"): child widths are [13000, 26200] in Desktop and do not fill the 99200 units (992px) available. ${lead}: zone 5 is-fixed='true' fixed-size='298', zone 6 is-fixed='true' fixed-size='694' (px; each child's margins add to its fixed-size, and the total fills the 992px container)`,
    );
  });

  it('gives no fix when Desktop did not size by content', () => {
    const noCache = fixture('plain30.readback.xml').replace(/<layout-cache[^>]*\/>/g, '');
    expect(diagnoseXml(fixture('plain30.fragment.xml'), noCache)).not.toContain('FIX');
  });

  it('gives no fix for a layout-basic container', () => {
    const basic = (xml: string): string =>
      xml.replace("param='horz' type-v2='layout-flow'", "type-v2='layout-basic'");
    expect(
      diagnoseXml(basic(fixture('plain30.fragment.xml')), basic(fixture('plain30.readback.xml'))),
    ).not.toContain('FIX');
  });
});

describe('fill failure covers every visible child', () => {
  const text = (w: number, x: number): string =>
    `<zone h='100000' id='7' type-v2='text' w='${w}' x='${x}' y='0'><formatted-text><run>Note</run></formatted-text></zone>`;
  const withText = (xml: string, w: number, x: number): string => {
    const basicClose = xml.lastIndexOf('</zone>', xml.indexOf('</zones>'));
    const flowClose = xml.lastIndexOf('</zone>', basicClose - 1);
    return xml.slice(0, flowClose) + text(w, x) + xml.slice(flowClose);
  };

  it('lists a text child and gives the last child the rounding remainder', () => {
    const submitted = withText(
      fixture('plain30.fragment.xml')
        .replace("w='30000'", "w='33333'")
        .replace("w='70000' x='30000'", "w='33333' x='33333'"),
      33334,
      66666,
    );
    const readback = withText(fixture('plain30.readback.xml'), 33334, 39200);
    expect(diagnoseXml(submitted, readback)).toBe(
      fill(
        '13000, 26200, 33334',
        `${lead}: zone 5 is-fixed='true' fixed-size='333', zone 6 is-fixed='true' fixed-size='333', zone 7 is-fixed='true' fixed-size='334' ${explain}`,
      ),
    );
  });

  it('gives no fix when every child is already pinned', () => {
    const readback = fixture('fixed30.readback.xml')
      .replace(
        /(<zone fixed-size[^>]*?) \/>/g,
        "$1><layout-cache fixed-size-w='130' type-h='fixed' type-w='fixed' /></zone>",
      )
      .replace("w='70000' x='30000'", "w='60000' x='30000'");
    const reason = diagnoseXml(fixture('fixed30.fragment.xml'), readback);
    expect(reason).toContain('child widths are [30000, 60000]');
    expect(reason).not.toContain('FIX');
  });
});

describe('fill failure container', () => {
  // Derived from r88-plain30-1 with a user-hidden text child that must not get a pin.
  it('leaves a user-hidden child out of the FIX', () => {
    const hiddenText =
      "<zone h='100000' hidden-by-user='true' id='7' type-v2='text' w='1000' x='0' y='0'><formatted-text><run>n</run></formatted-text></zone>";
    const withHidden = (xml: string): string => {
      const basicClose = xml.lastIndexOf('</zone>', xml.indexOf('</zones>'));
      const flowClose = xml.lastIndexOf('</zone>', basicClose - 1);
      return xml.slice(0, flowClose) + hiddenText + xml.slice(flowClose);
    };
    expect(
      diagnoseXml(
        withHidden(fixture('plain30.fragment.xml')),
        withHidden(fixture('plain30.readback.xml')),
      ),
    ).toBe(fill('13000, 26200', pins(300, 700)));
  });

  // Derived from r88-plain30-1 with is-pixels zones: px is the span, not the 1000px dashboard size.
  it('takes px from the span when the zones are is-pixels', () => {
    const pixels = (xml: string): string => xml.replace('<zones>', "<zones is-pixels='true'>");
    expect(
      diagnoseXml(pixels(fixture('plain30.fragment.xml')), pixels(fixture('plain30.readback.xml'))),
    ).toContain(
      "FIX: pin every child of zone 3: zone 5 is-fixed='true' fixed-size='30000', zone 6 is-fixed='true' fixed-size='70000' (px; each child's margins add to its fixed-size, and the total fills the 100000px container)",
    );
  });

  // Derived from r88-plain30-1 with a range-sized dashboard (min 800, max 1000), so px is unknown.
  it('gives no FIX and no px for a range-sized dashboard', () => {
    const range = (xml: string): string => xml.replace("minwidth='1000'", "minwidth='800'");
    expect(
      diagnoseXml(range(fixture('plain30.fragment.xml')), range(fixture('plain30.readback.xml'))),
    ).toBe(
      'zone 3 ("horz"): child widths are [13000, 26200] in Desktop, which does not match the allocation of the submitted [30000, 70000] in 100000 units',
    );
  });
});

describe('fill failure length', () => {
  it('leaves the FIX out whole when the reason would be too long', () => {
    const texts = (width: number, from: number): string =>
      Array.from(
        { length: 24 },
        (_, i) =>
          `<zone h='100000' id='${10 + i}' type-v2='text' w='${width}' x='${from + i * width}' y='0'><formatted-text><run>n</run></formatted-text></zone>`,
      ).join('');
    const withTexts = (xml: string, width: number, from: number): string => {
      const basicClose = xml.lastIndexOf('</zone>', xml.indexOf('</zones>'));
      const flowClose = xml.lastIndexOf('</zone>', basicClose - 1);
      return xml.slice(0, flowClose) + texts(width, from) + xml.slice(flowClose);
    };
    const reason = diagnoseXml(
      withTexts(
        fixture('plain30.fragment.xml')
          .replace("w='30000'", "w='10000'")
          .replace("w='70000' x='30000'", "w='10000' x='10000'"),
        3750,
        20000,
      ),
      withTexts(fixture('plain30.readback.xml'), 100, 39200),
    )!;
    expect(reason).toMatch(/^zone 3 \("horz"\): child widths are \[13000, 26200, 100,/);
    expect(reason).not.toContain('FIX');
    expect(reason).not.toContain('…');
  });
});

describe('fill failure label', () => {
  it('says px when the zones are is-pixels', () => {
    const pixels = (xml: string): string => xml.replace('<zones>', "<zones is-pixels='true'>");
    const reason = diagnoseXml(
      pixels(fixture('plain30.fragment.xml')),
      pixels(fixture('plain30.readback.xml')),
    );
    expect(reason).toContain('allocation of the submitted [30000, 70000] in 100000px.');
    expect(reason).not.toContain('units');
  });
});
