// The canonical, server-side source of truth for the "build a data app" workflow. Served as the
// MCP resource `skill://tableau/build-data-app` (see buildDataAppResource.ts). Any client-specific
// adapter (e.g. the .claude skill) should point here rather than duplicating this guidance.
export const buildDataAppSkill = `# Build a Data App

## What this is

A workflow for turning a business question into a small, self-contained, static data app backed by
real Tableau data — and, when the user wants it, publishing that app to their Tableau site.

This guidance starts at **intent and authoring**, not at picking a datasource first. Decide what the
user is trying to see, then discover and query whatever data supports that.

## Static data only

**The data app is a static snapshot of the rows you queried.** It renders the exact data you
retrieved; it does not run its own queries against Tableau at view time. There is no live VizQL Data
Service connection inside the shipped app, no runtime credential or viewer-identity forwarding, and
no external deployment step of any kind — the app is packaged and published as-is. If the underlying
data changes, produce a new app from a fresh query; do not promise "live" or "refreshing" behavior.

## 1. Detect intent

Build a data app when:
- The user asks to "chart", "visualize", "build a dashboard", or "publish this to Tableau".
- You are about to return multi-row data with at least one numeric/measure column and a visual would
  clearly help the user understand it.

Skip it when:
- The answer is a single-value lookup, an empty result, or an error — there is nothing to visualize.
- The user only wants raw rows or a text answer and has not signaled interest in a visual.

Do not force every qualifying query into a data app automatically. Use judgment: a quick numeric
answer in chat can be the right response even when a chart would technically be possible.

## 2. Query freely — the model decides how much

Use the Tableau discovery and query tools (for example datasource listing, metadata, and query
tools) to ground the app in real data. You — not this guide — decide:
- how many queries to run,
- which fields, aggregations, and filters answer the question,
- whether one query is enough or the question needs several.

Never invent or assume data. Every value the app renders should trace back to a tool result you
actually received.

## 3. Create a workspace and write files once

Create a workspace for the app and write its source files in a single authoring pass rather than
trickling out edits one line at a time. Embed the data you queried directly in the app's source (for
example as an inline JavaScript/JSON constant) — the shipped package carries its own data and makes
no external or live-data calls when it runs.

There is no required file layout, chart count, KPI-card requirement, or color palette. A good app is
whatever set of files clearly answers the user's question with the data you retrieved — that can be a
single chart, a small dashboard, or something else entirely, at your discretion.

## 4. Render and stop for visual review

After writing the workspace, render it (or otherwise present it) so a person can actually look at it,
then stop. Do not silently continue on to validation or publication. This is a deliberate checkpoint —
the user should see the app before anything downstream happens to it.

## 5. Iterate by updating the workspace

If the user wants changes — a different chart, a different breakdown, different data — update the
existing workspace's files rather than starting over or restating unrelated content. Re-render and
stop for review again after each round of changes.

## 6. Validate the final workspace

Once the user is happy with what they see, validate the workspace with the package-validation tool
before offering to publish. A clean validation result is a precondition to publish — it is not a
substitute for the human visual review in step 4. Validation catches structural, size, and
missing-asset problems; it says nothing about whether the app is the right app.

If validation reports problems, fix the workspace and validate again.

When validation succeeds, preserve the returned \`validationId\` exactly as returned. That
\`validationId\` is the receipt for the immutable package that was validated; do not discard,
rewrite, or replace it with the workspace ID or source content.

## 7. Ask explicitly before publishing

Never auto-publish. Ask, in plain language, whether the user wants this app published to their
Tableau site — publishing creates content there, and that is the user's decision, not yours. Silence,
a thumbs-up on the preview, or "looks good" is not consent to publish; get a clear yes to publishing
specifically. If the answer is no, or there is no clear yes, stop — the validated workspace can sit
untouched with nothing lost.

## 8. Publish only the validation receipt

On an explicit yes, pass the preserved \`validationId\` as the \`validationId\` input to the publish
tool. Never re-send the app's source content at publish time, and never publish a workspace that has
not just been validated. Publishing consumes that exact receipt so the bytes that go live are
exactly the bytes that were reviewed and validated, with no chance of drift between what the user
approved and what gets published.

On success, surface the returned canonical URL verbatim — do not rewrite, shorten, or substitute the
host — and report any non-fatal warnings from validation or publishing.
`;
