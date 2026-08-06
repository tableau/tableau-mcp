import { formatArtifactSummary, summarizeXmlArtifact } from './artifactSummary.js';

const WORKSHEET_XML = `<worksheet name="Sales by Region">
  <datasources><datasource caption="Superstore"/></datasources>
  <table><view>
    <mark class="Bar"/>
    <rows>[Superstore].[sum:Sales:qk]</rows>
    <cols>[Superstore].[none:Region:nk]</cols>
    <panes><pane><encodings><color column="[Superstore].[none:Category:nk]"/></encodings></pane></panes>
  </view></table>
</worksheet>`;

const DASHBOARD_XML = `<dashboard name="Exec Overview">
  <zones><zone name="Sales by Region"/><zone name="Profit Trend"/></zones>
</dashboard>`;

describe('summarizeXmlArtifact', () => {
  it('includes bytes and a stable sha256', () => {
    const a = summarizeXmlArtifact('worksheet', WORKSHEET_XML);
    const b = summarizeXmlArtifact('worksheet', WORKSHEET_XML);
    expect(a.find((l) => l.startsWith('bytes:'))).toBe(
      `bytes: ${Buffer.byteLength(WORKSHEET_XML, 'utf8')}`,
    );
    expect(a.find((l) => l.startsWith('sha256:'))).toMatch(/^sha256: [0-9a-f]{64}$/);
    expect(a).toEqual(b); // deterministic
  });

  it('summarizes worksheet shape (name, mark, rows/cols, encodings)', () => {
    const lines = summarizeXmlArtifact('worksheet', WORKSHEET_XML);
    expect(lines).toContain('worksheet: Sales by Region');
    expect(lines).toContain('mark: Bar');
    expect(lines).toContain('datasources: Superstore');
    expect(lines.find((l) => l.startsWith('rows:'))).toContain('sum:Sales');
    expect(lines).toContain('encodings: 1');
  });

  it('summarizes dashboard shape (name, zones, referenced worksheets)', () => {
    const lines = summarizeXmlArtifact('dashboard', DASHBOARD_XML);
    expect(lines).toContain('dashboard: Exec Overview');
    expect(lines).toContain('zones: 2');
    expect(lines.find((l) => l.startsWith('worksheets referenced:'))).toContain('Sales by Region');
  });

  it('formats a dash-prefixed block', () => {
    const block = formatArtifactSummary('dashboard', DASHBOARD_XML);
    expect(block.split('\n').every((l) => l.startsWith('- '))).toBe(true);
  });
});
