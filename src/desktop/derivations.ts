/**
 * The ONE canonical Tableau derivation table.
 *
 * A column-instance carries the derivation twice: the NAME holds a lowercase short
 * prefix (`[cnt:Sales:qk]`) and the sibling `derivation` ATTRIBUTE holds the
 * capitalized canonical long form (`Count`). Get the long form wrong and Tableau
 * silently rewrites BOTH the attribute and the name to `None` on load — the pill
 * loses its aggregation/truncation and the viz renders blank or unaggregated, with
 * no error anywhere.
 *
 * Before this module there were four disagreeing tables (metadata/fields.ts,
 * templates/fieldReferenceRewriter.ts, metadata/field-resolver.ts, and the
 * validation rule's allowlist). Three of them ended in `|| abbrev`, so an
 * unrecognized prefix was echoed straight into the `derivation` attribute — which
 * our own `invalid-derivation-string` preflight then rejected with text that named
 * neither the cause nor the fix. The agent's ref was correct; we corrupted it, then
 * blamed it. Every lookup now resolves through here, and a miss THROWS rather than
 * echoing an unusable string onward.
 *
 * AUTHORITY, in precedence order:
 *  1. `resources/desktop/knowledge/tactics/tree/column-instance-prefixes.md` —
 *     "Empirically Confirmed", field-tested by XML injection + round-trip inspection
 *     against live Desktop (2026-06-25). It states outright that it supersedes
 *     `tactics/tree/enums.md` for derivation strings and CI prefixes.
 *  2. Real Tableau-authored XML captured in `src/desktop/data/twb-example-index.json`
 *     and `src/desktop/data/corpus.json` — e.g. `[attr:i_item_desc:nk]` with
 *     `derivation="Attribute"`, `[cnt:id:qk]` with `Count`, `[ctd:O_ORDERKEY:qk]`
 *     with `CountD`, `[tyr:Ship Date:qk]` with `Year-Trunc`.
 *  3. This repo's own preflight allowlist, previously inlined in
 *     `validation/rules/invalidDerivationString.ts` and now hosted below.
 *
 * `tactics/tree/enums.md` is NOT authority here: its derivation line still lists the
 * look-alikes `Attr`, `TruncYear`, `TruncMonth`, `TruncDay`, all four of which the
 * preflight rejects and none of which appear in real Tableau output.
 */

/**
 * Canonical `derivation` attribute values — case-sensitive, exact, closed.
 * Anything outside this set silently rewrites to `None` on load.
 */
export const CANONICAL_DERIVATIONS: ReadonlySet<string> = new Set<string>([
  // Dimension
  'None',
  'Attribute',
  // Date part (discrete/continuous)
  'Year',
  'Quarter',
  'Month',
  'Week',
  'Weekday',
  'Day',
  'Hour',
  'Minute',
  'Second',
  'MY',
  'MDY',
  'ISO-Year',
  'ISO-Qtr',
  'ISO-Week',
  'ISO-Weekday',
  // Date truncation
  'Year-Trunc',
  'ISO-Year-Trunc',
  'Quarter-Trunc',
  'ISO-Qtr-Trunc',
  'ISO-Week-Trunc',
  'Month-Trunc',
  'Week-Trunc',
  'Day-Trunc',
  'Hour-Trunc',
  'Minute-Trunc',
  'Second-Trunc',
  // Measure aggregation
  'Sum',
  'Avg',
  'Count',
  'CountD',
  'Median',
  'Min',
  'Max',
  'Stdev',
  'StdevP',
  'Var',
  'VarP',
  // Table calc
  'User',
  // Set membership. Tableau writes this itself — `[io:Coffee Set:nk]` with
  // derivation="InOut" appears in captured real workbooks (twb-example-index.json,
  // corpus.json) — so rejecting it would fail preflight on Tableau's own output.
  'InOut',
  'Collect',
]);

/**
 * The canonical short prefix Tableau itself writes for each derivation. This is the
 * form to EMIT; see `DERIVATION_SHORT_TO_LONG` for the (wider) set we accept.
 */
export const DERIVATION_LONG_TO_SHORT = {
  None: 'none',
  Attribute: 'attr',
  Year: 'yr',
  Quarter: 'qr',
  Month: 'mn',
  Week: 'wk',
  Weekday: 'wd',
  Day: 'dy',
  Hour: 'hr',
  Minute: 'mi',
  Second: 'sc',
  MY: 'my',
  MDY: 'md',
  'ISO-Year': 'iyr',
  'ISO-Qtr': 'iqr',
  'ISO-Week': 'iwk',
  'ISO-Weekday': 'iwd',
  'Year-Trunc': 'tyr',
  'ISO-Year-Trunc': 'tiyr',
  'Quarter-Trunc': 'tqr',
  'ISO-Qtr-Trunc': 'tiqr',
  'ISO-Week-Trunc': 'tiwk',
  'Month-Trunc': 'tmn',
  'Week-Trunc': 'twk',
  'Day-Trunc': 'tdy',
  'Hour-Trunc': 'thr',
  'Minute-Trunc': 'tmi',
  'Second-Trunc': 'tsc',
  Sum: 'sum',
  Avg: 'avg',
  Count: 'cnt',
  CountD: 'ctd',
  Median: 'med',
  Min: 'min',
  Max: 'max',
  Stdev: 'std',
  StdevP: 'stp',
  Var: 'var',
  VarP: 'vrp',
  User: 'usr',
  InOut: 'io',
  Collect: 'clct',
} as const satisfies Readonly<Record<string, string>>;

export type CanonicalDerivationShort =
  (typeof DERIVATION_LONG_TO_SHORT)[keyof typeof DERIVATION_LONG_TO_SHORT];

export const CANONICAL_DERIVATION_SHORT_FORMS = Object.freeze(
  Object.values(DERIVATION_LONG_TO_SHORT),
) as readonly [CanonicalDerivationShort, ...CanonicalDerivationShort[]];

/**
 * Non-canonical short prefixes we still accept on input. Tableau rewrites the CI
 * NAME for these but honours the derivation attribute, so resolving them is
 * lossless; emitting them is not. Kept so refs already in the wild keep working.
 */
const DERIVATION_SHORT_ALIASES: Readonly<Record<string, string>> = {
  cntd: 'CountD',
  countd: 'CountD',
  count: 'Count',
  countdistinct: 'CountD',
  median: 'Median',
  stdev: 'Stdev',
  stdevp: 'StdevP',
  varp: 'VarP',
  user: 'User',
  tmo: 'Month-Trunc',
  collect: 'Collect',
};

/**
 * Table-calc wrapper prefixes. A real Tableau CI nests them ahead of the base
 * derivation — `[pcto:cum:sum:Sales:qk]` carries `derivation="Sum"` — so the wrapper
 * segments are stripped before lookup rather than resolved on their own.
 */
export const COLUMN_INSTANCE_WRAPPER_PREFIXES: ReadonlySet<string> = new Set<string>([
  'cum',
  'diff',
  'fval', // Desktop emits `[fVal:sum:Sales:qk]`; fVal wraps rather than replaces the binding derivation.
  'pcdf',
  'pcto',
  'rank',
  'pcrk',
  'win',
]);

/** Every accepted short prefix → its canonical long form. */
export const DERIVATION_SHORT_TO_LONG: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries([
    ...Object.entries(DERIVATION_LONG_TO_SHORT).map(([long, short]) => [short, long]),
    ...Object.entries(DERIVATION_SHORT_ALIASES),
  ]),
);

/** Thrown when a short prefix resolves to no canonical derivation. */
export class UnknownDerivationError extends Error {
  readonly shortForm: string;

  constructor(shortForm: string) {
    super(
      `Unknown column-instance derivation prefix "${shortForm}". ` +
        'It maps to no canonical Tableau derivation, and writing it into a derivation ' +
        'attribute makes Tableau silently rewrite the pill to None on load. Use one of: ' +
        `${Object.values(DERIVATION_LONG_TO_SHORT).sort().join(', ')} ` +
        '(e.g. cnt=Count, ctd=CountD, attr=Attribute, tmn=Month-Trunc, usr=User).',
    );
    this.name = 'UnknownDerivationError';
    this.shortForm = shortForm;
  }
}

/** Strip any leading table-calc wrapper segments from a prefix chain. */
function baseSegment(prefixChain: string): string {
  const segments = prefixChain
    .split(':')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  while (segments.length > 1 && COLUMN_INSTANCE_WRAPPER_PREFIXES.has(segments[0])) {
    segments.shift();
  }
  return segments[0] ?? '';
}

/**
 * Resolve a column-instance short prefix to its canonical `derivation` attribute
 * value. Accepts a bare prefix (`cnt`) or a table-calc chain (`pcto:cum:sum`).
 * Returns undefined rather than throwing — for read paths that must tolerate
 * whatever a workbook happens to contain.
 */
export function tryResolveDerivation(prefixChain: string): string | undefined {
  return DERIVATION_SHORT_TO_LONG[baseSegment(prefixChain)];
}

/** Resolve an accepted prefix chain to the canonical short form Desktop emits. */
export function canonicalShortDerivation(
  prefixChain: string,
): CanonicalDerivationShort | undefined {
  const long = tryResolveDerivation(prefixChain);
  return long === undefined
    ? undefined
    : DERIVATION_LONG_TO_SHORT[long as keyof typeof DERIVATION_LONG_TO_SHORT];
}

/**
 * Resolve a column-instance short prefix to its canonical `derivation` attribute
 * value, or throw. Write paths use this: echoing an unrecognized prefix into the
 * attribute produces XML that our own preflight rejects and that Tableau would
 * silently downgrade, so failing loudly here is strictly better than passing it on.
 */
export function resolveDerivation(prefixChain: string): string {
  const resolved = tryResolveDerivation(prefixChain);
  if (resolved === undefined) {
    throw new UnknownDerivationError(prefixChain);
  }
  return resolved;
}

/** True when `derivation` is a canonical attribute value Tableau will honour. */
export function isCanonicalDerivation(derivation: string): boolean {
  return CANONICAL_DERIVATIONS.has(derivation);
}
