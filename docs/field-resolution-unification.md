# Field resolution — unification design

_Draft for review, rev. 2026-09-16. Current-state map:
[field-resolution-inventory.md](./field-resolution-inventory.md)._

## The reframe: model first, then resolve

The first draft proposed a shared `resolveFieldInstance(fields[], query, opts)`
free function. Review feedback (WM) pushed on the foundation, and it was right:
**the abstractions are unclear because there is no domain model.** The evidence
is in the types, not opinion:

- **Nothing owns a field.** `FieldReference.datasource` (`metadata/types.ts:32`)
  is a bare `string` carried by value on every field row. `ParsedDatasource`
  (`types.ts:93`) is a raw XML node (`{ '@_name', [key]: any }`), not a domain
  entity. A "datasource" today is a label on a flat bag of fields.
- **Definition and instance are conflated in one type.** `FieldReference`
  carries both `columnName` (the column *definition*, `[Sales]`) **and**
  `columnInstanceName` / `derivation` / `isAggregated` / `column_ref` (a specific
  *instance*, `[sum:Sales:qk]`). `listAvailableFields` emits one row per
  column-instance, so what flows through is already an instance — wearing a
  definition's clothes.

That tangle is the actual root cause of the four-resolver fork: the
aggregation-prefix phase (`"sum of X"` → synthesize `[sum:X:qk]`, a *different
instance of the same column*) needs the definition/instance split, so the binder
— which threw those fields away in `SchemaField` — could not share it.

**So modeling is where to start.** The resolver's shape then falls out of the
model instead of being invented.

## The domain model (three types the code already implies)

| Type | Is | Carries | Owns |
|---|---|---|---|
| **Datasource** | a connected data source | name, caption | its Fields |
| **Field** (definition) | a data-pane field — `[Sales]`. A **union by `kind`**: `column`, `calculation`, `bin` (categorical-bin). Sets/hierarchies not modeled today. | name, caption, datatype, role, folder, default derivation; `formula` on calcs. Aggregation-agnostic. | — |
| **Field instance** (column-instance) | a Field used with a derivation — `[sum:Sales:qk]` | just its `column_ref` (+ optional `roleOverride`); everything else derives from the ref | — (product of usage) |

- A **Datasource owns Fields** (of which a plain DB column is one kind).
  Resolution is *scoped to* a Datasource by construction, so today's `datasource?`
  scoping option **disappears** — it is just *which datasource you ask*.
- A **Field instantiates to Field instances; the datasource does not own the
  instances.** "Sales" (what a user says) is a Field; `[sum:Sales:qk]` /
  `[avg:Sales:qk]` (what lands on a shelf) are instances, created on demand when
  a Field is placed or when aggregation-prefix parsing fires. They live in
  usage, not in the datasource.
- **The link is a loose, by-name reference — faithful to the XML, not a defect.**
  A materialized instance lives in the consuming **worksheet's**
  `datasource-dependencies` and back-references its Column and DS by name:
  `<column-instance column='[Sales]' name='[sum:Sales:qk]' …>` under
  `<datasource-dependencies datasource='Sample - Superstore'>`
  (fixture `superstore-scratch-ref.xml:660`). So the chain is
  `FieldInstance --@_column--> Column --@_datasource--> Datasource`, all strings.
  That is why `FieldReference.datasource: string` is a legitimate loose reference;
  the work is to *name* these relationships, not to build a hard object graph
  Tableau itself does not keep.
- **Resolution (read) and declaration (write) are separate steps.** Resolving a
  name yields an instance; a worksheet that uses it must then **materialize the
  requirement** — write the `<column-instance>` into its own
  `datasource-dependencies`. Only that second step mutates the workbook, and it
  belongs to the worksheet/add-field/binder write path, not to the (pure)
  resolver. The resolved instance must therefore expose its back-refs (base
  column name + datasource name) so the write step can declare them.
- Today's `listAvailableFields` row is a **Column bundled with its _default_
  instance** — the builder synthesizes a `defaultAgg` + `column_ref` per column
  (field-builder.ts:533–565), one row per Column, not per real column-instance.
  That bundling is the muddle we are untangling; the model is a *view* over those
  rows, not a new parse or a copy.

## Resolution over the model

The whole metadata/binder layer is free-functions + interfaces (`listAvailableFields`,
`resolveField`, `summarizeSchema` are all functions; the only classes are stateful
infra caches). So `Datasource` is a **type**, and resolution is a **free function**
— no class, matching the house style.

**On the `FieldReference` layering:** it is accidental, not meaningful. Bare
`FieldReference` is used in exactly two spots — the input to `buildColumnRef()`
and the return of `findField()` — i.e. genuinely *before* a `column_ref` has been
computed. Everywhere downstream (**20 sites**) hand-re-spells
`FieldReference & { column_ref: string }`. The fix is to **name that once** as
`FieldInstance` and import it at all 20 sites; bare `FieldReference` survives only
as the pre-materialization shape those two constructors need. No third layer.

### How Column and Field-instance are merged today, and the split (WM: split them)

**Today they are one object.** `FieldReference` has *both* the definition fields
(`columnName`, `caption`, `datatype`, `role`, `formula`, `folder`, …) and the
instance fields (`columnInstanceName`, `derivation`, `isAggregated`, `column_ref`).
`listAvailableFields` walks the base `<column>` definitions and, for each, **bakes
on a single default instance** — it picks `defaultAgg` (measure→`Sum`, calc→`User`,
else `None`), builds `[sum:Sales:qk]` and the `column_ref`, and stashes them as
extra properties on the same row (field-builder.ts:533–565). So "the merge" is
just: the definition and its *one default* instance share a struct. There is no
representation of a Column that hasn't been instantiated, and no way to hold a
second instance (`[avg:Sales:qk]`) of the same column except by minting another
whole row.

**Split** (incorporating WM: `Field` is the umbrella, it's a discriminated union,
and the instance is mostly *derived* from its ref):

```ts
// src/desktop/metadata/datasource.ts

// A Datasource owns FIELDS, of which a plain DB column is only one kind.
// Union scoped to what the data actually distinguishes today (see note below).
type Field = ColumnField | CalculationField | BinField;

interface FieldBase {
  name: LocalFieldName;                   // '[Sales]'   (today's columnName)
  caption?: string;                       // often absent (see displayName note)
  datatype?: string;
  role: 'dimension' | 'measure';          // the field's default role
  folder?: string;
  defaultDerivation: AggregationType;     // measure→Sum, calc→User, else None
  // + table / logicalTableId / semanticRole / approxCount metadata
}
interface ColumnField      extends FieldBase { kind: 'column'; }
interface CalculationField extends FieldBase { kind: 'calculation'; formula: string; }
interface BinField         extends FieldBase { kind: 'bin'; } // <calculation class='categorical-bin'> (today's isGroup)

// A FieldInstance is (almost) just its ref: GlobalFieldName already encodes
// datasource + derivation + base name + type-code. Store the source of truth,
// DERIVE the rest via free accessors — no duplicated fields, no getters/classes.
interface FieldInstance {
  column_ref: GlobalFieldName;            // '[Sample - Superstore].[sum:Sales:qk]'
  roleOverride?: 'dimension' | 'measure'; // per-instance reinterpretation (WM); undefined = use the Field's role
}

// Accessors — thin wrappers over the EXISTING parsers
// (parseDatasourceQualifiedColumnRef + ColumnInstanceRefParts, field-resolver.ts:85–103):
function datasourceOf(f: FieldInstance): string;            // '[Sample - Superstore]'
function derivationOf(f: FieldInstance): AggregationType;    // 'sum'
function baseFieldNameOf(f: FieldInstance): LocalFieldName;  // '[Sales]' -> look up the Field
function instanceNameOf(f: FieldInstance): LocalFieldName;   // '[sum:Sales:qk]'

interface Datasource {
  readonly name: string;
  readonly caption?: string;
  readonly fields: ReadonlyArray<Field>;   // was "columns"
}

/** The field's default instance — what listAvailableFields bakes on today. */
function defaultInstance(ds: Datasource, f: Field): FieldInstance;
/** A specific aggregated instance — what agg-prefix / a shelf drop mints. */
function instantiate(ds: Datasource, f: Field, d: AggregationType): FieldInstance;

/**
 * Match a name/ref to a Field in the datasource, then instantiate:
 * `field` is the Field's default instance, or the aggregated instance when the
 * query carried an aggregation and `aggregationPrefix` is on.
 */
function resolveField(
  datasource: Datasource,
  query: string,
  opts?: { aggregationPrefix?: boolean },
): Resolution;

interface Resolution {
  kind: 'exact' | 'rewritten' | 'fuzzy' | 'ambiguous' | 'not_found';
  match?: Field;                // what matched — always set when there is a match
  field?: FieldInstance;        // matched field, instantiated (default or aggregated)
  candidates: Field[];          // ranked; the disambiguation set when ambiguous
  rewrites?: string[];          // e.g. 'parsed-aggregation-prefix'
  notes?: string[];             // e.g. near-duplicate warning
}
```

Three things this bakes in from review:

- **`Field`, not `Column`** — a datasource owns fields; a DB column is one `kind`.
  The union is scoped to what `field-builder` actually distinguishes **today**:
  plain `column`, `calculation` (has `formula`), and `bin` (categorical-bin, the
  current `isGroup`). **Sets and hierarchies are _not modeled today_** —
  `field-builder` never emits them (hierarchies exist as `<drill-path>` in the
  XML but are dropped). Adding them is a future `kind`, called out rather than
  invented.
- **The instance is derived, not duplicated.** `column_ref` is the single source
  of truth; `datasourceOf`/`derivationOf`/`baseFieldNameOf` are free functions
  wrapping parsers that **already exist**. The only stored extra is
  `roleOverride`, the one piece of per-instance state the ref does not carry.
  (This is the "derived properties without classes" answer to WM: accessor
  functions over a branded string, not getters on an object.)
- **Matching ranks `Field`s** (one per definition), so numeric-suffix /
  near-duplicate ambiguity is computed over the real set, not default-instance rows.

**Cost of the split:** it unbundles `FieldReference`, reshapes `field-builder.ts`
to emit the `Field` union, and touches the 20 downstream sites — more invasive
than an alias, so it is its own step (see staged path). Worth it, per WM.

Ladder (merge of today's two): exact `column_ref` → exact name/caption/bare →
case-insensitive → [aggregation-prefix → Field → instance, if enabled] → fuzzy.

**Always populate `field` with the best match; let the caller judge `kind`.**
There is no `fuzzy: 'match' | 'suggest-only' | 'off'` mode (per WM: "if we
matched a field why would we not just populate field"). Mechanism (find the best
match) is separated from policy (whether to accept it):

- fields tool / binder gates: accept `exact` and `rewritten`; surface
  `ambiguous`/`not_found` candidates.
- **calc: refuse `fuzzy`** — a calc token names a specific field and a wrong
  guess corrupts a formula silently. This is now one line at the call site
  (`if (r.kind === 'fuzzy') …`), not a resolver mode.
- add-field: uses `candidates` for suggestions; still requires an exact
  `column_ref` for the mutation itself.

### Brand the name strings (per WM)

The code juggles three kinds of bracketed string as interchangeable `string`s,
which is exactly the category error to eliminate. Brand them (nominal string
types + smart constructors), so a qualified ref can't be passed where a local one
is expected:

```ts
type LocalFieldName  = string & { readonly __brand: 'LocalFieldName' };  // '[Region]', '[sum:Sales:qk]'
type GlobalFieldName = string & { readonly __brand: 'GlobalFieldName' }; // '[Sample - Superstore].[sum:Sales:qk]' (the column_ref)
```

`GlobalFieldName` is a `LocalFieldName` prefixed with a datasource segment — the
existing `column_ref`. Human-display strings (below) are a **separate, unbranded**
kind: they are labels for people, not refs.

### Shared primitives

The five duplicated primitives move into this module. Documented, not folded
silently:

- **`bareName(name: LocalFieldName)`** — strip surrounding brackets:
  `[Region]` → `Region`. Produces a display string.
- **`displayName(field)`** — the human label: `caption ?? bareName(columnName)`.
  The `??` fallback is **load-bearing, not defensive**: base columns usually have
  *no* caption. In the Superstore fixture only **3 of 66 `<column>` elements**
  carry `caption=` — `Row ID`, `Order ID`, `Order Date` are raw source names.
  Captions appear on calculated fields and user-renamed columns; raw DB columns
  fall back to the bracketed name. (This corrects the review note — a base column
  very much can lack a caption.)
- **`disambiguateRanked`** — the ambiguity policy (caption-exact wins; single
  unsuffixed member of a numeric-suffix family wins). One copy = one policy.
- **`numericSuffixParts`, `nearDuplicateNote`** — supporting helpers.

One fuse.js config. `fast-levenshtein` retires from the field path.

## Field-type decision — the split kills `SchemaField` (no alias needed)

The earlier draft proposed keeping a narrowed alias
(`FieldInstance & { name; role }`). WM's question — *"what are we actually adding
with `name`?"* — is the right one: **nothing we should store.** `SchemaField`
existed to do two things, and the Field/instance split covers both without a new
type:

- **precomputed `name`** (= `caption ?? bareName(columnName)`) — that is exactly
  `displayName(field)`, a **function call**, not a stored field. Don't bake it.
- **narrowed `role`** (`'dimension' | 'measure'`) — now just `Field.role`.

So `SchemaField` is **deleted**, not aliased. Binder gates resolve to a `Field`
(for identity/label) or its `FieldInstance` (when they need `column_ref`);
`summarizeSchema` returns `{ datasource, fields: Field[] }` and drops its
projection step. No stored display name, no second field type.

Open question before wiring calc/binder: does `buildLlmInput` serialize whole
fields (payload concern) or project to its own wire shape? If it projects
(expected), the internal `Field` can stay rich at no model-payload cost.

## Per-skill adapters (thin)

| Skill | Call | Output projection |
|---|---|---|
| fields tool (`resolve-field`) | `resolveField(ds, q, { aggregationPrefix: true })` | winner → `FieldCandidate` (snake_case, `column_ref`) |
| binder gates (`resolveInSummary`) | `resolveField(ds, q)` | use `field` directly (gates want the rich object) |
| calc skill (`resolveLooseFieldReference`) | `resolveField(ds, token)`, reject `kind==='fuzzy'` | resolved field / candidates |
| add-field (`nearestColumnRefs`) | `resolveField(ds, q).candidates` | `column_ref` list; **drop fast-levenshtein** |

## Behaviors to keep (must not regress)

1. **Calc never fuzzy-substitutes** — now a call-site check on `kind`, not a mode.
2. **Aggregation-prefix parsing** (`"sum of Profit"`; don't double-aggregate an
   already-aggregated instance) — `aggregationPrefix: true`, fields tool only.
3. **Datasource scoping** — subsumed by *which Datasource you ask*.
   Caption→internal resolution stays in `selectTargetDatasource` /
   `resolveUniqueDatasourceName` (it builds the Datasource).
4. **`ambiguous` semantics** — `disambiguateRanked`'s tie-breaks preserved
   verbatim.
5. **Fail-closed** — no silent wrong binds; ambiguity/not-found surface
   candidates. Add-field still requires an exact ref for the mutation.

## Staged path (lowest risk first)

Decided (WM): **model-first**; `Field` is the owned umbrella (a **discriminated
union** by `kind`); **split Field vs Field-instance** at the type level, the
instance mostly *derived* from its ref; **standardize on fuse.js**, drop
fast-levenshtein; **model worksheet field requirements** as a first-class thing
(later). `SchemaField` is deleted, not aliased.

1. **Extract shared primitives + brand the name strings** into one module
   (`bareName`/`displayName`/`disambiguateRanked`/… + `LocalFieldName` /
   `GlobalFieldName`); point both files at them. Behavior-identical, existing
   tests unchanged. _Free; do first regardless._
2. **Split `FieldReference` into the `Field` union + `FieldInstance`** and rebuild
   `listAvailableFields` to emit `Field[]` (+ `defaultInstance` / `instantiate`
   and the `column_ref` accessors). This is the invasive step (field-builder + the
   20 sites); land it on its own.
3. **Introduce the `Datasource` type** (`{ name, caption, fields }`) as the view;
   `summarizeSchema` returns it and **`SchemaField` is deleted**.
4. **Build `resolveField(ds, …)`**; re-express `resolveInSummary` + the existing
   `resolveField` against it (agg-prefix behind the flag). Safety net:
   `validate.test.ts`, `field-resolver` tests, `binder.test.ts`.
5. **Route calc + add-field** through it; calc rejects `fuzzy` at the call site;
   retire `fast-levenshtein`.
6. **(Later) Model worksheet field requirements** — make declaration
   (materializing `<column-instance>` into `datasource-dependencies`) a
   first-class write-side concern rather than ad-hoc XML mutation.

Each step is independently shippable and reversible.

## Decisions — resolved (WM)

- ✅ **Model-first** (Datasource / Field / Field-instance as types + free functions).
- ✅ **`Field` is the owned umbrella**, a discriminated union by `kind`
  (`column` / `calculation` / `bin`); sets & hierarchies noted as unmodeled-today.
- ✅ **Split Field vs Field-instance** at the type level; the instance is
  (almost) just its `column_ref`, the rest derived via accessors — no duplicated
  fields, no classes. Only `roleOverride` is stored extra.
- ✅ **Model worksheet field requirements** first-class — as a later stage (step 6).
- ✅ **Delete `SchemaField`**; no narrowed alias, no stored display `name`
  (`displayName()` is a function; `role` lives on `Field`).
- ✅ **Standardize on fuse.js**; drop `fast-levenshtein` from the field path.

- ✅ **A domain layer is the goal** (not just a shared resolver function) —
  first-class Datasource / Field / Field-instance. **Free functions for now**
  (no classes): accessors over the branded `column_ref`, not getters. This
  resolves the derive-vs-pointer question in favour of **derive-from-ref** —
  serializable, no cycles, reuses the existing parsers; re-parsing per access is
  fine (instances are few).

Still open:

- [ ] Land steps 1–2 now and design-review the rest, or proceed straight through?
