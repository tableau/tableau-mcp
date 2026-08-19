---
sidebar_position: 1
---

# Tableau Knowledge: Grounding ACV for Sales Cloud

This scenario implements the goals and boundaries in the
[Tableau Knowledge Demo Charter](./tableau-knowledge-demo-charter.md).

This demo shows how Tableau Knowledge changes an agent answer from an unsupported interpretation
into a governed, scoped, and explainable answer. It deliberately asks a metadata question, not an
analytical data question: the current Knowledge MCP tools retrieve definitions and graph context but
do not provide general natural-language-to-SQL execution.

## Claim

For the same business question, an agent without Tableau Knowledge cannot establish the
organization's definition of ACV. With Tableau Knowledge, the agent can retrieve the approved
definition, formula, and graph relationship that scopes the definition to Sales Cloud.

## Setup

| Item            | Value                                                        |
| --------------- | ------------------------------------------------------------ |
| Tableau site    | `tk-demo-tdp1`                                               |
| Knowledge graph | `16ca1f04951844e2aeb26ca744d41e85`                           |
| Required tools  | `search-knowledge-nodes`, `get-knowledge-node-relationships` |

Build the server before the demo:

```bash
npm run build
```

The local launcher reads the demo PAT from macOS Keychain. Start an MCP client with
`run-tableau-demo.local` and set:

```bash
TABLEAU_DEMO_SERVER=https://test-dataplane1.tableau.sfdc-ckzqgc.svc.sfdcfc.net
TABLEAU_DEMO_SITE=tk-demo-tdp1
TABLEAU_DEMO_INCLUDE_TOOLS=search-knowledge-nodes,get-knowledge-node-relationships
```

Do not display credentials, tokens, or Keychain output during the demo.

## Act 1: Without Knowledge

Start a fresh agent session with Tableau Knowledge tools unavailable and ask:

> Tell me what ACV means for Sales Cloud and how it is calculated. If the available evidence does
> not establish the answer, say so rather than inventing a proxy.

The expected honest answer is that the agent cannot establish the organization's Sales Cloud
definition or formula from the available evidence. A generic expansion such as "Annual Contract
Value" is not sufficient proof, and the agent must not substitute total contract value, annual order
value, bookings, or another plausible metric.

Call out the limitation: the agent may know common industry language, but it does not know which
definition this organization governs or where that definition applies.

## Act 2: With Tableau Knowledge

Start another fresh session with the Knowledge tools enabled and ask the same substantive question,
this time supplying the graph because graph discovery is not yet supported:

> Using Tableau Knowledge graph `16ca1f04951844e2aeb26ca744d41e85`, tell me what ACV means for Sales
> Cloud and how it is calculated. Use the available Tableau tools to ground your answer. Do not
> modify anything. If the graph does not establish the answer, say so rather than inventing a proxy.

The expected tool trajectory is:

1. `search-knowledge-nodes`
   - `graphId`: `16ca1f04951844e2aeb26ca744d41e85`
   - `query`: a natural-language search containing ACV, its definition or calculation, and Sales
     Cloud
   - `limit`: `10` or less for this single-term lookup
2. `get-knowledge-node-relationships`
   - `graphId`: the same graph ID
   - `nodeId`: the ACV semantic-context node returned by search

Stop after these two calls. The search result already contains the governed statement, and the
relationship result establishes Sales Cloud scope. Re-resolving the node, listing the same
statement, or searching for Sales Cloud again adds latency without adding evidence.

The grounded answer should establish:

- **Definition:** ACV, or Annual Contract Value, is the net increase in revenue from a customer
  compared with what the customer paid in the prior year. It represents new growth, not the full
  contract value.
- **Formula:** `[Current Year Contract Value] - [Prior Year Contract Value]`.
- **Scope:** The ACV semantic-context node has a `DESCRIBES` relationship to the `Sales Cloud`
  published data source.
- **Provenance:** The definition and formula came from a Tableau Knowledge semantic statement, and
  the scope came from an explicit graph edge.

An acceptable concise answer is:

> For Sales Cloud, ACV (Annual Contract Value) is the net increase in revenue from a customer versus
> what they paid the prior year, so it represents new growth rather than the full contract value.
> The governed formula is `[Current Year Contract Value] - [Prior Year Contract Value]`. Tableau
> Knowledge explicitly links this ACV definition to the Sales Cloud published data source through a
> `DESCRIBES` relationship, so no proxy metric was used.

## What To Show

Pause after each tool result and point to the evidence:

| Proof point                  | Evidence                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------- |
| Correct business meaning     | The ACV semantic statement returned by `search-knowledge-nodes`                 |
| Exact calculation            | The two governed field names in the semantic statement                          |
| Correct organizational scope | The `DESCRIBES` edge to the `Sales Cloud` PDS                                   |
| Explainability               | The answer can state which semantic context and relationship support each claim |
| Hallucination resistance     | The prompt and answer reject plausible but ungoverned proxy metrics             |

The value is not that the agent called an API. The value is that it can distinguish the governed
Sales Cloud definition from similar concepts such as AOV and NNAOV, explain why that definition
applies, and avoid silently choosing a plausible alternative.

## Success Criteria

- Without Knowledge, the agent does not assert an organization-specific definition or formula.
- With Knowledge, the first discovery call is `search-knowledge-nodes`, not Tableau content search
  or datasource metadata fallback.
- The answer reproduces the governed formula exactly.
- The answer ties ACV to Sales Cloud using graph evidence rather than inference from the prompt.
- The answer identifies Tableau Knowledge as its source and does not claim to have queried
  underlying revenue data.
- No write tool is called.

## Failure Handling

- If the graph ID is omitted, the agent should request it and make no Tableau calls. This is current
  expected behavior until graph discovery or active-graph resolution is available.
- If search does not return the ACV semantic-context node, stop and state that the graph did not
  establish the answer.
- If the relationship call does not return an edge to Sales Cloud, report the definition but do not
  claim it is scoped to Sales Cloud.
- Do not make a semantic-statement corroboration call for this scenario; the search result already
  contains the required statement.
- If authentication fails, stop rather than falling back to generic model knowledge.

## Rehearsal

Run the Knowledge routing eval after configuring the local eval environment described in
[Eval Tests](../developers/eval-tests.md). For the default fixture, `tests/.env` must target
`tk-demo-tdp1` on test-dataplane1:

```bash
npx vitest run --config ./vitest.config.eval.ts tests/eval/knowledgeAcv.test.ts
```

The eval checks routing and evidence selection against the configured live graph. It is
intentionally separate from the standard unit-test loop because it requires a Tableau site and an
LLM endpoint.
