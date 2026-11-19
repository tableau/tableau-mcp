# Insights → quick vizzes via bind-template

Pointer for the Pulse/Chiron flow: how an insight card becomes a rendered viz in Desktop with **one deterministic tool call** — no LLM re-derivation, no XML.

## The mechanism (already shipped)

`bind-template` maps a semantic ask + slot bindings to a rendered worksheet via checked-in **template bookmarks** (`src/desktop/data/templates/*.tbm`). Slots are inferred from each bookmark's own structure by `src/desktop/templates/inferSlots.ts`. A confident bind is model-free and renders in ~2s. The card's `build-viz` action (already in `generate-insight-cards`' default action set) should invoke exactly this.

```jsonc
// one call renders the sheet
bind-template({
  "ask": "profit trend by month",           // used for routing/fallback
  "proposal": {
    "template": "trend-line-chart",
    "title": "Profit — monthly trend",      // ≤80 chars
    "bindings": [
      { "slot_id": "field_base_1", "field": "Profit" },     // card.measure
      { "slot_id": "field_base_2", "field": "Order Date" }, // card.timeField
      { "slot_id": "field_base_3", "field": "Region" }      // card.breakdownDimension
    ],
    "confidence": 0.95,
    "sort": { "by": "Profit", "direction": "desc" },        // optional
    "top_n": 5                                              // optional
  },
  "auto_apply": true
})
```

Full contract: `src/tools/desktop/authoring/binder/proposalSchema.ts` (strict — unknown keys fail closed). Slot/kind vocabulary: `src/desktop/binder/manifest-types.ts`.

## Insight-card fields → slot kinds

The `InsightCard` payload maps 1:1 onto template slot kinds:

| Card field | Slot kind | Notes |
|---|---|---|
| `measure` | `quantitative` | default derivation comes from the template (usually `sum`) |
| `timeField` | `temporal` | a **string month (`YYYY-MM`) is fine** on `trend-line-chart` — `temporal_from_string` injects a DATEPARSE calc and renders a real continuous axis |
| `breakdownDimension` | `categorical` | drives bar/ranking/waterfall category slots |
| `contributors` (count) | `top_n` | "top 5 drivers" = `top_n: 5` + `sort` desc by the measure |

## Routing table: insight shape → template → bindings

Recommended launch set (all `fast_path_eligible`, live render-verified):

| Insight shape | Template | Required bindings (slot_id ← card field) |
|---|---|---|
| Trend / "X trended up 12%" (`series` present) | `trend-line-chart` | `field_base_1` ← measure, `field_base_2` ← timeField, `field_base_3` ← breakdownDimension (line color) |
| Single number / KPI delta (`headline`+`deltaPct`) | `kpi-text` | `field_base_1` ← measure |
| Magnitude / "biggest category" (`breakdown`) | `magnitude-simple-bar` | `field_base_1` ← breakdownDimension, `field_base_2` ← measure |
| Top contributors / drivers (`contributors`) | `ranking-ordered-bar` | `field_base_1` ← breakdownDimension, `field_base_2` ← measure, + `sort`/`top_n` |
| Share of total (part-to-whole) | `part-to-whole-pie-chart` | `field_base_1` ← breakdownDimension, `field_base_2` ← measure |
| Contribution to a change (share-of-swing) | `part-to-whole-waterfall` | `field_base_2` ← breakdownDimension, `field_base_1_sum` and `field_base_1_none` ← measure (sort defaults DESC by measure) |

Slot ids are structural tokens inferred from each bookmark: `field_base_N`, or `field_base_N_<derivation>` when one field is placed at more than one derivation. They carry no meaning; the **kind** is the contract. 137 templates exist across 10 families (`time-series`, `ranking`, `part-to-whole`, `correlation`, `distribution`, `deviation`, `magnitude`, `spatial`, `kpi`, `specialized`) — extend the routing table as card types grow.

For a multi-card layout, build each card's worksheet, then call `run-dashboard-batch` with the staged `artifactIds` or the live `existingWorksheetNames`/`kpiWorksheetNames`.

## Recommendation: make the extended bundle card carry the bind

Put the template choice + slot mapping **in the card** at generation time (the card generator already knows measure/timeField/breakdownDimension), e.g.:

```jsonc
"vizProposal": { "template": "trend-line-chart", "bindings": [...], "confidence": 0.95 }
```

Then "build a viz from this" in chat mode is a deterministic `bind-template` call with a pre-filled proposal — reproducible, ~2s, no model in the loop. Fallback: pass just `{ ask: card.headline }` and let the classifier route (still deterministic on a confident bind, escalates to propose-mode when ambiguous).

## Shared dependency: datasource resolution

Cards are generated against a **published datasource (LUID/contentUrl)**; `bind-template` binds against the **workbook's connected datasource** by live field names. The bridge is the active-sheet → datasource contentUrl/LUID resolution (basic-flow blocker 3) — the same mapping, used in both directions. Field names normally match between the published source and the workbook connection; `resolve-field` handles fuzzy/case drift.

## Code pointers

- Tool + guidance: `src/tools/desktop/authoring/binder/bindTemplate.ts`
- Shared proposal contract: `src/tools/desktop/authoring/binder/proposalSchema.ts`
- Slot vocabulary: `src/desktop/binder/manifest-types.ts`
- Templates (one bookmark per template): `src/desktop/data/templates/`
- Slot inference: `src/desktop/templates/inferSlots.ts`
- String-month temporal support: `src/desktop/binder/stringTemporal.ts`
