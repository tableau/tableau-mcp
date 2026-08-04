# Template read pipeline: how a `.tbm` becomes an agent-facing template

> Companion to `template-placeholder-generalization.md` and `template-tool-surface-redesign.md`.
> Flowchart: `.canvas/template-read-pipeline.drawio` (rendered alongside
> `template-pipeline-tbm.drawio`).

This documents the exact step-by-step workflow the tool runs when it **reads** a template —
from the bytes on disk to the slot summaries an agent sees in `list-templates`. It reflects
the current code after two changes landed this workstream:

1. **Read order inverted** — the `.tbm` bookmark is now the canonical source, read *first*;
   a tokenized `.xml` is only a fallback (`templatePath.ts:87`).
2. **Slot dedup keyed on `(base, derivation)`** — one field used the same way in two places
   collapses to one slot; the same field at two *different* derivations stays two related
   slots (`inferSlots.ts`).

---

## The two stores and two formats

| | Disk store | Embedded (SEA) store |
|---|---|---|
| **When** | `TEMPLATES_DIR` is set (author working tree) | otherwise (shipped build) |
| **`.tbm`** | canonical drop-in; user opens/edits in Desktop | shipped bookmark assets |
| **`.xml`** | tokenized fallback / raw orphans | curated tokenized tier |
| **`.manifest.json`** | optional curated override | curated tier metadata |

- **`.tbm` (bookmark)** — the **canonical** stored format. It's what a user drops in and what
  they re-open/edit in Desktop, so it is the source of truth. Tokenization is a *computed
  detail*, never a stored artifact — which is what makes round-trip editing work by
  definition (open the same file you dropped in, edit, save back).
- **`.xml` (tokenized)** — the curated/legacy tier that ships no bookmark, plus raw orphans
  on the author's disk. Read only as a **fallback**.

---

## Read order (the swap)

`readTemplate(name)` — `src/desktop/templates/templatePath.ts:87`:

```
validateTemplateName(name)              // path-escape guard: /^[A-Za-z0-9_-]+$/
tbm = readBookmark(name)                // .tbm FIRST (disk or SEA), bytes UNMODIFIED
if (tbm !== null)
    return bookmarkToTemplateWorkbook(tbm, inferFromBookmark(tbm)).xml   // inferred on the fly
// FALLBACK — only reached when no .tbm exists:
return TEMPLATES_DIR ? readXmlFromDisk(name) : readDataAsset(`templates/${name}.xml`)
```

Impact measured on the shipped corpus: of 44 templates carrying both formats, all are now
served from `.tbm` inference; only the 3 `.xml`-only orphans hit the fallback branch.

---

## The four phases

The single most important invariant: **one inference pass feeds everything.**
`inferFromBookmark(raw)` is called once; its result feeds *both* the tokenized XML
(`bookmarkToTemplateWorkbook`) *and* the synthesized manifest (`synthesizeManifest`). Because
both derive from the same pass, the `{{field_base_N}}` tokens in the XML and the
`template_field` keys in the manifest are guaranteed to agree.

### Phase A — Read (`templatePath.ts`)

`readBookmark(name)` returns the raw `.tbm` bytes untouched (read-only w.r.t. the user's
file). Normalization/tokenization happen downstream, never on disk.

### Phase B — Infer (`inferSlots.ts` → `inferFromBookmark`)

1. Build a `<column>` dictionary from the bookmark's embedded `<datasources>` (same
   `datatype / role / type / semantic-role` attributes `summarizeSchema` reads).
2. Collect table-calc facts.
3. Walk placements (`rows` / `cols` / `mark`), keying each on **`(base, derivation)`** via
   `pairKey = (base, d) => `${base}‖${d}``. `addRef` merges placements that share a key.
4. Decompose a placed calc into its base-column leaves at derivation `none`.
5. `tokenForBase` assigns one `{{field_base_N}}` per **distinct base** (not per slot).
6. `emit` sets each slot's `slot_id` and `required` (see slot-dedup + optionality below).

### Phase C — Emit two artifacts (from the ONE Phase-B result)

- **Tokenized workbook XML** — `bookmarkToTemplateWorkbook(raw, inf)`: the injectable
  `<workbook><worksheets><worksheet>` with donor refs replaced by `{{field_base_N}}` tokens,
  `<cards>` hoisted into the `<window>`, `{{DATASOURCE}}`/`{{TITLE}}` parameterized, and the
  `PROTECTED_ATTRS` shield preventing tokenization inside `semantic-role` / `ordering-field` /
  bare `field` refs.
- **Synthesized manifest** — `synthesizeManifest(name, inf)`: `slot_id`, `template_field`,
  `kind`, `role`, `derivation`, `required`, `hint`, and `qualified_key_required`.

### Phase D — Project to the agent (`listTemplates.ts` → `summarizeTemplate`)

`list-templates` does **not** hand the manifest through raw. It projects each slot to a
donor-free `SlotSummary` — see the projection boundary below.

---

## Slot dedup: one field, used two ways vs. two derivations

This is the load-bearing semantic. Two rules, both keyed on `(base, derivation)`:

### Rule 1 — same field, same derivation, multiple places → ONE slot

If `SUM([Sales])` is used as a filter *and* on a row *and* as a sort, that's **one slot**
applied to each place. The three placements share a `pairKey`, so `addRef` merges them; `emit`
produces a single slot whose `role` lists every shelf it lands on. Rebinding that one slot
rebinds every place the field was used — the template's internal consistency is preserved by
construction.

### Rule 2 — same field, different derivations → SEPARATE but RELATED slots

`AVG([Sales])` and `SUM([Sales])` are **different slots** — different `(base, derivation)`
keys, so `emit` produces two, with distinct `slot_id`s
(`multiDeriv ? `${baseId}_${derivation}` : baseId`). But they are **related**: both share the
*same* `{{field_base_N}}` token, because `tokenForBase` assigns tokens per distinct *base*,
not per slot.

The relatedness is what lets the agent **override one derivation independently** (bind a
different measure to `AVG` while leaving `SUM` alone) while still knowing the original template
used **one source field for both**.

When one token is shared by more than one slot (Rule 2 fired), `synthesizeManifest` sets
`qualified_key_required: true` (`tokenCount.get(templateField) > 1`). This tells the binder to
emit qualified mapping keys — `` `${template_field}@${derivation}` `` — so each derivation
binds to its own chosen field instead of colliding on the shared token.

| | Rule 1 (used the same way twice) | Rule 2 (two derivations of one field) |
|---|---|---|
| `(base, derivation)` | identical | differ |
| slots produced | **1** (roles merged) | **2** |
| `{{field_base_N}}` token | 1 (naturally) | **1, shared** |
| `qualified_key_required` | false | **true** |
| agent can rebind one place only? | no — it's one slot | **yes — per derivation** |

---

## The gap: relatedness is currently NOT surfaced to the agent

The projection boundary in `summarizeTemplate` (`listTemplates.ts:107`) deliberately
**excludes `template_field`** (and `notes`) from the agent-facing `SlotSummary`. The rationale
is sound and measured: across the shipped manifests, `template_field` is a `{{field_base_N}}`
token on only 15 of 142 bindable slots and a **concrete donor name on 127** — advertising it
would leak the donor's fields and anchor the agent's choice for a *different* dataset.

But `template_field` (the shared `{{field_base_N}}` token) is **exactly the relatedness key**
from Rule 2. With it excluded, the agent sees `AVG(Sales)` and `SUM(Sales)` as two slots whose
only shared signal is a matching `hint` (`"Sales"`) — and `hint` is advisory suggestion
metadata, not an identity assertion. Two genuinely unrelated fields could share a similar hint.

**Net:** the agent cannot currently *see* that two slots originated from one field, so it
can't make the informed "these move together unless I deliberately split them" decision the
semantics are designed to enable.

### Recommended fix (follow-up — not yet implemented)

Add a **donor-free relatedness group** to `SlotSummary` — e.g. `source_group: <int>` derived
from the shared `{{field_base_N}}` index. Slots sharing a source get the same integer; no
donor name is exposed. That satisfies all three requirements at once:

- *"different slots but related"* — same `source_group`, different `slot_id`;
- *"know the original used one field for >1 slot"* — the shared group id is the signal;
- *no leak* — an opaque integer, not `template_field`, crosses the boundary.

This keeps the projection boundary intact (donor names still never cross) while restoring the
relatedness signal the dedup semantics produce.

---

## Optionality (the `required` two-prong rule)

`emit` marks a slot `required` when **either** prong holds:

- **LOD prong** — the field participates in the level-of-detail (lands on an axis/structural
  shelf), so removing it changes what a mark *is*; or
- **Display prong** — it's the sole occupant of a display-defining encoding.

An optional categorical on rows/cols is the facet candidate that `resolveFacet` keys on; a
non-empty manifest slot set reporting zero such candidates authoritatively means "no facet"
(the structural fallback is gated off — see `facetSplice.ts`).

---

## One-glance summary

```
.tbm bytes ──readBookmark──▶ inferFromBookmark(raw)  ← the ONE pass
                                   │
              ┌────────────────────┴─────────────────────┐
              ▼                                           ▼
  bookmarkToTemplateWorkbook                    synthesizeManifest
  (tokenized injectable XML)                    (slot_id, template_field,
              │                                  kind, role, derivation,
              │                                  required, hint,
              │                                  qualified_key_required)
              │                                           │
              └───────────────▶ readTemplate ◀────────────┘ (fallback: .xml)
                                     │
                                     ▼
                          list-templates projection
                    (donor-free: slot_id, purpose, hint,
                     role, derivation — NO template_field)
                                     │
                          ⚠ relatedness signal dropped here
```
