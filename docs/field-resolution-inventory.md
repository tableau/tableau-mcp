# Field resolution — current-state reference

_As of 2026-09-16. Companion to [field-resolution-unification.md](./field-resolution-unification.md)._

"Resolving a field instance" = taking a user/proposal/formula-supplied field
**name** (or ref) and mapping it to a concrete workbook field (its
`column_ref`, role, type, aggregation). This doc inventories every place that
does it today. The headline: **there is one source of truth for the field
_data_, and none for the field _resolution_ on top of it.**

## The one thing already unified: the data root ✅

`listAvailableFields(workbookXml)` (`src/desktop/metadata/field-builder.ts`)
parses the workbook once and returns the canonical rich type
`FieldReference & { column_ref: string }` (`src/desktop/metadata/types.ts`).

- ~16 direct callers; nobody else re-parses XML for the field list.
- This is the real single source of truth — but only for _what fields exist_,
  not for _how a name maps to one_.

## The resolution sprawl: four implementations

| Resolver | Skill / layer | Field type | Fuzzy engine | Deliberate policy |
|---|---|---|---|---|
| `resolveField` (`metadata/field-resolver.ts:419`) | fields tool (agent-facing) | `FieldReference` | **fuse.js** (thr 0.4, keys `caption`,`columnName`) | aggregation-prefix parse (`"sum of X"` → `[sum:X:qk]`); `options.datasource` scoping |
| `resolveInSummary` (`binder/validate.ts:348`) | binder gates | `SchemaField` | **fuse.js** (thr 0.4, keys `name`,`caption`,`columnName`) | none (scoping done upstream in `summarizeSchema`) |
| `resolveLooseFieldReference` (`binder/classify.ts:1360`) | calc skill | `SchemaField` | **none** | never fuzzy-_substitutes_ (a calc token names a specific field); exact + singular/plural + synonym-_suggest_ only |
| `nearestColumnRefs` (`fields/addField.ts`) | add-field skill | `FieldReference` | **fast-levenshtein** | suggestions-only; requires an exact `column_ref`, delegates real resolution to `resolve-field` |

Separate concern (legitimately distinct): the classify family
(`resolveEncodingFieldInAsk`, `matchFieldsInAsk`, business-synonym / acronym /
plural / grain matchers in `classify.ts`) resolves **English prose → field**,
not name → instance. See [bind-template docs] for that layer's language notes.

## Two field types flowing through

Both descend from `listAvailableFields`, projected two different ways:

- **`FieldReference & {column_ref}`** — the rich root: `columnName`,
  `columnInstanceName`, `derivation`, `formula`, `type`, `datatype`, `role`
  (string), `isAggregated`, `semanticRole`, `caption`, `datasource`, `table`,
  `column_ref`, … Used by `resolveField`, `addField`.
- **`SchemaField`** (`binder/schema-summary.ts`) — the binder's **lossy**
  projection: adds a precomputed `name` (= `caption ?? bareName(columnName)`),
  narrows `role` to `'dimension' | 'measure'`, and **drops** `formula`,
  `columnInstanceName`, `derivation`, `folder`, `logicalTableId`, `contentUrl`.
  Used by `resolveInSummary`, `resolveLooseFieldReference`, the gates, classify.

The dropped fields (`formula`, `columnInstanceName`, `derivation`) are exactly
what `resolveField`'s aggregation-prefix phase depends on — which is _why_ the
binder couldn't reuse `resolveField` and the ladders forked. The lossiness is
the root cause, not the naming.

## The drift surface: duplicated primitives

Same logic, copied — kept in sync only by convention (no shared import, no
parity test):

| Helper | Copies | Locations |
|---|---|---|
| `bareName` | 4 | schema-summary, classify, field-resolver, templates/groupDefinitionSplice |
| `displayName` | 3 | validate, field-resolver, fields/listAvailableFields |
| `disambiguateRanked` | 2 | validate, field-resolver |
| `numericSuffixParts` | 2 | validate, field-resolver |
| `nearDuplicateNote` | 2 | validate, field-resolver |

`disambiguateRanked` is the **ambiguity policy** (caption-exact wins; single
unsuffixed member of a numeric-suffix family wins) — duplicating it means the
policy can silently diverge between the fields tool and the binder.

Two fuzzy engines in the field path: **fuse.js** (binder + fields tool) and
**fast-levenshtein** (add-field suggestions). Same "did you mean," two engines.

## Why it looks like this (provenance, not design)

The forks are a merge artifact of two independently-built subsystems, not a
considered decision:

- `resolveField` / `FieldReference` — **native to this repo**, introduced
  2026-06-15 ("Add fields tools", Andy Young).
- `SchemaField` / `resolveInSummary` / the whole `binder/` engine — **ported
  wholesale from an external "generator/lab" repo** 2026-07-06 (PR #443, squashed
  into `af82a71f`). It brought its own field type because in its origin repo
  `resolveField` did not exist. The port touched `field-resolver.ts` zero times.
- The binder was kept dependency-minimal (imports only `listAvailableFields`
  and `COLUMN_REF_REGEX` from the metadata layer) to stay **re-syncable** from
  the lab — tracked in `docs/authoring-migration-drift.md`.
- The `"mirrors resolveField's outcome semantics"` comment in `validate.ts:344`
  is a post-hoc observation, not the reason for the fork.

**The lab is now dead. This repo is the source of truth.** All binder work since
2026-08 has been native (`feat/fix(desktop)` PRs), no drift-syncs. The
portability constraint that justified the duplication has lapsed — so unifying
is now unblocked. See the design doc for the target.

## Scope confirmed elsewhere (the datasource fix)

A related un-scoped-resolution bug was fixed 2026-09 in `bind-template`:
`summarizeSchema(xml, scopeDatasource?)` now filters the field pool to the
chosen datasource when the caller names one (`binder/schema-summary.ts`,
threaded through `binder/binder.ts` `bindTemplate()` and the tool). That made
datasource scoping an explicit _input filter_ — the same shape the unified
resolver should keep.

## `column_ref`: what it is, and its blast radius

`column_ref` (built by `buildColumnRef`, `field-builder.ts:273`) is the
**fully-qualified identity of a field _instance_**, not a base column:

```
[Sample - Superstore].[sum:Profit:qk]
 └── datasource ──────┘ └─ column-instance name ─┘
      prefix = derivation (sum/none/usr) · middle = bare column · suffix = qk/ok/nk (quant/ordinal/nominal)
```

The derivation is baked in, so `[none:Profit:qk]` and `[sum:Profit:qk]` are two
`column_ref`s for the *same* base column. `listAvailableFields` synthesizes the
*default* instance's ref (measure→`sum`, quantitative→`qk`); the aggregation-prefix
path mints a different one by re-running the construction with another derivation.

**Blast radius — it is a contract, not just an internal field:**

- **17 prod files, 108 uses (+101 in tests).** Concentrated in `field-resolver.ts`
  (38), the binder (`explicit-bind`, `classify`, `validate`, `schema-summary`,
  `binder`), the sheet builders, and the mutation tools (`addField`, `bindTemplate`).
- **Agent-facing wire vocabulary.** `list-available-fields` (Full mode) emits
  `column_ref`; agent instructions say *"use exact column_ref"* (`instructions.ts:91`,
  `listAvailableFields.ts:144`). The model reads it and hands it back as the field
  identity to place.
- **Internal identity + parseable value.** Exact-match join key
  (`explicit-bind.ts:393`, `f.column_ref === raw`) and parsed apart via
  `parseQualifiedColumnInstance` / `DatasourceQualifiedColumnRef`
  (`field-resolver.ts:85`).
- **A snake/camel seam already exists:** `column_ref` (108, the serialized
  property) vs `columnRef` (112, internal locals/returns). The snake form is the
  name on the wire; code translates at boundaries.

## What it would take to make `GlobalFieldName` clear

The goal is a named, self-validating type for the qualified instance ref — without
touching the wire. Concretely:

1. **Brand, don't rename.** Define
   `type GlobalFieldName = string & { readonly __brand: 'GlobalFieldName' }` and
   `type LocalFieldName = string & { readonly __brand: 'LocalFieldName' }`
   (a `GlobalFieldName` = a `LocalFieldName` prefixed with a `[datasource]`
   segment). At the JSON boundary both are still `string`, so the `column_ref`
   property name and agent vocabulary are unchanged — the brand is purely a
   compile-time guarantee.
2. **One constructor + one guard, at the existing parse site.**
   `parseQualifiedColumnInstance` already validates and splits a qualified ref, so
   it becomes the *only* way to mint a `GlobalFieldName` (`toGlobalFieldName`) /
   assert one (`isGlobalFieldName`). `buildColumnRef` returns `GlobalFieldName`;
   raw string literals are barred from the type without going through it.
3. **Type the field, not the JSON.** Change the `column_ref` property type from
   `string` to `GlobalFieldName` on the canonical record (the future
   `FieldInstance`) and let inference propagate. The ~17 sites keep the same
   property name; only ones that *construct* a ref from a bare string need the
   constructor — the compiler lists them.
4. **Put the local/global boundary on the primitives.** `bareName` takes a
   `LocalFieldName`; splitting a `GlobalFieldName` yields `{ datasource, instance:
   LocalFieldName }`. This is what stops a qualified ref being passed where a
   local name is expected (the category error the fields codebase makes freely
   today).

Cost: mechanical and compiler-guided (add two types + a constructor/guard at the
existing parser, change one property type, fix what the compiler flags). No wire
change, no agent-facing change, no behavior change — so it can land in step 1
alongside the shared-primitives extraction, independent of the Column/instance
split.
