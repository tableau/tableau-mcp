import { searchWorkbookFields } from './searchWorkbookFields.js';

const WORKBOOK_XML = `
<workbook>
  <datasources>
    <datasource name="Alpha">
      <column name="[Profit Amount]" caption="Gross Profit" role="measure" type="quantitative" datatype="real" />
      <column name="[Margin Calc]" caption="Margin" role="measure" type="quantitative" datatype="real">
        <calculation class="tableau" formula="SUM([Revenue]) / SUM([Sales])" />
      </column>
      <column name="[Dependency Only]" caption="Declared Field" role="dimension" type="nominal" datatype="string" />
      <folders-common>
        <folder name="KPI Metrics">
          <folder-item type="field" name="[Margin Calc]" />
        </folder>
      </folders-common>
    </datasource>
    <datasource name="Beta">
      <column name="[Net Income]" caption="Gross Profit" role="measure" type="quantitative" datatype="integer" />
    </datasource>
  </datasources>
  <worksheets>
    <worksheet name="Overview">
      <table>
        <view>
          <datasource-dependencies datasource="Alpha">
            <column-instance name="[none:Dependency Only:nk]" column="[Dependency Only]" />
          </datasource-dependencies>
        </view>
        <rows>[Alpha].[sum:Profit Amount:qk]</rows>
        <cols>[Beta].[sum:Net Income:qk]</cols>
        <panes>
          <pane>
            <encodings>
              <color column="[Alpha].[sum:Profit Amount:qk]" />
              <tooltip column="[Beta].[sum:Net Income:qk]" />
            </encodings>
          </pane>
        </panes>
      </table>
    </worksheet>
    <worksheet name="Detail">
      <table>
        <rows>[Alpha].[usr:Margin Calc:qk]</rows>
        <cols>[Alpha].[sum:Profit Amount:qk]</cols>
        <panes>
          <pane>
            <encodings>
              <size column="[Beta].[sum:Net Income:qk]" />
            </encodings>
          </pane>
        </panes>
      </table>
    </worksheet>
  </worksheets>
</workbook>`;

const ALPHA_PROFIT = {
  datasource: 'Alpha',
  caption: 'Gross Profit',
  localName: 'Profit Amount',
  columnRef: '[Alpha].[sum:Profit Amount:qk]',
  role: 'measure',
  datatype: 'real',
  matchedOn: ['caption'] as const,
  placements: [
    { worksheet: 'Detail', location: 'columns' as const },
    { worksheet: 'Overview', location: 'encoding' as const, encoding: 'color' },
    { worksheet: 'Overview', location: 'rows' as const },
  ],
};

const PLACEMENT_VARIANTS_XML = `
<workbook>
  <datasources>
    <datasource name="DS One">
      <column name="[Sales]" caption="Sales One" role="measure" type="quantitative" datatype="real" />
      <column name="[Order Date]" role="dimension" type="quantitative" datatype="date" />
      <column name="[Calc]" role="measure" type="quantitative" datatype="real">
        <calculation class="tableau" formula="SUM([Amount])" />
      </column>
      <column name="[Region Group]" role="dimension" type="nominal" datatype="string">
        <calculation class="categorical-bin" column="[Region]" />
      </column>
      <column name="[Sales Bin]" caption="Z Sales Bin" role="dimension" type="quantitative" datatype="real">
        <calculation class="categorical-bin" column="[Sales]" />
      </column>
      <column name="[Revenue]" role="measure" type="quantitative" datatype="real" />
      <column name="[Revenue Total]" role="measure" type="quantitative" datatype="real" />
    </datasource>
    <datasource name="DS Two">
      <column name="[Sales]" caption="Sales Two" role="measure" type="quantitative" datatype="real" />
    </datasource>
  </datasources>
  <worksheets>
    <worksheet name="Variants">
      <table>
        <rows>[DS One].[avg:Sales:qk] / [DS One].[sum:Revenue Total:qk] / [DS Two].[sum:Sales:qk] / not-a-pill-[DS One].[sum:Revenue:qk]</rows>
        <cols>[DS One].[none:Order Date:ok] / [DS One].[mn:Order Date:qk]</cols>
        <panes>
          <pane>
            <encodings>
              <color column="[DS One].[sum:Sales:qk]" />
              <text column="[DS One].[usr:Calc:qk]" />
              <detail column="[DS One].[none:Region Group:nk]" />
              <size column="[DS One].[bin:Sales Bin:qk]" />
              <tooltip column="[DS One].[sum:Revenue:qk]-not-a-pill" />
            </encodings>
          </pane>
        </panes>
      </table>
    </worksheet>
  </worksheets>
</workbook>`;

describe('searchWorkbookFields', () => {
  it('keeps duplicate captions distinct by datasource and reports explicit placements', () => {
    expect(searchWorkbookFields(WORKBOOK_XML, '  GROSS PROFIT  ')).toEqual({
      query: 'GROSS PROFIT',
      totalMatches: 2,
      truncated: false,
      matches: [
        ALPHA_PROFIT,
        {
          datasource: 'Beta',
          caption: 'Gross Profit',
          localName: 'Net Income',
          columnRef: '[Beta].[sum:Net Income:qk]',
          role: 'measure',
          datatype: 'integer',
          matchedOn: ['caption'],
          placements: [
            { worksheet: 'Detail', location: 'encoding', encoding: 'size' },
            { worksheet: 'Overview', location: 'columns' },
            { worksheet: 'Overview', location: 'encoding', encoding: 'tooltip' },
          ],
        },
      ],
      usageScope: 'worksheet shelves and mark encodings only',
    });
  });

  it.each([
    ['net income', ['localName']],
    ['beta', ['datasource']],
    ['kpi', ['folder']],
    ['revenue', ['formula']],
  ] as const)('finds a field by %s', (query, matchedOn) => {
    const result = searchWorkbookFields(WORKBOOK_XML, query);

    expect(result.totalMatches).toBe(1);
    expect(result.matches[0].matchedOn).toEqual(matchedOn);
  });

  it('does not treat datasource dependency declarations as placements', () => {
    expect(searchWorkbookFields(WORKBOOK_XML, 'declared field').matches).toEqual([
      {
        datasource: 'Alpha',
        caption: 'Declared Field',
        localName: 'Dependency Only',
        columnRef: '[Alpha].[none:Dependency Only:nk]',
        role: 'dimension',
        datatype: 'string',
        matchedOn: ['caption'],
        placements: [],
      },
    ]);
  });

  it('sorts before applying the limit and preserves truncation metadata', () => {
    expect(searchWorkbookFields(WORKBOOK_XML, 'gross profit', 1)).toEqual({
      query: 'gross profit',
      totalMatches: 2,
      truncated: true,
      matches: [ALPHA_PROFIT],
      usageScope: 'worksheet shelves and mark encodings only',
    });
  });

  it('maps AVG and SUM instances to the same field while keeping duplicate local names datasource-scoped', () => {
    expect(searchWorkbookFields(PLACEMENT_VARIANTS_XML, 'sales').matches).toEqual([
      {
        datasource: 'DS One',
        caption: 'Sales One',
        localName: 'Sales',
        columnRef: '[DS One].[sum:Sales:qk]',
        role: 'measure',
        datatype: 'real',
        matchedOn: ['caption', 'localName'],
        placements: [
          { worksheet: 'Variants', location: 'encoding', encoding: 'color' },
          { worksheet: 'Variants', location: 'rows' },
        ],
      },
      {
        datasource: 'DS One',
        caption: 'Z Sales Bin',
        localName: 'Sales Bin',
        columnRef: '[DS One].[none:Sales Bin:qk]',
        role: 'dimension',
        datatype: 'real',
        matchedOn: ['caption', 'localName'],
        placements: [{ worksheet: 'Variants', location: 'encoding', encoding: 'size' }],
      },
      {
        datasource: 'DS Two',
        caption: 'Sales Two',
        localName: 'Sales',
        columnRef: '[DS Two].[sum:Sales:qk]',
        role: 'measure',
        datatype: 'real',
        matchedOn: ['caption', 'localName'],
        placements: [{ worksheet: 'Variants', location: 'rows' }],
      },
    ]);
  });

  it('maps discrete and continuous instances to one field placement', () => {
    expect(
      searchWorkbookFields(PLACEMENT_VARIANTS_XML, 'order date').matches[0].placements,
    ).toEqual([{ worksheet: 'Variants', location: 'columns' }]);
  });

  it.each([
    ['calc', 'text'],
    ['region group', 'detail'],
    ['sales bin', 'size'],
  ] as const)('maps the %s instance independent of its derivation', (query, encoding) => {
    expect(searchWorkbookFields(PLACEMENT_VARIANTS_XML, query).matches[0].placements).toEqual([
      { worksheet: 'Variants', location: 'encoding', encoding },
    ]);
  });

  it('uses complete pill boundaries instead of substring matches on near-colliding shelf text', () => {
    expect(searchWorkbookFields(PLACEMENT_VARIANTS_XML, 'revenue').matches).toEqual([
      {
        datasource: 'DS One',
        caption: 'Revenue',
        localName: 'Revenue',
        columnRef: '[DS One].[sum:Revenue:qk]',
        role: 'measure',
        datatype: 'real',
        matchedOn: ['localName'],
        placements: [],
      },
      {
        datasource: 'DS One',
        caption: 'Revenue Total',
        localName: 'Revenue Total',
        columnRef: '[DS One].[sum:Revenue Total:qk]',
        role: 'measure',
        datatype: 'real',
        matchedOn: ['localName'],
        placements: [{ worksheet: 'Variants', location: 'rows' }],
      },
    ]);
  });
});
