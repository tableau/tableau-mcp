# Choosing a Custom Viz Solution

## Scope Check

- Primary audience: Tableau users (and SEs assisting them) who want a visual or interaction Tableau does not produce out of the box
- Authoring outcome improved: Solution routing — picks the right Tableau surface (native viz, an existing Tableau Exchange extension, a dashboard web page object, or a purpose-built viz extension) BEFORE any code is written, avoiding dead-ends and wasted effort
- In-scope reason: Directly improves how the agent steers a user from "I want X" to a viable, supportable Tableau implementation
- Out-of-scope risk: Not a licensing/procurement guide — Exchange extensions can require a license for Tableau Cloud/Server; surface that as a user decision, do not advise on price
- Tags: viz extension, dashboard extension, tableau exchange, web page object, custom viz, 3D, globe, solution selection, build vs buy, accelerators, webgl, native first
- Relevant user prompts/search terms: "can Tableau do 3D", "how to add a spinning globe", "custom visualization not working", "I need a chart type Tableau doesn't have", "webgl rendering blank", "build a custom extension vs use exchange", "animated or interactive viz", "network graph in Tableau", "flow diagram custom chart", "tableau native first or extension"

## When to Use

Use this guidance when a user asks for a visualization or interaction that Tableau does not offer natively — a 3D or animated chart, a spinning globe, a network/flow graph, a custom shape, an embedded web app — or asks "can Tableau do X?" for something non-standard. The goal is to route the request to the cheapest, most supportable surface that actually works, instead of immediately hand-coding something.

This applies to:

- Tableau users asking for a "wow"/custom visual the standard chart types do not cover
- SEs scoping whether a customer ask is native, an existing extension, or a build
- Any moment the agent is tempted to write custom HTML/JS before checking simpler options

## The Solution Ladder

Walk these in order and stop at the first rung that satisfies the goal.

1. **Native first.** Can a native Tableau viz, map, mark type, or calculation do it (or 80–90% of it)? Symbol/filled maps, dual-axis, custom shapes, table calcs, parameters, and density marks cover a lot of "I didn't know Tableau could do that." This is the cheapest and most supportable option, with no external dependency.
2. **Search the Tableau Exchange for an existing solution.** For genuinely novel viz, a *maintained* Viz Extension or Accelerator very likely already exists. Prefer it: it is trusted, hosted, maintained, and supported, and there is no code to own. Search before building.
3. **Embedding existing web content?** Use a dashboard **Web Page object** (a `web` zone with the URL in `param`). Good for plain HTML, an existing internal web app, or dashboard-of-dashboards. Caveat below.
4. **Build a custom Viz Extension** only when none of the above fit — you need worksheet-data binding plus custom rendering, nothing on the Exchange matches, or you need full control / offline. See the companion entry on building viz extensions.

### The WebGL portability factor (affects rungs 3 and 4)

Tableau's embedded **web page view** and the **viz-extension sandbox** cannot create a WebGL context on builds where "Enable Accelerated Graphics" is unsupported (common on VDI/VM and some Desktop builds). WebGL libraries (three.js, globe.gl) render **blank** there. Any custom 3D/"globe" visual should therefore plan to render in **2D (Canvas/SVG, e.g. d3-geo)**, which always works. Factor this into the choice between an existing extension (check how it renders) and a build.

## Best Practices

- **Lead with the recommendation, not the code.** When a user describes a custom visual, your first move is to name the right surface ("This is a great fit for a viz extension — and there may already be one on the Exchange") rather than silently producing HTML.
- **Always check native capability first.** Confirm Tableau cannot do it natively before reaching for anything custom. A surprising share of "custom" asks are a map, a dual-axis, or a parameter away.
- **Search the Exchange before building.** Treat "does a maintained extension already do this?" as a required step. Name the candidate and let the user choose.
- **Disambiguate the surfaces.** Be explicit about *viz extension* (renders the marks, bound to worksheet encodings) vs *dashboard extension* (an app in a dashboard zone) vs *web page object* (just loads a URL). Picking the wrong one wastes a cycle.
- **Raise the WebGL caveat early** when the ask is 3D — it changes both "which existing extension" and "how to build."
- **Factor in automation.** A viz extension can be installed and data-bound programmatically via the authoring API (`apply-workbook`) — the only human step for a never-trusted local extension is a one-time trust approval. When the goal is an automated or agent-driven build, this can tip the choice toward a viz extension over a hand-wired UI flow.

### When to Say No

Say no when a user wants you to hand-build and maintain a custom extension for something a trusted, maintained Exchange extension already does well.

Recommended wording:

> "We can absolutely build this, but there's already a maintained extension on the Tableau Exchange that does exactly this — using it means no code for you to host, debug, or keep working across Tableau upgrades. Want to try that first, and only build custom if it doesn't fit?"

Offer this instead:

- Point to the specific Exchange extension and note any Cloud/Server licensing as a user decision
- Reserve a custom build for cases with no good Exchange match, a hard offline requirement, or a need for full control

Also say no (set expectations) when a user wants a 3D/WebGL visual delivered through a **Web Page object** — on no-GPU builds it will render blank. Redirect to an existing 2D-based extension or a custom viz extension that renders in 2D.

## Common Mistakes

1. **Reinventing the wheel.** Jumping straight to custom HTML/JS without checking native capability or the Exchange. The office-globe build burned a full cycle on a custom web-zone globe when a maintained 3D-globe viz extension (Globe Path) already existed.
2. **Recommending a Web Page object for WebGL/3D content.** The embedded web view often has no WebGL context, so a three.js/globe.gl page loads but shows nothing. The page fetches fine (visible in server logs) yet the canvas stays blank.
3. **Treating a one-off custom extension as "free."** Ignoring the hosting, debugging, and upgrade-maintenance burden of owned code versus a maintained Exchange extension.
4. **Confusing the surfaces.** Recommending a "dashboard extension" when the user needs a worksheet-bound *viz extension*, or vice versa — each has a different data model and lifecycle.
5. **Skipping the native check.** Building or sourcing something custom for an ask that a native map, dual-axis, or parameter already covers.

## Implementation

Routing checklist the agent should run on a custom-viz ask:

1. Restate the goal in one line and ask what data drives it.
2. **Native?** Name the closest native approach; if it covers the goal, do that and stop.
3. **Existing extension?** Search the Tableau Exchange; if a maintained Viz Extension/Accelerator matches, recommend it, name it, and note Cloud/Server licensing as a user decision.
4. **Embed only?** If the user just needs to surface an existing web page, use a dashboard Web Page object — unless it relies on WebGL, in which case warn it may render blank.
5. **Build?** Only if 2–4 fail. Hand off to the viz-extension build guidance, and plan for 2D (not WebGL) rendering.

Worked example (office locations on a globe):

- "Map the offices" → **native symbol map** answered it (lat/long with City on Detail). No custom anything needed.
- "Make it a spinning 3D globe" → an existing maintained Viz Extension (**Globe Path**) already does animated arcs on a spinning globe — the right first answer.
- A **custom local viz extension** was the fallback for full control — and it had to render the globe in **2D (d3-geo), not WebGL**, because the sandbox could not create a WebGL context.

## Related Knowledge

- Extends [Building Tableau Viz Extensions](data/knowledge/tactics/viz/building-viz-extensions.md): the build-and-debug detail for rung 4, including how to reference an existing extension.
- Relates to [Workbook XML: Dashboards, Zone Layout, and Actions](data/knowledge/tactics/dashboard/zones.md): the `web` zone (`type-v2='web'`, URL in `param`) is the embed surface for rung 3.

## Source and Confidence

- Source/evidence type: field-tested (live Desktop build session) + product behavior observed
- Source: office-globe authoring session (2026-06-10) — native map, Globe Path Exchange extension, web page object, and a custom local viz extension all exercised against a live Tableau Desktop build
- Customer-identifying details removed: yes
- Confidence: field-tested
- Last reviewed: 2026-06-10
