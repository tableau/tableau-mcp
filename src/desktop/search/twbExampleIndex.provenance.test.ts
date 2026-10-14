import { readFileSync } from 'fs';
import { gunzipSync } from 'zlib';

import { DEFAULT_IN, DEFAULT_OUT } from '../../scripts/trimTwbExampleIndex.js';

// Guards the shipped TWB example index and its gzipped source twin (see
// src/scripts/trimTwbExampleIndex.ts) against leaking internal source-tree paths:
// an entry is identified by an ordinal id, never by where its workbook lived.
type RawEntry = Record<string, unknown>;

const FILES: Array<[string, RawEntry[]]> = [
  ['twb-example-index.json', JSON.parse(readFileSync(DEFAULT_OUT, 'utf8')) as RawEntry[]],
  [
    'twb-example-index.source.json.gz',
    JSON.parse(gunzipSync(readFileSync(DEFAULT_IN)).toString('utf8')) as RawEntry[],
  ],
];

const WORKBOOK_PATH = /[\\/][^\\/'"<>\r\n]+\.twbx?\b/i;
const WORKBOOK_FILE = /\.twbx?\b/i;
const WORKBOOK_FILE_MENTIONS = /\.twbx?\b/gi;

// Some snippet XML still names a test datasource after its workbook file (e.g.
// `[Oracle_11g_live.twb]`); snippet text is kept verbatim, so cap today's `.twb`
// mention counts and fail on new ones.
const MAX_WORKBOOK_FILE_MENTIONS: Record<string, number> = {
  'twb-example-index.json': 3,
  'twb-example-index.source.json.gz': 29,
};

/** Every object key and string value under `value`, with a readable location. */
function* strings(value: unknown, where: string): Generator<[string, string]> {
  if (typeof value === 'string') {
    yield [where, value];
  } else if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) yield* strings(item, `${where}[${i}]`);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      yield [`${where} key`, key];
      yield* strings(item, `${where}.${key}`);
    }
  }
}

describe.each(FILES)('%s carries no internal source paths', (file, entries) => {
  it('has entries with exactly the keys features, id, name, snippets', () => {
    expect(entries.length).toBeGreaterThan(0);
    const offenders = entries
      .map((e, i) => [i, Object.keys(e).sort().join(',')] as const)
      .filter(([, keys]) => keys !== 'features,id,name,snippets')
      .map(([i, keys]) => `#${i}: ${keys}`);
    expect(offenders).toEqual([]);
  });

  it('has unique ids shaped twb-NNNN', () => {
    const ids = entries.map((e) => e.id);
    expect(ids.filter((id) => typeof id !== 'string' || !/^twb-\d{4}$/.test(id))).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has no string anywhere in an entry that names a workbook file path', () => {
    const offenders: string[] = [];
    for (const e of entries) {
      for (const [where, s] of strings(e, String(e.id))) {
        if (WORKBOOK_PATH.test(s)) offenders.push(where);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('has no file name or path in any name or id', () => {
    const offenders = entries
      .flatMap((e) => [String(e.name), String(e.id)])
      .filter((s) => WORKBOOK_FILE.test(s) || /[\\/]/.test(s));
    expect(offenders).toEqual([]);
  });

  it('mentions no more workbook files in snippet xml than today', () => {
    let count = 0;
    for (const e of entries) {
      for (const snippet of Object.values(e.snippets as Record<string, { xml?: string }>)) {
        count += (snippet.xml ?? '').match(WORKBOOK_FILE_MENTIONS)?.length ?? 0;
      }
    }
    expect(count).toBeLessThanOrEqual(MAX_WORKBOOK_FILE_MENTIONS[file]);
  });
});
