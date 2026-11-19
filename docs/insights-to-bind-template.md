# Insights → quick vizzes via bind-template

Pointer for the Pulse/Chiron flow: how an insight card becomes a rendered viz in Desktop with **one deterministic tool call** — no LLM re-derivation, no XML.

## The mechanism (already shipped on `feature/desktop`)

`bind-template` maps a semantic ask + slot bindings to a rendered worksheet via checked-in **template manifests** (`src/desktop/data/template-manifests/*.manifest.json`). A confident bind is model-free and renders in ~2s. The card's `build-viz` action (already in `generate-insight-cards`' default action set) should invoke exactly this.

```jsonc
// one call renders the sheet
bind-template({
  "ask": "profit trend by month",           // used for routing/fallback
  "proposal": {
    "template": "trend-line-chart",
    "title": "Profit — monthly trend",      // ≤80 chars
    "bindings": [
      { "slot_id": "order_date", "field": "Order Date" },  // card.timeField
      { "slot_id": "sales",      "field": "Profit" }       // card.measure
    ],
    "confidence": 0.95,
    "sort": { "by": "Profit", "direction": "desc" },        // optional
    "top_n": 5                                              // optional
  },
  "auto_apply": true
})
```

Full contract: `src/tools/desktop/binder/proposalSchema.ts` (strict — unknown keys fail closed). Slot/kind vocabulary: `src/desktop/binder/manifest-types.ts`.

## Insight-card fields → slot kinds

The `InsightCard` payload maps 1:1 onto manifest slot kinds:

| Card field | Slot kind | Notes |
|---|---|---|
| `measure` | `quantitative` | default derivation comes from the manifest (usually `sum`) |
| `timeField` | `temporal` | a **string month (`YYYY-MM`) is fine** on `trend-line-chart` — `temporal_from_string` injects a DATEPARSE calc and renders a real continuous axis |
| `breakdownDimension` | `categorical` | drives bar/ranking/waterfall category slots |
| `contributors` (count) | `top_n` | "top 5 drivers" = `top_n: 5` + `sort` desc by the measure |

## Routing table: insight shape → template → bindings

Recommended launch set (all `fast_path_eligible`, live render-verified):

| Insight shape | Template | Required bindings (slot_id ← card field) |
|---|---|---|
| Trend / "X trended up 12%" (`series` present) | `trend-line-chart` | `order_date` ← timeField, `sales` ← measure |
| Single number / KPI delta (`headline`+`deltaPct`) | `kpi-text` | `value` ← measure |
| Magnitude / "biggest category" (`breakdown`) | `magnitude-simple-bar` | `category` ← breakdownDimension, `measure` ← measure |
| Top contributors / drivers (`contributors`) | `ranking-ordered-bar` | `region` ← breakdownDimension, `sales` ← measure, + `sort`/`top_n` |
| Share of total (part-to-whole) | `part-to-whole-pie-chart` | `region` ← breakdownDimension, `sales` ← measure |
| Contribution to a change (share-of-swing) | `part-to-whole-waterfall` | `sub_category` ← breakdownDimension, `profit` ← measure (sort defaults DESC by measure) |

Slot ids are historical names from each template's source workbook — treat them as opaque ids; the **kind** is the contract. 40+ templates exist across 10 families (`time-series`, `ranking`, `part-to-whole`, `correlation`, `distribution`, `deviation`, `magnitude`, `spatial`, `kpi`, `specialized`) — extend the routing table as card types grow.

For a multi-card layout, `dashboard-auto-apply` takes one `{ ask }` per card and composes them into a single dashboard in one call.

## Recommendation: make the extended bundle card carry the bind

Put the template choice + slot mapping **in the card** at generation time (the card generator already knows measure/timeField/breakdownDimension), e.g.:

```jsonc
"vizProposal": { "template": "trend-line-chart", "bindings": [...], "confidence": 0.95 }
```

Then "build a viz from this" in chat mode is a deterministic `bind-template` call with a pre-filled proposal — reproducible, ~2s, no model in the loop. Fallback: pass just `{ ask: card.headline }` and let the classifier route (still deterministic on a confident bind, escalates to propose-mode when ambiguous).

## Shared dependency: datasource resolution

Cards are generated against a **published datasource (LUID/contentUrl)**; `bind-template` binds against the **workbook's connected datasource** by live field names. The bridge is the active-sheet → datasource contentUrl/LUID resolution (basic-flow blocker 3) — the same mapping, used in both directions. Field names normally match between the published source and the workbook connection; `resolve-field` handles fuzzy/case drift.

## Code pointers

- Tool + guidance: `src/tools/desktop/binder/bindTemplate.ts`
- Shared proposal contract: `src/tools/desktop/binder/proposalSchema.ts`
- Slot/manifest vocabulary: `src/desktop/binder/manifest-types.ts`
- Manifests (one per template): `src/desktop/data/template-manifests/`
- String-month temporal support: `temporal_from_string` in the trend-line manifest (#565)
