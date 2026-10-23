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

// Nor may they ship string data copied from those workbooks (people, record ids,
// internal hosts): every quoted member value is a per-entry `Value N` placeholder or
// a scalar that copies nothing. Snippet text is often not well-formed XML (raw quotes,
// truncation), so the check reads raw text one attribute or text node at a time.
const PLACEHOLDER = /^Value \d+$/;
const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;
const SCALARS = [
  /^$/,
  PLACEHOLDER,
  NUMBER,
  /^#[^#]+#$/,
  /^%(?:null|all|ragged)%$/,
  /^(?:true|false)$/,
  /^https?:\/\/example\.com(?:[/:?#]|$)/,
];
const FIELD_REF = /^\[[^[\]]+\](?::\d+)?$/;
// `[a].[b]` is a field ref only for parameters or a derived field; otherwise `b` is a member.
const TWO_SEGMENT = /^\[([^[\]]+)\]\.\[([^[\]]+)\](?::\d+)?$/;
const DERIVED_FIELD = /^(?:[A-Za-z]+:)+.+:[a-z]{2}(?::\d+)?$|^:[\w ]+$/;
const PATH_SEGMENT = /(^|\.&|\.|&)\[((?:[^[\]]|\]\])*)\]/y;
const SCHEMA_ATTR = /\b(?:level|column|field)=""?([^"]*)"/g;
const BRACKETED = /\[((?:[^[\]]|\]\])*)\]/g;
const DOUBLED_QUOTE_ATTR =
  /([\w:.-]+)=""(?!\s|\/?>)((?:(?!""(?:\s|\/?>|<|$)).)*?)""(?=\s|\/?>|<|$)/gs;
const ENTITY_QUOTED = /="&quot;((?:(?!&quot;").)*)&quot;"|>&quot;((?:(?!&quot;<).)*)&quot;</gs;
const QUOTED_TEXT = />"([^<]*)"</g;
const BUCKET_TEXT = /<(bucket|value)>([^<]*)<\/\1>/g;
const TUPLE_TEXT = />\(([^<>()]*)\)</g;
const TUPLE_PART = /"((?:\\.|[^"\\])*)"/g;
const BARE_ALIAS =
  /<(?:alias(?:\s[^<>]*)?\svalue|(?:member|column)(?:\s[^<>]*)?\salias)="([^"]*)"/g;
const SALESFORCE_ID =
  /\b(?=[0-9A-Za-z]{15}(?:[0-9A-Za-z]{3})?\b)(?=[0-9A-Za-z]*[A-Za-z])0[0-9A-Za-z]{14}(?:[0-9A-Za-z]{3})?\b/g;
const NON_EXAMPLE_URL = /https?:\/\/(?!example\.com\b)[^\s"<]*/gi;

function isFieldRefPair(value: string): boolean {
  const m = TWO_SEGMENT.exec(value);
  return (
    !!m && (m[1] === 'Parameters' || [DERIVED_FIELD, PLACEHOLDER, NUMBER].some((r) => r.test(m[2])))
  );
}

/**
 * A cube member path (3+ segments) whose segments after the first two are scrubbed, or name
 * schema: a segment of a level/column/field attribute in the same text, or a `.`-named level
 * right before a `.&[key]`.
 */
function isScrubbedMemberPath(value: string, schema: Set<string>): boolean {
  const segments: Array<[string, string]> = [];
  PATH_SEGMENT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while (PATH_SEGMENT.lastIndex < value.length && (m = PATH_SEGMENT.exec(value))) {
    segments.push([m[1], m[2]]);
  }
  if (PATH_SEGMENT.lastIndex !== value.length || segments.length < 3) return false;
  if (
    segments[1][1] === '__tableau_internal_object_id__' &&
    segments.length === 3 &&
    DERIVED_FIELD.test(segments[2][1])
  ) {
    return true;
  }
  return segments
    .slice(2)
    .every(
      ([sep, s], i) =>
        PLACEHOLDER.test(s) ||
        NUMBER.test(s) ||
        schema.has(s) ||
        (sep === '.' && segments[i + 3]?.[0] === '.&'),
    );
}

function isScrubbedLiteral(raw: string, schema: Set<string>): boolean {
  let value = raw.replace(/\\(.)/gs, '$1').replace(/""/g, '"');
  if (/^".*"$/s.test(value)) value = value.slice(1, -1);
  return (
    SCALARS.some((r) => r.test(value)) ||
    FIELD_REF.test(value) ||
    isFieldRefPair(value) ||
    isScrubbedMemberPath(value, schema)
  );
}

/** Every copied data value, Salesforce record id, or non-example URL left in `text`. */
function copiedValues(text: string): string[] {
  const schema = new Set(
    [...text.matchAll(SCHEMA_ATTR)].flatMap(([, v]) =>
      [...v.matchAll(BRACKETED)].map(([, s]) => s),
    ),
  );
  const found: string[] = [];
  for (const [whole, , value] of text.matchAll(DOUBLED_QUOTE_ATTR)) {
    if (!isScrubbedLiteral(value, schema)) found.push(whole);
  }
  for (const [whole, attr, node] of text.matchAll(ENTITY_QUOTED)) {
    const value = (attr ?? node).replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    if (!isScrubbedLiteral(value, schema)) found.push(whole);
  }
  for (const [whole, value] of text.matchAll(QUOTED_TEXT)) {
    if (!isScrubbedLiteral(value, schema)) found.push(whole);
  }
  for (const [whole, , value] of text.matchAll(BUCKET_TEXT)) {
    if (/^(?:".*"|\(.*\))$/s.test(value)) continue;
    if (!SCALARS.some((r) => r.test(value))) found.push(whole);
  }
  for (const [whole, tuple] of text.matchAll(TUPLE_TEXT)) {
    if ([...tuple.matchAll(TUPLE_PART)].some(([, part]) => !isScrubbedLiteral(part, schema))) {
      found.push(whole);
    }
  }
  for (const [whole, value] of text.matchAll(BARE_ALIAS)) {
    if (!SCALARS.some((r) => r.test(value))) found.push(whole);
  }
  found.push(...(text.match(SALESFORCE_ID) ?? []), ...(text.match(NON_EXAMPLE_URL) ?? []));
  return found;
}

describe('copiedValues', () => {
  it.each([
    '<groupfilter function="member" level="[none:Customer Name:nk]" member=""Aaron Bergman""/>',
    '<groupfilter from=""[Employee].[All Employee].[Vinay Khanna]"" function="range"/>',
    '<column datatype="string" name="[Parameter 1]" value=""Abspoel, Remco""/>',
    '<bucket>"0034x000001a1ZjAAI"</bucket>',
    '<calculation class="tableau" formula="IF[Record Type ID] = "0124x000000HhIUAA0" THEN 1 END"/>',
    'https://alpo-test',
    '<alias key=""x"" value="Cacher Filtres"/>',
    '<member alias="Cacher Filtres" value="1"/>',
    '<value>"\\"Iain Heath\\""</value>',
    '<value>("California","Columbian")</value>',
    '<groupfilter function="range" to=""[0BPARTNER                     BPARTNER_SALES_PLANNING_DEMO].[WILLIAMSM]""/>',
    '<groupfilter level="[Geography].[Geography].[State-Province]" member=""[Geography].[Geography].[State-Province].&[WA]&[US]""/>',
    '<groupfilter member=""[Employee].[Reports].[Manager Name].&[Jane Doe].&[1030]""/>',
    '<groupfilter function="member" member=""Vinay Khanna""<!-- truncated -->',
    '<groupfilter function="member" member="&quot;Jane Doe&quot;"/>',
    '<bucket>Jane Doe</bucket>',
    '<bucket>"[ds].[__tableau_internal_object_id__].[Jane Doe]"</bucket>',
  ])('flags %s', (text) => {
    expect(copiedValues(text)).not.toEqual([]);
  });

  it.each([
    '<bucket>"[ds].[sum:Sales:qk]"</bucket>',
    '<bucket>"\\"[Starbucks].[sum:Sales:qk]:2\\""</bucket>',
    '<alias key="#2000-03-11#" value="#2000-03-11#"/>',
    '<groupfilter function="member" level="[none:Region:nk]" member="%null%"/>',
    '<encoding attr="space" major-origin="0.00000000000000000"/>',
    '<bucket>"Value 1"</bucket>',
    '<groupfilter member=""[Employee].[All Employee].[Value 3].[1009]""/>',
    '<value>("Value 1","Value 2")</value>',
    '<calculation class="tableau" formula=""https://example.com""/>',
    '<format attr="subtitle" value=""/><format attr="title" value="true"/>',
    '<bucket>"[Parameters].[Parameter 1]"</bucket>',
    '<bucket>"[ds].[sum:Sales:qk]:2"</bucket>',
    '<bucket>"[South].[Value 1]"</bucket>',
    '<groupfilter level="[Geography].[Geography].[State-Province]" member=""[Geography].[Geography].[State-Province].&[Value 2]&[Value 3]""/>',
    '<groupfilter member=""[Employee].[Reports].[Manager Name].&[Value 1].&[1030]""/>',
    '<bucket>"[ds].[__tableau_internal_object_id__].[cnt:Orders:qk]"</bucket>',
    '<bucket>%ragged%</bucket><value>#2004-01-01#</value><value>12</value>',
  ])('allows %s', (text) => {
    expect(copiedValues(text)).toEqual([]);
  });
});

describe.each(FILES)('%s carries no copied data values', (_file, entries) => {
  it('keeps every value in name, features and snippet xml a placeholder or plain scalar', () => {
    const offenders: string[] = [];
    for (const e of entries) {
      const snippets = e.snippets as Record<string, { xml?: string }>;
      const texts: Array<[string, string]> = [
        ['name', String(e.name)],
        ...(e.features as string[]).map((f): [string, string] => ['features', f]),
        ...Object.entries(snippets).map(([f, s]): [string, string] => [f, s.xml ?? '']),
      ];
      for (const [where, text] of texts) {
        for (const value of copiedValues(text)) offenders.push(`${e.id} ${where}: ${value}`);
      }
    }
    expect(offenders.slice(0, 20), `${offenders.length} copied values`).toEqual([]);
  });

  it('has no parsed json twin beside any snippet xml', () => {
    const offenders = entries
      .filter((e) => Object.values(e.snippets as Record<string, object>).some((s) => 'json' in s))
      .map((e) => e.id);
    expect(offenders).toEqual([]);
  });
});
