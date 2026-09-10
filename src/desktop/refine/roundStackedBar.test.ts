import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

import { planRoundStackedBar } from './roundStackedBar.js';

type FixtureOptions = {
  axis?: string;
  categorySort?: string;
  colorEncoding?: string;
  datasourceCount?: number;
  dependenciesCount?: number;
  extraColumnDefinitions?: string;
  extraColumnInstances?: string;
  extraPaneNode?: string;
  filter?: string;
  layoutOptions?: string;
  mark?: string;
  panes?: number;
  preset?: string;
  rows?: string;
  cols?: string;
  simpleId?: string;
  slices?: string;
  sourceTableCalc?: string;
  sourceMeasureCalculation?: string;
  sourceMeasureDefaultFormat?: string;
  sourceTooltip?: string;
  showFullRange?: string;
};

const INTERNAL_DS = 'federated.sales&amp;ops';
const DS_REF = 'federated.sales&ops';
const CONNECTION_ID = 'excel-direct.connection-id-do-not-bind';

function directElements(parent: Element, tagName?: string): Element[] {
  return Array.from(parent.childNodes)
    .filter((node): node is Element => node.nodeType === 1)
    .filter((node) => tagName === undefined || node.tagName === tagName);
}

function serializeFixture(document: Document): string {
  return new XMLSerializer()
    .serializeToString(document as unknown as Parameters<XMLSerializer['serializeToString']>[0])
    .replace(
      /(\s[\w:.-]+)="([^"]*)"/g,
      (_match, name: string, value: string) => `${name}='${value.replaceAll("'", '&apos;')}'`,
    )
    .replace(/\s*\/>/g, ' />');
}

function tableauHostRoundedReadback(xml: string): string {
  const document = new DOMParser().parseFromString(xml, 'application/xml') as unknown as Document;
  const dependency = document.getElementsByTagName('datasource-dependencies')[0];
  const declarations = directElements(dependency).filter((element) =>
    ['column', 'column-instance'].includes(element.tagName),
  );
  for (const declaration of declarations) dependency.removeChild(declaration);
  const byName = (left: Element, right: Element): number => {
    const a = left.getAttribute('name') ?? '';
    const b = right.getAttribute('name') ?? '';
    return a < b ? -1 : a > b ? 1 : 0;
  };
  for (const declaration of [
    ...declarations.filter((element) => element.tagName === 'column').sort(byName),
    ...declarations.filter((element) => element.tagName === 'column-instance').sort(byName),
  ]) {
    dependency.appendChild(declaration);
  }

  const omittedByRole = {
    x: ['_lo]', '_hi]'],
    y: ['_top_radius_x]', '_bottom_radius_x]'],
  } as const;
  for (const role of ['x', 'y'] as const) {
    const instance = directElements(dependency, 'column-instance').find((candidate) =>
      (candidate.getAttribute('column') ?? '').endsWith(`_${role}]`),
    );
    if (!instance) throw new Error(`missing ${role} instance`);
    for (const tableCalc of directElements(instance, 'table-calc')) {
      const field = tableCalc.getAttribute('field') ?? '';
      if (omittedByRole[role].some((suffix) => field.endsWith(suffix))) {
        instance.removeChild(tableCalc);
      }
    }
    for (const tableCalc of directElements(instance, 'table-calc').reverse()) {
      instance.appendChild(tableCalc);
    }
  }

  const style = document.getElementsByTagName('style')[0];
  const axisRules = directElements(style, 'style-rule').filter(
    (rule) => rule.getAttribute('element') === 'axis',
  );
  const hiddenX = axisRules
    .flatMap((rule) => directElements(rule, 'format'))
    .find(
      (format) =>
        format.getAttribute('attr') === 'display' &&
        (format.getAttribute('field') ?? '').endsWith('_x:qk]'),
    );
  if (!hiddenX || axisRules.length === 0) throw new Error('missing hidden X axis format');
  const hiddenXRule = hiddenX.parentNode as Element;
  if (hiddenXRule !== axisRules[0]) {
    hiddenXRule.removeChild(hiddenX);
    axisRules[0].appendChild(hiddenX);
    if (directElements(hiddenXRule).length === 0) hiddenXRule.parentNode?.removeChild(hiddenXRule);
  }
  return serializeFixture(document);
}

function mutateGeometryTableCalc(
  xml: string,
  role: 'x' | 'y',
  fieldSuffix: string,
  mutation: 'delete' | 'wrong-order',
): string {
  const document = new DOMParser().parseFromString(xml, 'application/xml') as unknown as Document;
  const dependency = document.getElementsByTagName('datasource-dependencies')[0];
  const instance = directElements(dependency, 'column-instance').find((candidate) =>
    (candidate.getAttribute('column') ?? '').endsWith(`_${role}]`),
  );
  const tableCalc = instance
    ? directElements(instance, 'table-calc').find((candidate) =>
        (candidate.getAttribute('field') ?? '').endsWith(fieldSuffix),
      )
    : undefined;
  if (!instance || !tableCalc) throw new Error(`missing ${role} ${fieldSuffix} table calculation`);
  if (mutation === 'delete') instance.removeChild(tableCalc);
  else tableCalc.setAttribute('ordering-field', '[federated.sales&ops].[corrupted]');
  return serializeFixture(document);
}

function worksheet(options: FixtureOptions = {}): string {
  const category = `[${DS_REF}].[none:Category & Group:nk]`;
  const segment = `[${DS_REF}].[none:Segment:nk]`;
  const measure = `[${DS_REF}].[sum:Profit & Margin:qk]`;
  const datasourceCount = options.datasourceCount ?? 1;
  const dependenciesCount = options.dependenciesCount ?? 1;
  const panes = options.panes ?? 1;
  const datasourceRefs = Array.from({ length: datasourceCount }, (_, index) =>
    index === 0
      ? `<datasource caption='Friendly &amp; &lt;Sales&gt;' name='${INTERNAL_DS}'>
          <connection class='federated'><named-connections>
            <named-connection caption='Friendly &amp; &lt;Sales&gt;' name='${CONNECTION_ID}' />
          </named-connections></connection>
        </datasource>`
      : `<datasource name='second.${index}' />`,
  ).join('');
  const dependencies = Array.from({ length: dependenciesCount }, (_, index) => {
    const datasource = index === 0 ? INTERNAL_DS : `second.${index}`;
    return `<datasource-dependencies datasource='${datasource}'>
        <column caption='Category &amp; &lt;Group&gt;' datatype='string' name='[Category &amp; Group]' role='dimension' type='nominal' />
        <column caption='Segment &amp; Team' datatype='string' name='[Segment]' role='dimension' type='nominal' />
        <column caption='Profit &amp; Margin' datatype='real'${options.sourceMeasureDefaultFormat === undefined ? '' : ` default-format='${options.sourceMeasureDefaultFormat}'`} name='[Profit &amp; Margin]' role='measure' type='quantitative'${options.sourceMeasureCalculation ? `>${options.sourceMeasureCalculation}</column>` : ' />'}
        ${options.extraColumnDefinitions ?? ''}
        <column-instance column='[Category &amp; Group]' derivation='None' name='[none:Category &amp; Group:nk]' pivot='key' type='nominal' />
        <column-instance column='[Segment]' derivation='None' name='[none:Segment:nk]' pivot='key' type='nominal' />
        <column-instance column='[Profit &amp; Margin]' derivation='Sum' name='[sum:Profit &amp; Margin:qk]' pivot='key' type='quantitative' />
        ${options.extraColumnInstances ?? ''}
        ${options.sourceTableCalc ?? ''}
      </datasource-dependencies>`;
  }).join('');
  const filter = options.filter === undefined ? '' : options.filter;
  const slices = options.slices ?? '';
  const categorySort =
    options.categorySort === undefined
      ? `<computed-sort column='${category.replaceAll('&', '&amp;')}' direction='DESC' using='${measure.replaceAll('&', '&amp;')}' />`
      : options.categorySort;
  const color = options.colorEncoding ?? `<color column='${segment.replaceAll('&', '&amp;')}' />`;
  const paneXml = Array.from(
    { length: panes },
    () => `<pane id='1' selection-relaxation-option='selection-relaxation-allow'>
      <view><breakdown value='auto' /></view>
      <mark class='${options.mark ?? 'Bar'}' />
      <encodings>${color}${options.sourceTooltip ?? ''}</encodings>
      ${options.extraPaneNode ?? ''}
    </pane>`,
  ).join('');
  const axis =
    options.axis ??
    `<style-rule element='axis'>
      <format attr='line-visibility' value='off' />
      <format attr='title' class='0' field='${measure.replaceAll('&', '&amp;')}' scope='rows' value='Profit &amp; Margin (USD)' />
    </style-rule>`;

  return `<worksheet name='Orders &amp; &lt;North&gt;' xmlns:user='http://www.tableausoftware.com/xml/user'>
  ${options.layoutOptions ?? ''}
  <table>
    <view>
      <datasources>${datasourceRefs}</datasources>
      ${dependencies}
      ${filter}
      ${categorySort}
      ${slices}
      <aggregation value='true' />
    </view>
    <style>
      ${axis}
      <style-rule element='mark'>
        <encoding attr='color' field='${segment.replaceAll('&', '&amp;')}' palette='Safe Palette' type='palette'>
          <map to='#123456'><bucket>&quot;Consumer&quot;</bucket></map>
        </encoding>
      </style-rule>
      <style-rule element='gridline'><format attr='line-visibility' value='off' /></style-rule>
      <style-rule element='zeroline'><format attr='line-visibility' value='off' /></style-rule>
      <style-rule element='worksheet'><format attr='display-field-labels' scope='rows' value='false' /></style-rule>
    </style>
    <panes>${paneXml}</panes>
    <rows>${options.rows ?? measure.replaceAll('&', '&amp;')}</rows>
    <cols>${options.cols ?? category.replaceAll('&', '&amp;')}</cols>
    ${options.showFullRange ?? ''}
  </table>
  <repository-location derived-from='https://example.invalid/kept' />
  ${options.simpleId === '' ? '' : `<simple-id uuid='${options.simpleId ?? '{B157D4FA-12A0-495E-BEC4-3572B3567648}'}' />`}
</worksheet>`;
}

function westFilter(memberCount = 1): { filter: string; slices: string } {
  const members = Array.from(
    { length: memberCount },
    (_, index) =>
      `<groupfilter function='member' level='[none:Region:nk]' member='&quot;West ${index + 1}&quot;' />`,
  ).join('');
  return {
    filter: `<filter class='categorical' column='[${INTERNAL_DS}].[none:Region:nk]'>
      <groupfilter function='union' user:ui-enumeration='inclusive'>${members}</groupfilter>
    </filter>`,
    slices: `<slices><column>[${INTERNAL_DS}].[none:Region:nk]</column></slices>`,
  };
}

function expectRefusal(xml: string, pattern: RegExp): void {
  const result = planRoundStackedBar(xml, { preset: 'subtle' });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toMatch(pattern);
}

function expectRoundedSignatureRefusal(
  mutate: (xml: string) => string,
  source = worksheet(),
  normalize: (xml: string) => string = (xml) => xml,
): void {
  const first = planRoundStackedBar(source, { preset: 'subtle' });
  expect(first.ok).toBe(true);
  if (!first.ok) return;
  const rounded = normalize(first.xml);
  const corrupted = mutate(rounded);
  expect(corrupted).not.toBe(rounded);
  expectRefusal(corrupted, /deterministic rounded signature/i);
}

describe('planRoundStackedBar', () => {
  it('exposes only runtime verification evidence in the semantic contract', () => {
    const result = planRoundStackedBar(worksheet(), { preset: 'subtle' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.semanticContract).not.toHaveProperty('helperColumns');
    expect(result.semanticContract).not.toHaveProperty('stackOrder');
    expect(result.semanticContract).not.toHaveProperty('requiredPreflight');
    expect(result.semanticContract).not.toHaveProperty('manualVerification');
    expect(result.semanticContract).not.toHaveProperty('knownLimitations');
    expect(Object.values(result.semanticContract.helpers)).toHaveLength(18);
  });

  it('compiles the narrow vertical SUM stacked-bar shape to deterministic hidden 12-point Polygon geometry', () => {
    const result = planRoundStackedBar(worksheet(), { preset: 'subtle' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.alreadyRounded).toBe(false);
    expect(result.semanticContract.worksheetId).toBe('{B157D4FA-12A0-495E-BEC4-3572B3567648}');
    expect(result.semanticContract.datasource).toEqual({
      internalName: DS_REF,
      caption: 'Friendly & <Sales>',
    });
    expect(result.semanticContract.category.caption).toBe('Category & <Group>');
    expect(result.semanticContract.segment.caption).toBe('Segment & Team');
    expect(result.semanticContract.measure.caption).toBe('Profit & Margin');
    expect(result.semanticContract.measure.aggregation).toBe('SUM');
    expect(result.semanticContract.helpers.bin).toEqual({
      caption: 'TMCP rounded path frame',
      column: '[__tmcp_round_b157d4fa12a0_bin]',
      columnInstance: '[none:__tmcp_round_b157d4fa12a0_bin:ok]',
    });

    expect(result.xml).toContain("<mark class='Polygon' />");
    expect(result.xml).toContain('CASE INDEX() WHEN 1 THEN -0.35');
    expect(result.xml).toContain('WHEN 12 THEN -0.35+0.292893*');
    expect(result.xml).toContain('WINDOW_SUM([');
    expect(result.xml).toContain('-RUNNING_SUM([');
    expect(result.xml).toContain('])+[');
    expect(result.xml).toContain('<show-full-range>');
    expect(result.xml).toContain(
      "field='[federated.sales&amp;ops].[__tmcp_round_b157d4fa12a0_pos_end]' ordering-field='[federated.sales&amp;ops].[none:Segment:nk]' ordering-type='Field'",
    );
    expect(result.xml).not.toContain('<order ');

    const helperDefinitions = [
      ...result.xml.matchAll(
        /<column\b(?=[^>]*\bhidden='true')(?=[^>]*\bname='\[__tmcp_round_b157d4fa12a0_[^']+\]')[^>]*>/g,
      ),
    ];
    expect(helperDefinitions).toHaveLength(18);
    expect(
      new Set(helperDefinitions.map(([definition]) => definition.match(/name='([^']+)'/)?.[1]))
        .size,
    ).toBe(18);
  });

  it('preserves the category sort, filter/slice, palette, title, and non-table worksheet nodes', () => {
    const { filter, slices } = westFilter();
    const source = worksheet({
      extraColumnInstances:
        "<column caption='Region' datatype='string' name='[Region]' role='dimension' type='nominal' /><column-instance column='[Region]' derivation='None' name='[none:Region:nk]' pivot='key' type='nominal' />",
      filter,
      slices,
    });
    const result = planRoundStackedBar(source, { preset: 'subtle' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.xml).toContain("member='&quot;West 1&quot;'");
    expect(result.xml).toContain(`<column>[${INTERNAL_DS}].[none:Region:nk]</column>`);
    expect(result.xml).toContain("direction='DESC'");
    expect(result.xml).toContain("palette='Safe Palette'");
    expect(result.xml).toMatch(/element='gridline'[\s\S]*?line-visibility' value='off'/);
    expect(result.xml).toMatch(/element='zeroline'[\s\S]*?line-visibility' value='off'/);
    expect(result.xml).toContain("name='Orders &amp; &lt;North&gt;'");
    expect(result.xml).toContain(
      "<repository-location derived-from='https://example.invalid/kept' />",
    );
    expect(result.semanticContract.filter).toEqual(
      expect.objectContaining({ caption: 'Region', member: 'West 1' }),
    );
  });

  it('records the filter source column when its caption differs', () => {
    const source = worksheet({
      extraColumnInstances:
        "<column caption='Sales Territory' datatype='string' name='[Region Code]' role='dimension' type='nominal' /><column-instance column='[Region Code]' derivation='None' name='[none:Region Code:nk]' pivot='key' type='nominal' />",
      filter: `<filter class='categorical' column='[${INTERNAL_DS}].[none:Region Code:nk]'>
        <groupfilter function='union' user:ui-enumeration='inclusive'>
          <groupfilter function='member' level='[none:Region Code:nk]' member='&quot;West&quot;' />
        </groupfilter>
      </filter>`,
      slices: `<slices><column>[${INTERNAL_DS}].[none:Region Code:nk]</column></slices>`,
    });

    const result = planRoundStackedBar(source, { preset: 'subtle' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.semanticContract.filter).toEqual({
      caption: 'Sales Territory',
      column: '[Region Code]',
      columnInstance: '[none:Region Code:nk]',
      member: 'West',
    });
  });

  it('decodes Tableau-escaped quotes in a categorical filter member', () => {
    const source = worksheet({
      extraColumnInstances:
        "<column caption='Product Name' datatype='string' name='[Product Name]' role='dimension' type='nominal' /><column-instance column='[Product Name]' derivation='None' name='[none:Product Name:nk]' pivot='key' type='nominal' />",
      filter: `<filter class='categorical' column='[${INTERNAL_DS}].[none:Product Name:nk]'>
        <groupfilter function='union' user:ui-enumeration='inclusive'>
          <groupfilter function='member' level='[none:Product Name:nk]' member='&quot;Message Book, Standard Line \\&quot;While You Were Out\\&quot;, 5 1/2\\&quot; X 4\\&quot;, 200 Sets/Book&quot;' />
        </groupfilter>
      </filter>`,
      slices: `<slices><column>[${INTERNAL_DS}].[none:Product Name:nk]</column></slices>`,
    });

    const result = planRoundStackedBar(source, { preset: 'subtle' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.semanticContract.filter?.member).toBe(
      'Message Book, Standard Line "While You Were Out", 5 1/2" X 4", 200 Sets/Book',
    );
  });

  it('decodes Tableau-escaped backslashes in a quoted categorical filter member', () => {
    const source = worksheet({
      extraColumnInstances:
        "<column caption='Region' datatype='string' name='[Region]' role='dimension' type='nominal' /><column-instance column='[Region]' derivation='None' name='[none:Region:nk]' pivot='key' type='nominal' />",
      filter: `<filter class='categorical' column='[${INTERNAL_DS}].[none:Region:nk]'>
        <groupfilter function='union' user:ui-enumeration='inclusive'>
          <groupfilter function='member' level='[none:Region:nk]' member='&quot;Path\\\\Name&quot;' />
        </groupfilter>
      </filter>`,
      slices: `<slices><column>[${INTERNAL_DS}].[none:Region:nk]</column></slices>`,
    });

    const result = planRoundStackedBar(source, { preset: 'subtle' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.semanticContract.filter?.member).toBe('Path\\Name');
  });

  it('preserves backslash sequences in an unquoted categorical filter member', () => {
    const source = worksheet({
      extraColumnInstances:
        "<column caption='Region' datatype='string' name='[Region]' role='dimension' type='nominal' /><column-instance column='[Region]' derivation='None' name='[none:Region:nk]' pivot='key' type='nominal' />",
      filter: `<filter class='categorical' column='[${INTERNAL_DS}].[none:Region:nk]'>
        <groupfilter function='union' user:ui-enumeration='inclusive'>
          <groupfilter function='member' level='[none:Region:nk]' member='true\\&quot;sentinel' />
        </groupfilter>
      </filter>`,
      slices: `<slices><column>[${INTERNAL_DS}].[none:Region:nk]</column></slices>`,
    });

    const result = planRoundStackedBar(source, { preset: 'subtle' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.semanticContract.filter?.member).toBe('true\\"sentinel');
  });

  it('uses the top-level/dependency datasource name, never the nested connection id, in generated refs', () => {
    const result = planRoundStackedBar(worksheet(), { preset: 'subtle' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const generated = result.xml.slice(result.xml.indexOf('[__tmcp_round_'));
    expect(generated).toContain(`[${INTERNAL_DS}]`);
    expect(result.xml.match(new RegExp(CONNECTION_ID, 'g'))).toHaveLength(1);
    expect(generated).not.toContain(CONNECTION_ID);
  });

  it('authors human tooltip, caption, and alt text without claiming Data Guide is clean', () => {
    const result = planRoundStackedBar(worksheet(), { preset: 'subtle' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const tooltip =
      result.xml.match(/<customized-tooltip>([\s\S]*?)<\/customized-tooltip>/)?.[1] ?? '';
    expect(result.xml.match(/<customized-tooltip>/g)).toHaveLength(1);
    expect(tooltip).toContain('Category &amp; &lt;Group&gt;');
    expect(tooltip).toContain('Segment &amp; Team');
    expect(tooltip).toContain('Profit &amp; Margin');
    expect(tooltip).toContain(`[${INTERNAL_DS}].[none:Category &amp; Group:nk]`);
    expect(tooltip).toContain(`[${INTERNAL_DS}].[none:Segment:nk]`);
    expect(tooltip).toContain(`[${INTERNAL_DS}].[sum:Profit &amp; Margin:qk]`);
    expect(tooltip).not.toContain('__tmcp_round_');
    const narration =
      'Sum of Profit & Margin for each Category & <Group>. Color shows details about Segment & Team. Rounded corners are visual styling; values are unchanged.';
    const document = new DOMParser().parseFromString(
      result.xml,
      'application/xml',
    ) as unknown as Document;
    const worksheetElement = document.documentElement;
    const layoutOptions = directElements(worksheetElement, 'layout-options');
    expect(layoutOptions).toHaveLength(1);
    expect(directElements(worksheetElement).indexOf(layoutOptions[0])).toBeLessThan(
      directElements(worksheetElement).findIndex((element) => element.tagName === 'table'),
    );
    expect(directElements(layoutOptions[0]).map((element) => element.tagName)).toEqual([
      'caption',
      'alt-text',
    ]);
    expect(directElements(layoutOptions[0], 'caption')[0]?.textContent).toBe(narration);
    expect(directElements(layoutOptions[0], 'alt-text')[0]?.textContent).toBe(narration);
    expect(result.semanticContract.narration).toEqual({
      altText: { status: 'generated', text: narration },
      caption: { status: 'generated', text: narration },
    });
    expect(result.semanticContract).not.toHaveProperty('requiredLiveVerification');
  });

  it('uses the filter field caption in narration without freezing its selected member', () => {
    const { filter, slices } = westFilter();
    const result = planRoundStackedBar(
      worksheet({
        extraColumnInstances:
          "<column caption='Region' datatype='string' name='[Region]' role='dimension' type='nominal' /><column-instance column='[Region]' derivation='None' name='[none:Region:nk]' pivot='key' type='nominal' />",
        filter,
        slices,
      }),
      { preset: 'subtle' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const caption = result.semanticContract.narration.caption;
    expect(caption.status).not.toBe('source-suppressed');
    if (caption.status === 'source-suppressed') return;
    expect(caption.text).toContain('Filtered by Region.');
    expect(result.semanticContract.narration.altText.text).toContain('Filtered by Region.');
    expect(caption.text).not.toContain('West 1');
    expect(result.xml).not.toMatch(/<caption>[\s\S]*West 1[\s\S]*<\/caption>/);
    expect(result.xml).not.toMatch(/<alt-text>[\s\S]*West 1[\s\S]*<\/alt-text>/);
  });

  it('preserves custom layout narration and attributes verbatim', () => {
    const layoutOptions = `<layout-options export-all-view-pages='true' export-no-title='true'>
    <title><formatted-text><run bold='true'>Custom title</run></formatted-text></title>
    <caption>
      <formatted-text>
        <run fontcolor='#123456'>Custom caption</run>
        <run> kept</run>
      </formatted-text>
    </caption>
    <alt-text>
      <formatted-text>
        <run>Custom alt</run>
        <run> text</run>
      </formatted-text>
    </alt-text>
    <filter-alt-text><filter alt-text='Custom filter alt' field='[Region]' /></filter-alt-text>
  </layout-options>`;
    const result = planRoundStackedBar(worksheet({ layoutOptions }), { preset: 'subtle' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const document = new DOMParser().parseFromString(
      result.xml,
      'application/xml',
    ) as unknown as Document;
    const layout = directElements(document.documentElement, 'layout-options')[0];
    expect(layout.getAttribute('export-all-view-pages')).toBe('true');
    expect(layout.getAttribute('export-no-title')).toBe('true');
    expect(directElements(layout).map((element) => element.tagName)).toEqual([
      'title',
      'caption',
      'alt-text',
      'filter-alt-text',
    ]);
    const serializedLayout =
      serializeFixture(layout.ownerDocument).match(
        /<layout-options[\s\S]*?<\/layout-options>/,
      )?.[0] ?? '';
    expect(serializedLayout).toContain("<run fontcolor='#123456'>Custom caption</run>");
    expect(serializedLayout).toContain('<run> kept</run>');
    expect(result.semanticContract.narration).toEqual({
      altText: { status: 'preserved', text: 'Custom alt text' },
      caption: { status: 'preserved', text: 'Custom caption kept' },
    });
  });

  it('never rewrites attribute-like quote syntax inside custom narration text', () => {
    const captionText = 'Custom caption x="y"';
    const altText = 'Custom alt text x="y"';
    const first = planRoundStackedBar(
      worksheet({
        layoutOptions: `<layout-options>
          <caption><formatted-text><run>${captionText}</run></formatted-text></caption>
          <alt-text><formatted-text><run>${altText}</run></formatted-text></alt-text>
        </layout-options>`,
      }),
      { preset: 'subtle' },
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.semanticContract.narration).toEqual({
      altText: { status: 'preserved', text: altText },
      caption: { status: 'preserved', text: captionText },
    });

    const document = new DOMParser().parseFromString(
      first.xml,
      'application/xml',
    ) as unknown as Document;
    const layout = directElements(document.documentElement, 'layout-options')[0];
    expect(directElements(layout, 'caption')[0]?.textContent).toBe(captionText);
    expect(directElements(layout, 'alt-text')[0]?.textContent).toBe(altText);
  });

  it('preserves CDATA-backed narration and comments containing attribute-like quotes', () => {
    const captionText = 'CDATA caption x="y"';
    const altText = 'CDATA alt text x="y"';
    const captionComment = '<!-- caption note x="y" -->';
    const altComment = '<!-- alt note x="y" -->';
    const first = planRoundStackedBar(
      worksheet({
        layoutOptions: `<layout-options>
          <caption>${captionComment}<formatted-text><run><![CDATA[${captionText}]]></run></formatted-text></caption>
          <alt-text>${altComment}<formatted-text><run><![CDATA[${altText}]]></run></formatted-text></alt-text>
        </layout-options>`,
      }),
      { preset: 'subtle' },
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.xml).toContain(captionComment);
    expect(first.xml).toContain(altComment);
    expect(first.xml).toContain(`<![CDATA[${captionText}]]>`);
    expect(first.xml).toContain(`<![CDATA[${altText}]]>`);
    expect(first.semanticContract.narration).toEqual({
      altText: { status: 'preserved', text: altText },
      caption: { status: 'preserved', text: captionText },
    });
  });

  it('inserts missing caption and alt text in XSD order without disturbing title or filter alt text', () => {
    const result = planRoundStackedBar(
      worksheet({
        layoutOptions: `<layout-options export-no-title='false'>
          <title><formatted-text><run>Existing title</run></formatted-text></title>
          <filter-alt-text><filter alt-text='Existing filter alt' field='[Region]' /></filter-alt-text>
        </layout-options>`,
      }),
      { preset: 'subtle' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const document = new DOMParser().parseFromString(
      result.xml,
      'application/xml',
    ) as unknown as Document;
    const layout = directElements(document.documentElement, 'layout-options')[0];
    expect(directElements(layout).map((element) => element.tagName)).toEqual([
      'title',
      'caption',
      'alt-text',
      'filter-alt-text',
    ]);
    expect(directElements(layout, 'title')[0]?.textContent).toBe('Existing title');
    expect(
      directElements(layout, 'filter-alt-text')[0]
        ?.getElementsByTagName('filter')[0]
        ?.getAttribute('alt-text'),
    ).toBe('Existing filter alt');
  });

  it('honors export-no-caption while still adding alt text and preserving an existing caption', () => {
    const suppressed = planRoundStackedBar(
      worksheet({ layoutOptions: "<layout-options export-no-caption='true' />" }),
      { preset: 'subtle' },
    );
    expect(suppressed.ok).toBe(true);
    if (!suppressed.ok) return;
    expect(suppressed.xml).not.toContain('<caption>');
    expect(suppressed.xml).toContain('<alt-text>');
    expect(suppressed.semanticContract.narration.caption).toEqual({
      status: 'source-suppressed',
    });
    expect(suppressed.semanticContract.narration.altText.status).toBe('generated');

    const preserved = planRoundStackedBar(
      worksheet({
        layoutOptions:
          "<layout-options export-no-caption='true'><caption><formatted-text><run>Hidden custom caption</run></formatted-text></caption></layout-options>",
      }),
      { preset: 'subtle' },
    );
    expect(preserved.ok).toBe(true);
    if (!preserved.ok) return;
    expect(preserved.xml).toContain('Hidden custom caption');
    expect(preserved.semanticContract.narration.caption).toEqual({
      status: 'preserved',
      text: 'Hidden custom caption',
    });
  });

  it.each([
    [
      'duplicate layout-options',
      worksheet({ layoutOptions: '<layout-options /><layout-options />' }),
    ],
    [
      'duplicate caption',
      worksheet({
        layoutOptions:
          '<layout-options><caption><formatted-text /></caption><caption><formatted-text /></caption></layout-options>',
      }),
    ],
    [
      'duplicate alt text',
      worksheet({
        layoutOptions:
          '<layout-options><alt-text><formatted-text /></alt-text><alt-text><formatted-text /></alt-text></layout-options>',
      }),
    ],
    [
      'out-of-order narration',
      worksheet({
        layoutOptions:
          '<layout-options><alt-text><formatted-text /></alt-text><caption><formatted-text /></caption></layout-options>',
      }),
    ],
    [
      'malformed caption ownership',
      worksheet({
        layoutOptions:
          '<layout-options><caption><formatted-text /><formatted-text /></caption></layout-options>',
      }),
    ],
    [
      'invalid export-no-caption',
      worksheet({ layoutOptions: "<layout-options export-no-caption='maybe' />" }),
    ],
  ])('refuses %s rather than guessing narration ownership', (_label, source) => {
    expectRefusal(source, /layout-options|caption|alt-text|export-no-caption/i);
  });

  it('requires caption and alt text in the rounded signature', () => {
    const first = planRoundStackedBar(worksheet(), { preset: 'subtle' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    for (const tagName of ['caption', 'alt-text']) {
      const corrupted = first.xml.replace(new RegExp(`<${tagName}>[\\s\\S]*?<\\/${tagName}>`), '');
      expect(corrupted).not.toBe(first.xml);
      expectRefusal(corrupted, /deterministic rounded signature|caption|alt-text/i);
    }
  });

  it('is byte-idempotent and creates no duplicate helpers on a second call', () => {
    const first = planRoundStackedBar(worksheet(), { preset: 'subtle' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = planRoundStackedBar(first.xml, { preset: 'subtle' });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.alreadyRounded).toBe(true);
    expect(second.xml).toBe(first.xml);
    expect(second.semanticContract.helpers).toEqual(first.semanticContract.helpers);
  });

  it('emits the exact role-specific X/Y table-calculation closures Desktop keeps', () => {
    const result = planRoundStackedBar(worksheet(), { preset: 'subtle' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const document = new DOMParser().parseFromString(
      result.xml,
      'application/xml',
    ) as unknown as Document;
    const dependency = document.getElementsByTagName('datasource-dependencies')[0];
    const declarations = directElements(dependency).filter((element) =>
      ['column', 'column-instance'].includes(element.tagName),
    );
    const firstInstance = declarations.findIndex(
      (element) => element.tagName === 'column-instance',
    );
    expect(firstInstance).toBeGreaterThan(0);
    expect(
      declarations.slice(0, firstInstance).every((element) => element.tagName === 'column'),
    ).toBe(true);
    for (const group of [declarations.slice(0, firstInstance), declarations.slice(firstInstance)]) {
      expect(
        group.every(
          (element, index) =>
            index === 0 ||
            (group[index - 1].getAttribute('name') ?? '') <= (element.getAttribute('name') ?? ''),
        ),
      ).toBe(true);
    }
    const fieldsFor = (role: 'x' | 'y'): string[] => {
      const instance = directElements(dependency, 'column-instance').find((candidate) =>
        (candidate.getAttribute('column') ?? '').endsWith(`_${role}]`),
      );
      expect(instance).toBeTruthy();
      return directElements(instance as Element, 'table-calc')
        .map((tableCalc) => tableCalc.getAttribute('field') ?? '<root>')
        .sort();
    };

    const xFields = fieldsFor('x');
    const yFields = fieldsFor('y');
    expect(xFields).toHaveLength(12);
    expect(xFields).not.toEqual(
      expect.arrayContaining([expect.stringContaining('_lo]'), expect.stringContaining('_hi]')]),
    );
    expect(xFields).toEqual(
      expect.arrayContaining([
        expect.stringContaining('_top_radius_x]'),
        expect.stringContaining('_bottom_radius_x]'),
      ]),
    );
    expect(yFields).toHaveLength(12);
    expect(yFields).toEqual(
      expect.arrayContaining([expect.stringContaining('_lo]'), expect.stringContaining('_hi]')]),
    );
    expect(yFields).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining('_top_radius_x]'),
        expect.stringContaining('_bottom_radius_x]'),
      ]),
    );
  });

  it('recognizes the exact live host normalization as already rounded', () => {
    const first = planRoundStackedBar(worksheet(), { preset: 'subtle' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const readback = tableauHostRoundedReadback(first.xml);

    const second = planRoundStackedBar(readback, { preset: 'subtle' });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.alreadyRounded).toBe(true);
    expect(second.xml).toBe(readback);
  });

  it('creates one shared axis rule for synthesized Y title and hidden X when none exists', () => {
    const result = planRoundStackedBar(worksheet({ axis: '' }), { preset: 'subtle' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const document = new DOMParser().parseFromString(
      result.xml,
      'application/xml',
    ) as unknown as Document;
    const style = document.getElementsByTagName('style')[0];
    const axisRules = directElements(style, 'style-rule').filter(
      (rule) => rule.getAttribute('element') === 'axis',
    );

    expect(axisRules).toHaveLength(1);
    expect(directElements(axisRules[0], 'format')).toHaveLength(2);
    expect(
      directElements(axisRules[0], 'format').map((format) => format.getAttribute('attr')),
    ).toEqual(['title', 'display']);
  });

  it.each([
    ['a required X closure', 'x', '_pos_end]', 'delete'],
    ['a required Y closure ordering field', 'y', '_hi]', 'wrong-order'],
  ] as const)('refuses host readback with corrupted %s', (_label, role, suffix, mutation) => {
    expectRoundedSignatureRefusal(
      (xml) => mutateGeometryTableCalc(xml, role, suffix, mutation),
      worksheet(),
      tableauHostRoundedReadback,
    );
  });

  it.each([
    [
      'missing generated hidden-X axis format',
      (xml: string) =>
        xml.replace(
          "<format attr='display' class='0' field='[federated.sales&amp;ops].[usr:__tmcp_round_b157d4fa12a0_x:qk]' scope='cols' value='false' />",
          '',
        ),
    ],
    [
      'duplicate generated hidden-X axis format',
      (xml: string) => {
        const hiddenXAxis =
          "<format attr='display' class='0' field='[federated.sales&amp;ops].[usr:__tmcp_round_b157d4fa12a0_x:qk]' scope='cols' value='false' />";
        return xml.replace(hiddenXAxis, `${hiddenXAxis}${hiddenXAxis}`);
      },
    ],
    [
      'retargeted Y-axis format',
      (xml: string) =>
        xml.replace(
          "field='[federated.sales&amp;ops].[usr:__tmcp_round_b157d4fa12a0_y:qk]' scope='rows'",
          "field='[federated.sales&amp;ops].[sum:Profit &amp; Margin:qk]' scope='rows'",
        ),
    ],
    [
      'duplicate generated Y-axis format',
      (xml: string) => {
        const yAxisTitle =
          "<format attr='title' class='0' field='[federated.sales&amp;ops].[usr:__tmcp_round_b157d4fa12a0_y:qk]' scope='rows' value='Profit &amp; Margin (USD)' />";
        return xml.replace(
          yAxisTitle,
          `${yAxisTitle}${yAxisTitle.replace("value='Profit &amp; Margin (USD)'", "value='Conflicting title'")}`,
        );
      },
    ],
  ])('refuses rounded output with a %s', (_label, mutate) => {
    expectRoundedSignatureRefusal(mutate as (xml: string) => string);
  });

  it('refuses duplicate source-measure axis formats before generating a non-idempotent result', () => {
    const measure = `[${DS_REF}].[sum:Profit & Margin:qk]`.replaceAll('&', '&amp;');
    const title = `<format attr='title' class='0' field='${measure}' scope='rows' value='Profit &amp; Margin (USD)' />`;
    const conflictingTitle = title.replace(
      "value='Profit &amp; Margin (USD)'",
      "value='Conflicting title'",
    );
    const source = worksheet({
      axis: `<style-rule element='axis'>${title}${conflictingTitle}</style-rule>`,
    });

    expectRefusal(source, /duplicate.*axis format/i);
  });

  it('copies the source measure default format and synthesizes one human Y-axis title when none exists', () => {
    const source = worksheet({
      axis: "<style-rule element='axis'><format attr='line-visibility' value='off' /></style-rule>",
      sourceMeasureDefaultFormat: 'n#,##0.00',
    }).replace(
      `<datasource caption='Friendly &amp; &lt;Sales&gt;' name='${INTERNAL_DS}'>
          <connection class='federated'><named-connections>
            <named-connection caption='Friendly &amp; &lt;Sales&gt;' name='${CONNECTION_ID}' />
          </named-connections></connection>
        </datasource>`,
      `<datasource name='${INTERNAL_DS}' />`,
    );

    const first = planRoundStackedBar(source, { preset: 'subtle' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const yDefinition =
      first.xml.match(/<column\b(?=[^>]*name='\[__tmcp_round_b157d4fa12a0_y\]')[^>]*>/)?.[0] ?? '';
    expect(yDefinition).toContain("default-format='n#,##0.00'");
    expect(first.xml.match(/<format attr='title'/g)).toHaveLength(1);
    expect(first.xml).toContain(
      "<format attr='title' class='0' field='[federated.sales&amp;ops].[usr:__tmcp_round_b157d4fa12a0_y:qk]' scope='rows' value='Profit &amp; Margin' />",
    );
  });

  it.each([
    [
      'generated Y default format',
      (xml: string) =>
        xml.replace(
          /(<column\b(?=[^>]*name='\[__tmcp_round_b157d4fa12a0_y\]')[^>]*?) default-format='n#,##0\.00'/,
          '$1',
        ),
    ],
    [
      'synthesized human Y-axis title',
      (xml: string) =>
        xml.replace(
          "<format attr='title' class='0' field='[federated.sales&amp;ops].[usr:__tmcp_round_b157d4fa12a0_y:qk]' scope='rows' value='Profit &amp; Margin' />",
          '',
        ),
    ],
    [
      'synthesized Y-axis title rows scope',
      (xml: string) =>
        xml.replace(
          "field='[federated.sales&amp;ops].[usr:__tmcp_round_b157d4fa12a0_y:qk]' scope='rows' value='Profit &amp; Margin'",
          "field='[federated.sales&amp;ops].[usr:__tmcp_round_b157d4fa12a0_y:qk]' scope='cols' value='Profit &amp; Margin'",
        ),
    ],
  ])('refuses rounded output missing its %s invariant', (_label, mutate) => {
    const source = worksheet({
      axis: "<style-rule element='axis'><format attr='line-visibility' value='off' /></style-rule>",
      sourceMeasureDefaultFormat: 'n#,##0.00',
    });
    expectRoundedSignatureRefusal(mutate as (xml: string) => string, source);
  });

  it('refuses competing row-axis title slots instead of guessing which one owns the measure title', () => {
    const measure = `[${DS_REF}].[sum:Profit & Margin:qk]`.replaceAll('&', '&amp;');
    const source = worksheet({
      axis: `<style-rule element='axis'>
        <format attr='title' class='0' scope='rows' value='Global title' />
        <format attr='title' class='0' field='${measure}' scope='rows' value='Measure title' />
      </style-rule>`,
    });

    expectRefusal(source, /ambiguous.*axis title/i);
  });

  it('refuses duplicate source-measure definitions with competing default formats', () => {
    const source = worksheet({
      extraColumnDefinitions:
        "<column caption='Profit duplicate' datatype='real' default-format='p0%' name='[Profit &amp; Margin]' role='measure' type='quantitative' />",
      sourceMeasureDefaultFormat: 'n#,##0.00',
    });

    expectRefusal(source, /duplicate.*measure.*definition|default-format/i);
  });

  it('emits only the live Desktop Category * X shelf form', () => {
    const first = planRoundStackedBar(worksheet(), { preset: 'subtle' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(first.xml).toContain(
      '<cols>([federated.sales&amp;ops].[none:Category &amp; Group:nk] * [federated.sales&amp;ops].[usr:__tmcp_round_b157d4fa12a0_x:qk])</cols>',
    );
    const unrelatedOperator = planRoundStackedBar(first.xml.replace(' * ', ' + '), {
      preset: 'subtle',
    });
    expect(unrelatedOperator.ok).toBe(false);
  });

  it.each([
    [
      'helper formula',
      (xml: string) =>
        xml.replace(
          /(<column\b(?=[^>]*name='\[__tmcp_round_b157d4fa12a0_dense\]')[\s\S]*?<calculation\b[^>]*formula=')[^']*'/,
          (_match, prefix: string) => `${prefix}0'`,
        ),
    ],
    [
      'rows shelf',
      (xml: string) =>
        xml.replace(
          /<rows>[^<]*<\/rows>/,
          '<rows>[federated.sales&amp;ops].[sum:Profit &amp; Margin:qk]</rows>',
        ),
    ],
    [
      'columns shelf',
      (xml: string) =>
        xml.replace(
          '[usr:__tmcp_round_b157d4fa12a0_x:qk])</cols>',
          '[usr:__tmcp_round_b157d4fa12a0_path:qk])</cols>',
        ),
    ],
    ['path encoding', (xml: string) => xml.replace(/<path\b[^>]*\/>/, '')],
    [
      'authored tooltip',
      (xml: string) => xml.replace(/<customized-tooltip>[\s\S]*?<\/customized-tooltip>/, ''),
    ],
    [
      'full path range',
      (xml: string) => xml.replace(/<show-full-range>[\s\S]*?<\/show-full-range>/, ''),
    ],
    [
      'path column instance',
      (xml: string) =>
        xml.replace(
          "column='[__tmcp_round_b157d4fa12a0_path]' derivation='User' name='[usr:__tmcp_round_b157d4fa12a0_path:qk]'",
          "column='[__tmcp_round_b157d4fa12a0_path]' derivation='User' name='[usr:corrupted:qk]'",
        ),
    ],
  ])('refuses a helper-bearing sheet with a corrupted %s signature', (_label, mutate) => {
    expectRoundedSignatureRefusal(mutate as (xml: string) => string);
  });

  it('derives different helper names from different stable sheet ids', () => {
    const first = planRoundStackedBar(worksheet(), { preset: 'subtle' });
    const second = planRoundStackedBar(
      worksheet({ simpleId: '{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}' }),
      { preset: 'subtle' },
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.semanticContract.helperPrefix).not.toBe(second.semanticContract.helperPrefix);
  });

  it('accepts the exact live-shaped ordinary source and makes stack reversal explicit in formulas', () => {
    const liveShaped = worksheet().replace(
      `<datasource caption='Friendly &amp; &lt;Sales&gt;' name='${INTERNAL_DS}'>
          <connection class='federated'><named-connections>
            <named-connection caption='Friendly &amp; &lt;Sales&gt;' name='${CONNECTION_ID}' />
          </named-connections></connection>
        </datasource>`,
      `<datasource name='${INTERNAL_DS}' />`,
    );
    const result = planRoundStackedBar(liveShaped, { preset: 'subtle' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.xml).toContain("<mark class='Polygon' />");
    expect(result.xml).toMatch(
      /WINDOW_SUM\(\[__tmcp_round_b157d4fa12a0_pos\]\)-RUNNING_SUM\(\[__tmcp_round_b157d4fa12a0_pos\]\)\+\[__tmcp_round_b157d4fa12a0_pos\]/,
    );
  });

  it.each([
    ['malformed XML', '<worksheet><table>', /well-formed/i],
    ['missing stable sheet id', worksheet({ simpleId: '' }), /stable.*id/i],
    ['more than one datasource', worksheet({ datasourceCount: 2 }), /exactly one datasource/i],
    [
      'more than one dependency block',
      worksheet({ dependenciesCount: 2 }),
      /exactly one datasource-dependencies/i,
    ],
    ['non-Bar mark', worksheet({ mark: 'Automatic' }), /Bar mark/i],
    ['multiple panes', worksheet({ panes: 2 }), /exactly one pane/i],
    [
      'extra encoding',
      worksheet({
        colorEncoding: `<color column='[${INTERNAL_DS}].[none:Segment:nk]' /><size column='[${INTERNAL_DS}].[sum:Profit &amp; Margin:qk]' />`,
      }),
      /sole Color encoding/i,
    ],
    [
      'custom source tooltip',
      worksheet({
        sourceTooltip: `<tooltip column='[${INTERNAL_DS}].[sum:Profit &amp; Margin:qk]' />`,
      }),
      /custom label or tooltip/i,
    ],
    [
      'horizontal chart',
      worksheet({
        rows: `[${INTERNAL_DS}].[none:Category &amp; Group:nk]`,
        cols: `[${INTERNAL_DS}].[sum:Profit &amp; Margin:qk]`,
      }),
      /vertical/i,
    ],
    [
      'non-SUM measure',
      worksheet()
        .replace("derivation='Sum'", "derivation='Avg'")
        .replaceAll('sum:Profit', 'avg:Profit'),
      /SUM measure/i,
    ],
    [
      'source table calculation',
      worksheet({
        sourceTableCalc:
          "<column caption='Running' datatype='real' name='[Running]' role='measure' type='quantitative'><calculation class='tableau' formula='RUNNING_SUM(SUM([Profit &amp; Margin]))'><table-calc ordering-type='Rows' /></calculation></column>",
      }),
      /table calculation/i,
    ],
    [
      'calculated base measure',
      worksheet({
        sourceMeasureCalculation: "<calculation class='tableau' formula='[Profit &amp; Margin]' />",
      }),
      /calculated Category, Segment, or Value/i,
    ],
    [
      'extra column instance',
      worksheet({
        extraColumnInstances:
          "<column name='[Extra]' role='dimension' type='nominal' datatype='string'/><column-instance column='[Extra]' derivation='None' name='[none:Extra:nk]' pivot='key' type='nominal'/>",
      }),
      /extra field/i,
    ],
    [
      'manual segment order',
      worksheet({
        categorySort: `<sort class='manual' column='[${INTERNAL_DS}].[none:Segment:nk]'><dictionary><bucket>&quot;A&quot;</bucket></dictionary></sort>`,
      }),
      /manual.*order/i,
    ],
    [
      'computed sort on segment',
      worksheet({
        categorySort: `<computed-sort column='[${INTERNAL_DS}].[none:Segment:nk]' direction='ASC' using='[${INTERNAL_DS}].[sum:Profit &amp; Margin:qk]' />`,
      }),
      /category computed sort/i,
    ],
    [
      'fixed axis',
      worksheet({
        axis: "<style-rule element='axis'><format attr='fixed-start' value='0' /></style-rule>",
      }),
      /linear auto axis/i,
    ],
    [
      'log axis',
      worksheet({
        axis: "<style-rule element='axis'><format attr='type' value='logarithmic' /></style-rule>",
      }),
      /linear auto axis/i,
    ],
    [
      'fixed axis encoding',
      worksheet({
        axis: `<style-rule element='axis'><encoding attr='space' class='0' field='[${INTERNAL_DS}].[sum:Profit &amp; Margin:qk]' field-type='quantitative' range-type='fixed' scope='rows' type='space' /></style-rule>`,
      }),
      /axis encoding/i,
    ],
    [
      'pre-existing range expansion',
      worksheet({
        showFullRange:
          '<show-full-range><column>[federated.sales&amp;ops].[none:Existing:ok]</column></show-full-range>',
      }),
      /show-full-range/i,
    ],
    [
      'unfamiliar pane node',
      worksheet({
        extraPaneNode: "<mark-sizing mark-sizing-setting='marks-scaling-off' />",
      }),
      /mark-sizing.*pane/i,
    ],
  ])('refuses %s before emitting a plan', (_label, xml, reason) => {
    expectRefusal(xml, reason as RegExp);
  });

  it('refuses filter shapes outside one inclusive member plus a matching slice', () => {
    const twoMembers = westFilter(2);
    expectRefusal(
      worksheet({
        extraColumnInstances:
          "<column caption='Region' datatype='string' name='[Region]' role='dimension' type='nominal' /><column-instance column='[Region]' derivation='None' name='[none:Region:nk]' pivot='key' type='nominal' />",
        ...twoMembers,
      }),
      /exactly one member/i,
    );

    const oneMember = westFilter(1);
    expectRefusal(
      worksheet({
        extraColumnInstances:
          "<column caption='Region' datatype='string' name='[Region]' role='dimension' type='nominal' /><column-instance column='[Region]' derivation='None' name='[none:Region:nk]' pivot='key' type='nominal' />",
        filter: oneMember.filter,
        slices: '',
      }),
      /matching slice/i,
    );

    expectRefusal(
      worksheet({
        extraColumnInstances:
          "<column caption='Region' datatype='string' name='[Region]' role='dimension' type='nominal' /><column-instance column='[Region]' derivation='None' name='[none:Region:nk]' pivot='key' type='nominal' />",
        filter: oneMember.filter.replace(
          "user:ui-enumeration='inclusive'",
          "user:ui-enumeration='exclusive'",
        ),
        slices: oneMember.slices,
      }),
      /inclusive/i,
    );

    expectRefusal(
      worksheet({
        extraColumnInstances:
          "<column caption='Region' datatype='string' name='[Region]' role='dimension' type='nominal'><calculation class='tableau' formula='[Region]' /></column><column-instance column='[Region]' derivation='None' name='[none:Region:nk]' pivot='key' type='nominal' />",
        filter: oneMember.filter,
        slices: oneMember.slices,
      }),
      /plain source filter/i,
    );

    expectRefusal(
      worksheet({
        extraColumnInstances:
          "<column caption='Region' datatype='string' name='[Region]' role='dimension' type='nominal' /><column-instance column='[Region]' derivation='None' name='[none:Region:nk]' pivot='key' type='nominal' />",
        filter: oneMember.filter.replace("level='[none:Region:nk]'", "level='[none:Other:nk]'"),
        slices: oneMember.slices,
      }),
      /member level.*filter/i,
    );
  });

  it('refuses an unsupported preset at runtime', () => {
    const result = planRoundStackedBar(worksheet(), {
      preset: 'very-rounded' as 'subtle',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/subtle/i);
  });
});
