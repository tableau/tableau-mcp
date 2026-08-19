import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { buildSync } from 'esbuild';

import { parseCustomThemeJson } from './customTheme.js';

const sparseTheme = {
  version: '1.0.0',
  'base-theme': 'default',
  styles: {},
};

const fullTheme = {
  $schema: './CustomThemesSchema_1.0.0.json',
  version: '1.0.0',
  'base-theme': 'smooth',
  styles: {
    all: { 'font-color': '#112233', 'font-family': 'Tableau 日本語' },
    worksheet: { 'font-color': '#223344', 'font-family': 'Tableau', 'font-size': 12 },
    'worksheet-title': {
      'font-color': '#334455',
      'font-family': 'Tableau',
      'font-size': 13,
    },
    tooltip: { 'font-color': '#445566', 'font-family': 'Tableau', 'font-size': 14 },
    'dashboard-title': {
      'font-color': '#556677',
      'font-family': 'Tableau',
      'font-size': 15,
      'font-weight': 'bold',
    },
    'story-title': { 'font-color': '#667788', 'font-family': 'Tableau', 'font-size': 16 },
    header: { 'font-color': '#778899', 'font-family': 'Tableau' },
    legend: {
      'font-color': '#8899AA',
      'font-family': 'Tableau',
      'font-size': 17,
      'background-color': '#00112233',
    },
    'legend-title': { 'font-color': '#99AABB', 'font-family': 'Tableau', 'font-size': 18 },
    filter: {
      'font-color': '#AABBCC',
      'font-family': 'Tableau',
      'font-size': 19,
      'background-color': '#FFFFFF',
    },
    'filter-title': { 'font-color': '#BBCCDD', 'font-family': 'Tableau', 'font-size': 20 },
    'parameter-ctrl': {
      'font-color': '#CCDDEE',
      'font-family': 'Tableau',
      'font-size': 21,
      'background-color': '#10203040',
    },
    'parameter-ctrl-title': {
      'font-color': '#DDEEFF',
      'font-family': 'Tableau',
      'font-size': 22,
    },
    highlighter: {
      'font-color': '#123456',
      'font-family': 'Tableau',
      'font-size': 23,
      'background-color': '#ABCDEF',
    },
    'highlighter-title': {
      'font-color': '#234567',
      'font-family': 'Tableau',
      'font-size': 24,
    },
    'page-ctrl-title': { 'font-color': '#345678', 'font-family': 'Tableau' },
    view: { 'background-color': '#456789' },
    gridline: {
      'line-visibility': 'on',
      'line-pattern': 'dotted',
      'line-width': 1,
      'line-color': '#56789A',
    },
    zeroline: {
      'line-visibility': 'off',
      'line-pattern': 'solid',
      'line-width': 5,
      'line-color': '#6789ABCD',
    },
    mark: { 'mark-color': '#789ABC' },
  },
};

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function parseWithSourceDigest(themeJson: string): ReturnType<typeof parseCustomThemeJson> {
  return parseCustomThemeJson(themeJson, sha256(themeJson));
}

function themeJsonWithStyles(styles: Record<string, unknown>): string {
  return JSON.stringify({ ...sparseTheme, styles });
}

function thrownMessage(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Expected the call to throw');
}

describe('parseCustomThemeJson', () => {
  it('starts when bundled with the production Node bundle settings', () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), 'tableau-custom-theme-bundle-'));
    const outputFile = join(outputDirectory, 'custom-theme.cjs');

    try {
      buildSync({
        entryPoints: [resolve(process.cwd(), 'src/tools/desktop/authoring/style/customTheme.ts')],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        minify: true,
        packages: 'bundle',
        outfile: outputFile,
      });

      expect(() => execFileSync(process.execPath, [outputFile], { stdio: 'pipe' })).not.toThrow();
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  });

  it.each([
    ['sparse', sparseTheme],
    ['full', fullTheme],
  ])('accepts a %s official Custom Theme', (_case, theme) => {
    const themeJson = JSON.stringify(theme);
    const expectedSha256 = sha256(themeJson);

    const parsed = parseCustomThemeJson(themeJson, expectedSha256);

    expect(parsed.value).toEqual(theme);
    expect(parsed.themeJson).toBe(themeJson);
    expect(parsed.sha256).toBe(expectedSha256);
    expect(parsed.commandFileName).toBe(`studio-theme-${expectedSha256.slice(0, 12)}`);
  });

  it.each(['default', 'classic', 'modern', 'clean', 'smooth'])(
    'accepts the %s base theme',
    (baseTheme) => {
      const themeJson = JSON.stringify({ ...sparseTheme, 'base-theme': baseTheme });

      expect(parseWithSourceDigest(themeJson).value['base-theme']).toBe(baseTheme);
    },
  );

  it.each([
    [
      'literal and escaped Unicode',
      '{"version":"1.0.0","base-theme":"default","styles":{"worksheet":{"font-family":"Tableau 日本語"}}}',
      '{"version":"1.0.0","base-theme":"default","styles":{"worksheet":{"font-family":"Tableau \\u65e5\\u672c\\u8a9e"}}}',
    ],
    [
      'integer spellings',
      '{"version":"1.0.0","base-theme":"default","styles":{"worksheet":{"font-size":12}}}',
      '{"version":"1.0.0","base-theme":"default","styles":{"worksheet":{"font-size":12.0}}}',
    ],
    [
      'integer exponent spelling',
      '{"version":"1.0.0","base-theme":"default","styles":{"worksheet":{"font-size":12}}}',
      '{"version":"1.0.0","base-theme":"default","styles":{"worksheet":{"font-size":12e0}}}',
    ],
  ])('hashes exact source bytes for %s', (_case, leftJson, rightJson) => {
    const leftParsed = parseWithSourceDigest(leftJson);
    const rightParsed = parseWithSourceDigest(rightJson);

    expect(leftParsed.value).toEqual(rightParsed.value);
    expect(leftParsed.sha256).not.toBe(rightParsed.sha256);
    expect(leftParsed.themeJson).toBe(leftJson);
    expect(rightParsed.themeJson).toBe(rightJson);
  });

  it('hashes whitespace and key-order differences without canonicalization', () => {
    const compact = '{"version":"1.0.0","base-theme":"default","styles":{}}';
    const reordered = '{\n  "styles": {},\n  "base-theme": "default",\n  "version": "1.0.0"\n}';

    const compactParsed = parseWithSourceDigest(compact);
    const reorderedParsed = parseWithSourceDigest(reordered);

    expect(compactParsed.value).toEqual(reorderedParsed.value);
    expect(compactParsed.sha256).not.toBe(reorderedParsed.sha256);
  });

  it.each([
    ['invalid JSON', '{'],
    ['a comment', '{"version":"1.0.0",/* no */"base-theme":"default","styles":{}}'],
    ['a trailing comma', '{"version":"1.0.0","base-theme":"default","styles":{},}'],
    ['trailing content', `${JSON.stringify(sparseTheme)}\ntrue`],
    ['a byte-order mark', `\uFEFF${JSON.stringify(sparseTheme)}`],
  ])('rejects %s as a strict whole-file JSON error', (_case, themeJson) => {
    const message = thrownMessage(() => parseWithSourceDigest(themeJson));

    expect(message).toMatch(/Custom Theme JSON/i);
    expect(message).not.toContain('studio-theme-');
    expect(message).not.toContain(themeJson);
  });

  it.each([
    ['an array', '[]'],
    ['null', 'null'],
    ['a string', '"theme"'],
  ])('rejects %s because the root must be an object', (_case, themeJson) => {
    expect(() => parseWithSourceDigest(themeJson)).toThrow(/root.*object/i);
  });

  it.each([
    ['root', '{"version":"1.0.0","version":"1.0.0","base-theme":"default","styles":{}}'],
    [
      'nested',
      '{"version":"1.0.0","base-theme":"default","styles":{"worksheet":{"font-size":12,"font-size":13}}}',
    ],
  ])('rejects a duplicate property at the %s level', (_case, themeJson) => {
    const message = thrownMessage(() => parseWithSourceDigest(themeJson));

    expect(message).toBe('Custom Theme JSON contains a duplicate property');
    expect(message).not.toContain('studio-theme-');
  });

  it.each(['version', 'base-theme', 'styles'])('rejects a missing required %s key', (key) => {
    const theme = { ...sparseTheme } as Record<string, unknown>;
    delete theme[key];

    expect(() => parseWithSourceDigest(JSON.stringify(theme))).toThrow(
      'Custom Theme schema validation failed (required)',
    );
  });

  it.each([
    ['root', { ...sparseTheme, secret: 'SENSITIVE_VALUE' }],
    ['styles', { ...sparseTheme, styles: { unknown: { value: 'SENSITIVE_VALUE' } } }],
    ['nested setting', { ...sparseTheme, styles: { worksheet: { unknown: 'SENSITIVE_VALUE' } } }],
  ])('rejects an unknown %s key without echoing values', (_case, theme) => {
    const message = thrownMessage(() => parseWithSourceDigest(JSON.stringify(theme)));

    expect(message).toBe('Custom Theme schema validation failed (additionalProperties)');
    expect(message).not.toContain('SENSITIVE_VALUE');
  });

  it.each([
    ['version', { ...sparseTheme, version: '1.0.1' }],
    ['base theme', { ...sparseTheme, 'base-theme': 'future' }],
    ['$schema URI reference', { ...sparseTheme, $schema: 'not a uri ref |' }],
  ])('rejects the wrong %s', (_case, theme) => {
    expect(() => parseWithSourceDigest(JSON.stringify(theme))).toThrow(/schema validation failed/i);
  });

  it.each([1, 99])('accepts font-size boundary %i', (fontSize) => {
    const themeJson = themeJsonWithStyles({ worksheet: { 'font-size': fontSize } });
    expect(parseWithSourceDigest(themeJson).value.styles).toEqual({
      worksheet: { 'font-size': fontSize },
    });
  });

  it.each([0, 100, 1.5])('rejects invalid font-size %s', (fontSize) => {
    const themeJson = themeJsonWithStyles({ worksheet: { 'font-size': fontSize } });
    expect(() => parseWithSourceDigest(themeJson)).toThrow(/schema validation failed/i);
  });

  it.each([1, 5])('accepts line-width boundary %i', (lineWidth) => {
    const themeJson = themeJsonWithStyles({ gridline: { 'line-width': lineWidth } });
    expect(parseWithSourceDigest(themeJson).value.styles).toEqual({
      gridline: { 'line-width': lineWidth },
    });
  });

  it.each([0, 6, 1.5])('rejects invalid line-width %s', (lineWidth) => {
    const themeJson = themeJsonWithStyles({ gridline: { 'line-width': lineWidth } });
    expect(() => parseWithSourceDigest(themeJson)).toThrow(/schema validation failed/i);
  });

  it.each([
    ['font color', { all: { 'font-color': '#12345' } }],
    ['font family', { all: { 'font-family': '' } }],
    ['long font family', { all: { 'font-family': 'x'.repeat(51) } }],
    ['font weight enum', { 'dashboard-title': { 'font-weight': 'semibold' } }],
    ['background color', { view: { 'background-color': '#1234' } }],
    ['line visibility enum', { gridline: { 'line-visibility': 'auto' } }],
    ['line pattern enum', { gridline: { 'line-pattern': 'dash' } }],
    ['line color', { gridline: { 'line-color': 'red' } }],
    ['mark color', { mark: { 'mark-color': '#123' } }],
  ])('rejects an invalid %s without echoing values', (_case, styles) => {
    const themeJson = themeJsonWithStyles(styles);
    const message = thrownMessage(() => parseWithSourceDigest(themeJson));

    expect(message).toMatch(/schema validation failed/i);
    expect(message).not.toContain(JSON.stringify(styles));
  });

  it.each([
    ['wrong digest', '0'.repeat(64)],
    ['uppercase digest', sha256(JSON.stringify(sparseTheme)).toUpperCase()],
    ['short digest', '0'.repeat(63)],
  ])('rejects a correct theme paired with a %s before naming the command', (_case, digest) => {
    const message = thrownMessage(() => parseCustomThemeJson(JSON.stringify(sparseTheme), digest));

    expect(message).toMatch(/SHA-256/i);
    expect(message).not.toContain('studio-theme-');
  });

  it.each([
    ['array', `${'['.repeat(3_000)}0${']'.repeat(3_000)}`],
    ['object', `${'{"nested":'.repeat(3_000)}0${'}'.repeat(3_000)}`],
  ])('rejects a 3,000-level nested %s before recursive parsing', (_case, nestedValue) => {
    const themeJson = `{"version":"1.0.0","base-theme":"default","styles":${nestedValue}}`;

    const message = thrownMessage(() => parseWithSourceDigest(themeJson));

    expect(message).toBe('Custom Theme JSON exceeds maximum nesting depth of 64');
    expect(message).not.toMatch(/RangeError|call stack/i);
    expect(message.length).toBeLessThanOrEqual(80);
  });

  it('does not count structural characters inside strings toward nesting depth', () => {
    const fontFamily = '[{]} "\\ [{]}';
    const themeJson = themeJsonWithStyles({ worksheet: { 'font-family': fontFamily } });

    expect(parseWithSourceDigest(themeJson).value.styles).toEqual({
      worksheet: { 'font-family': fontFamily },
    });
  });

  it('rejects __proto__ as an own additional property without mutating prototypes', () => {
    const themeJson =
      '{"version":"1.0.0","base-theme":"default","styles":{"worksheet":{"__proto__":{"font-size":12}}}}';
    const objectPrototypeKeys = Reflect.ownKeys(Object.prototype);

    const message = thrownMessage(() => parseWithSourceDigest(themeJson));

    expect(message).toBe('Custom Theme schema validation failed (additionalProperties)');
    expect(Reflect.ownKeys(Object.prototype)).toEqual(objectPrototypeKeys);
    expect(Object.prototype).not.toHaveProperty('font-size');
  });

  it('does not echo an unknown sensitive key or value in schema errors', () => {
    const sensitiveKey = 'SENSITIVE_SENTINEL_UNKNOWN_KEY';
    const sensitiveValue = 'SENSITIVE_SENTINEL_UNKNOWN_VALUE';
    const themeJson = JSON.stringify({ ...sparseTheme, [sensitiveKey]: sensitiveValue });

    const message = thrownMessage(() => parseWithSourceDigest(themeJson));

    expect(message).toBe('Custom Theme schema validation failed (additionalProperties)');
    expect(message).not.toContain(sensitiveKey);
    expect(message).not.toContain(sensitiveValue);
  });

  it('does not echo a duplicate sensitive key or either value', () => {
    const sensitiveKey = 'SENSITIVE_SENTINEL_DUPLICATE_KEY';
    const firstValue = 'SENSITIVE_SENTINEL_FIRST_VALUE';
    const secondValue = 'SENSITIVE_SENTINEL_SECOND_VALUE';
    const themeJson = `{"version":"1.0.0","base-theme":"default","styles":{"worksheet":{"${sensitiveKey}":"${firstValue}","${sensitiveKey}":"${secondValue}"}}}`;

    const message = thrownMessage(() => parseWithSourceDigest(themeJson));

    expect(message).toBe('Custom Theme JSON contains a duplicate property');
    expect(message).not.toContain(sensitiveKey);
    expect(message).not.toContain(firstValue);
    expect(message).not.toContain(secondValue);
  });
});
