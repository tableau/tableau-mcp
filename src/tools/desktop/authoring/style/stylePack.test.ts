import { parseStylePack, TableauStylePackV2, tableauStylePackV2Schema } from './stylePack.js';

const validPack = {
  schema: 'tableau.style-pack/v2',
  pack: 'fixture-style-guide',
  version: '1.0.0',
  provenance: { title: 'Fixture', sourceSha256: 'a'.repeat(64) },
  typography: { titleFont: 'Tableau Semibold', bodyFont: 'Tableau Regular' },
  palette: {
    brandPrimary: '#7759C2',
    categorical: ['#7759C2', '#FC6D26'],
    sequential: ['#F1ECFF', '#7759C2'],
    diverging: { negative: '#D63939', midpoint: '#FFFFFF', positive: '#108548' },
    text: '#171321',
    background: '#FFFFFF',
  },
  formats: {
    currency: 'USD_ABBREVIATED',
    date: 'yyyy-mm-dd',
    time: 'HH:mm UTC',
    fiscalQuarter: 'Qn',
    fiscalYear: 'FYyy',
    fiscalYearQuarter: 'FYyy-Qn',
  },
  dashboard: { outerPadding: 16, innerSpacing: 12, titleAlignment: 'left' },
  advisoryRules: { avoidPieCharts: true, labelCalculatedData: true },
} as const;

describe('tableauStylePackV2Schema', () => {
  it('parses a valid v2 style pack', () => {
    const parsed: TableauStylePackV2 = parseStylePack(validPack);

    expect(parsed).toEqual(validPack);
    expect(tableauStylePackV2Schema.safeParse(validPack).success).toBe(true);
  });

  it.each([
    ['wrong schema', { ...validPack, schema: 'tableau.style-pack/v1' }],
    ['bad semantic version', { ...validPack, version: '1.0' }],
    [
      'bad source SHA-256',
      { ...validPack, provenance: { ...validPack.provenance, sourceSha256: 'not-a-sha' } },
    ],
    [
      'uppercase source SHA-256',
      { ...validPack, provenance: { ...validPack.provenance, sourceSha256: 'A'.repeat(64) } },
    ],
    [
      'unknown provenance key',
      { ...validPack, provenance: { ...validPack.provenance, extra: true } },
    ],
    ['empty title font', { ...validPack, typography: { ...validPack.typography, titleFont: '' } }],
    ['empty body font', { ...validPack, typography: { ...validPack.typography, bodyFont: '   ' } }],
    [
      'non-Tableau font',
      { ...validPack, typography: { ...validPack.typography, bodyFont: 'Helvetica' } },
    ],
    [
      'unknown typography key',
      { ...validPack, typography: { ...validPack.typography, extra: true } },
    ],
    [
      'malformed primary color',
      { ...validPack, palette: { ...validPack.palette, brandPrimary: '7759C2' } },
    ],
    [
      'malformed palette color',
      { ...validPack, palette: { ...validPack.palette, categorical: ['#7759C2', '#GGGGGG'] } },
    ],
    [
      'malformed diverging color',
      {
        ...validPack,
        palette: {
          ...validPack.palette,
          diverging: { ...validPack.palette.diverging, midpoint: '#FFFF' },
        },
      },
    ],
    [
      'malformed text color',
      { ...validPack, palette: { ...validPack.palette, text: '#17132100' } },
    ],
    [
      'malformed background color',
      { ...validPack, palette: { ...validPack.palette, background: 'white' } },
    ],
    ['unknown palette key', { ...validPack, palette: { ...validPack.palette, extra: true } }],
    [
      'unknown diverging-palette key',
      {
        ...validPack,
        palette: {
          ...validPack.palette,
          diverging: { ...validPack.palette.diverging, extra: true },
        },
      },
    ],
    [
      'too-short categorical palette',
      { ...validPack, palette: { ...validPack.palette, categorical: ['#7759C2'] } },
    ],
    [
      'too-short sequential palette',
      { ...validPack, palette: { ...validPack.palette, sequential: ['#7759C2'] } },
    ],
    [
      'unknown currency constant',
      { ...validPack, formats: { ...validPack.formats, currency: 'USD' } },
    ],
    ['unknown date constant', { ...validPack, formats: { ...validPack.formats, date: 'MM/DD' } }],
    ['unknown time constant', { ...validPack, formats: { ...validPack.formats, time: 'HH:mm' } }],
    [
      'unknown fiscal-quarter constant',
      { ...validPack, formats: { ...validPack.formats, fiscalQuarter: 'QQ' } },
    ],
    [
      'unknown fiscal-year constant',
      { ...validPack, formats: { ...validPack.formats, fiscalYear: 'YYYY' } },
    ],
    [
      'unknown fiscal-year-quarter constant',
      { ...validPack, formats: { ...validPack.formats, fiscalYearQuarter: 'Qn-FYyy' } },
    ],
    ['unknown formats key', { ...validPack, formats: { ...validPack.formats, extra: true } }],
    [
      'negative outer padding',
      { ...validPack, dashboard: { ...validPack.dashboard, outerPadding: -1 } },
    ],
    [
      'fractional inner spacing',
      { ...validPack, dashboard: { ...validPack.dashboard, innerSpacing: 1.5 } },
    ],
    [
      'fractional outer padding',
      { ...validPack, dashboard: { ...validPack.dashboard, outerPadding: 1.5 } },
    ],
    [
      'negative inner spacing',
      { ...validPack, dashboard: { ...validPack.dashboard, innerSpacing: -1 } },
    ],
    [
      'unknown title alignment',
      { ...validPack, dashboard: { ...validPack.dashboard, titleAlignment: 'top' } },
    ],
    ['unknown dashboard key', { ...validPack, dashboard: { ...validPack.dashboard, extra: true } }],
    ['unknown top-level key', { ...validPack, extra: true }],
    [
      'unknown nested key',
      { ...validPack, advisoryRules: { ...validPack.advisoryRules, extra: true } },
    ],
  ])('rejects %s', (_name, input) => {
    expect(tableauStylePackV2Schema.safeParse(input).success).toBe(false);
    expect(() => parseStylePack(input)).toThrow();
  });

  it('makes parseStylePack fail loudly for an invalid pack', () => {
    expect(() => parseStylePack({ ...validPack, schema: 'tableau.style-pack/v1' })).toThrow();
  });
});
