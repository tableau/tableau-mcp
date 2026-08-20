---
sidebar_position: 0
---

# Tableau Knowledge Demo Charter

This document is the reference point for designing, evaluating, and presenting Tableau Knowledge
demos. It explains what the demo must prove, how that proof connects to the Tableau Knowledge Layer
PRD, and which claims are outside the current MCP implementation.

Use this charter when choosing scenarios, writing prompts, reviewing a demo, or deciding whether a
new capability strengthens the story.

## Product Thesis

AI systems produce more accurate, consistent, and explainable answers when business definitions,
scope, relationships, and provenance are explicit in a governed Knowledge Graph.

The demo must show more than an agent calling a Tableau API. It must show a material improvement in
the quality and trustworthiness of an answer because Tableau Knowledge supplied
organization-specific context that the agent otherwise did not have.

## Demo Goal

Prove that Tableau Knowledge turns an ambiguous business question into a governed answer by giving
the agent:

- The organization's approved business definition.
- The exact calculation or usage rule, when one exists.
- The scope in which that definition applies.
- Relationships to the relevant Tableau assets.
- Evidence the agent can cite when explaining its answer.

The audience should leave understanding that Tableau Knowledge reduces reliance on generic model
knowledge and prevents an agent from silently choosing a plausible but incorrect interpretation.

## PRD Outcomes Demonstrated

The demo directly supports these outcomes from the Tableau Knowledge Layer PRD:

| PRD outcome                             | What the demo must show                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| Reduce hallucinations                   | The agent refuses to invent a definition or substitute an unsupported proxy.         |
| Enforce consistent business definitions | The answer uses the semantic statement stored in the Knowledge Graph.                |
| Improve explainability                  | The agent identifies the definition, relationship, and source supporting its answer. |
| Connect fragmented knowledge            | A business concept is connected to the Tableau asset where it applies.               |
| Provide governed context to any agent   | An external agent retrieves Knowledge through Tableau MCP.                           |
| Support contextual retrieval            | The answer distinguishes organization-specific scope from generic industry meaning.  |
| Increase trust in AI outcomes           | A reviewer can inspect the evidence behind each material claim.                      |

## Primary Demonstration Pattern

Use a controlled before-and-after comparison with the same substantive business question.

### Without Tableau Knowledge

The agent may recognize common terminology, but it cannot establish:

- Which definition the organization has approved.
- Whether a generic industry definition applies here.
- Which Tableau source or business domain the definition describes.
- Whether a similarly named metric should be used instead.
- What evidence supports the answer.

The correct behavior is to acknowledge that missing context instead of presenting an unsupported
answer as fact.

### With Tableau Knowledge

The agent retrieves the governed definition and follows graph relationships to establish where it
applies. Its final answer includes the definition, formula or rule, applicable scope, and
provenance.

The difference between the two answers must be caused by Knowledge Graph evidence, not by changing
the business question or giving the answer away in the prompt.

## Current Anchor Scenario

The reference scenario asks what ACV means for Sales Cloud and how it is calculated.

Tableau Knowledge establishes that:

- ACV means Annual Contract Value.
- For this Sales Cloud source, ACV is the net increase in revenue from a customer compared with what
  the customer paid in the prior year.
- ACV represents new growth, not the full contract value.
- The governed calculation is `[Current Year Contract Value] - [Prior Year Contract Value]`.
- The ACV semantic-context node has a `DESCRIBES` relationship to the Sales Cloud published data
  source.

This scenario is effective because ACV has plausible alternative interpretations. A model could
confuse it with total contract value or related concepts such as AOV and NNAOV. Tableau Knowledge
resolves that ambiguity with an explicit definition and graph scope.

The executable presenter script is in
[Tableau Knowledge: Grounding ACV for Sales Cloud](./tableau-knowledge-acv.md).

## Evidence Chain

Every successful scenario should expose an evidence chain with four parts:

1. **Discovery:** Semantic search locates the relevant governed concept.
2. **Meaning:** A semantic statement supplies the business definition and applicable rule or
   formula.
3. **Scope:** A graph relationship establishes which asset or domain the context describes.
4. **Answer:** The agent clearly separates graph-supported facts from assumptions or missing
   context.

For the ACV scenario:

| Evidence stage | Tableau Knowledge evidence                                                            |
| -------------- | ------------------------------------------------------------------------------------- |
| Discovery      | `search-knowledge-nodes` returns the ACV semantic-context node.                       |
| Meaning        | The returned statement defines ACV and contains the exact calculation.                |
| Scope          | `get-knowledge-node-relationships` returns a `DESCRIBES` edge to the Sales Cloud PDS. |
| Answer         | The agent states the governed definition, calculation, scope, and source of evidence. |

## Core Messages

Use these messages consistently in presentations and written material:

- Tableau Knowledge provides governed meaning, not merely technical metadata.
- The Knowledge Graph tells an agent both **what a concept means** and **where that meaning
  applies**.
- Graph relationships make the answer explainable instead of relying on opaque model reasoning.
- The agent can distinguish related metrics without silently selecting a proxy.
- MCP makes this governed context available outside a single Tableau user experience.
- The graph complements the model; it does not depend on the model already knowing the organization.

A concise presenter statement is:

> The value is not that the agent found a field called ACV. Tableau Knowledge tells the agent what
> ACV means here, how this organization calculates it, where that definition applies, and what
> evidence supports the answer.

## Non-Goals and Claim Boundaries

The current demo proves governed contextual retrieval. It does not prove every capability in the
long-term PRD.

Do not claim that the current MCP implementation provides:

- General natural-language-to-SQL generation.
- Arbitrary analytical answers over underlying business data.
- Automatic graph discovery or active-graph selection.
- Complete conflict resolution across every source and scope.
- Certification or trust guarantees not present in the returned graph metadata.
- A successful underlying data query when only metadata and semantic context were retrieved.

The PRD includes broader analytical and natural-language-to-query aspirations. Those should be
described as future product scope unless a live implementation supplies direct evidence.

## Demo Design Principles

### Keep the Question Constant

Use the same substantive question before and after Knowledge is enabled. Supplying a required graph
identifier is an implementation necessity, not a change to the business question.

### Make the Improvement Causal

The improved answer must depend on information returned from Tableau Knowledge. Avoid prompts that
contain the desired definition or formula.

### Prefer Ambiguous Business Terms

Strong scenarios involve terms with multiple plausible meanings, calculations, or scopes. This makes
the value of governed context visible.

### Show Evidence, Not Just the Final Answer

Pause on the semantic statement and relationship result. The graph evidence is the product story;
the polished answer is the consequence.

### Reward Abstention

If the graph does not establish a definition, relationship, or scope, the agent should say so. A
correctly bounded answer is more valuable than a confident guess.

### Separate Metadata From Analytics

Be explicit about whether the agent retrieved a business definition or queried underlying data. Do
not let a metadata demonstration imply analytical execution.

### Keep the Demo Read-Only

The anchor demo should not invoke create or update tools. This keeps the proof focused on retrieval,
accuracy, and explainability and avoids distracting approval or mutation concerns.

## Success Criteria

A demo is successful when all of the following are true:

- The baseline does not assert an unsupported organization-specific definition or formula.
- The Knowledge-enabled path uses semantic search as its first discovery step.
- The answer reproduces the governed definition and formula accurately.
- The answer establishes scope through graph evidence rather than prompt inference.
- The answer makes its provenance understandable to the audience.
- No unsupported proxy metric is introduced.
- No write operation occurs.
- The presenter can explain which PRD outcome each proof point demonstrates.

## Evaluation Questions

Use these questions when reviewing a proposed demo:

1. What can the agent establish with Knowledge that it cannot establish without it?
2. Is that difference visible and meaningful to a business audience?
3. Which exact graph evidence supports the final answer?
4. Does the graph establish both meaning and scope?
5. Could the agent have produced the improved answer from generic model knowledge alone?
6. Does the prompt accidentally reveal the answer?
7. Are we claiming analytical execution when only metadata was retrieved?
8. What should the agent do if any required evidence is missing?
9. Which PRD objective or pain point does each stage demonstrate?
10. Can the scenario be reproduced and evaluated consistently?

## Current Constraints

- Knowledge retrieval tools currently require an explicit graph ID.
- The ACV reference graph is `16ca1f04951844e2aeb26ca744d41e85` on site `tk-demo-tdp1`.
- Graphless prompts should result in a request for the graph ID, without fallback to unrelated
  Tableau metadata tools.
- The anchor search result already carries the ACV statement, so a separate semantic-statement
  lookup is redundant and should not be part of the demo route.
- Live evals require a configured Tableau environment and an LLM endpoint and therefore remain
  outside the standard unit-test loop.

## Future Demo Evolution

Extend the story only when the underlying capabilities can be demonstrated with evidence. Useful
future stages include:

- Resolve the active graph without requiring the user to provide an ID.
- Demonstrate narrower context and scope selection across conflicting definitions.
- Show prioritization of a more specific definition over a broader one.
- Compare certified or authoritative assets with lower-trust alternatives.
- Trace lineage from a governed metric to its source fields and downstream consumers.
- Demonstrate impact analysis before changing a business definition or calculation.
- Progress from metadata questions to analytical questions when natural-language query execution is
  available through the supported product path.

Each extension should preserve the central proof: Tableau Knowledge improves agent behavior because
it supplies governed business context and inspectable evidence.

## References

- [Tableau Knowledge Layer PRD](https://docs.google.com/document/d/1MWwdlI-ffg8_sEHT6CSNe5FDno14IJCB5hJl90lYQWU/edit)
- [Tableau Knowledge MCP Tool Proposal](https://docs.google.com/document/d/1Y221zJsE19jqpVaeUW2DvVYe3NSh7fcBRvjoSNmcXy0/edit)
- [ACV Demo Script](./tableau-knowledge-acv.md)
- [Eval Test Guidance](../developers/eval-tests.md)
