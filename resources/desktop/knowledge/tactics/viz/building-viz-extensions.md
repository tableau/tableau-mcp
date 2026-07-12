# Building Tableau Viz Extensions

## Scope Check

- Primary audience: Tableau users / SEs building or debugging a custom Viz Extension, especially vibe-coded and loaded locally for development
- Authoring outcome improved: Get a custom Viz Extension to actually render and bind to worksheet data on the first realistic attempt — by copying a known-good reference, rendering in 2D, and getting the extension lifecycle right
- In-scope reason: Turns a custom-viz decision (see "Choosing a Custom Viz Solution") into a working extension instead of a black box
- Out-of-scope risk: Not a publishing/signing guide for the Tableau Exchange; local side-loading only. Cloud/Server deployment and licensing are separate decisions
- Tags: viz extension, trex, extensions api, local extension, d3-geo, canvas, svg, webgl, globe path, getSummaryDataReaderAsync, manifest, encoding-icon
- Relevant user prompts/search terms: "viz extension renders blank", "encoding-icon token invalid detail", "Error creating WebGL context sandbox", "await initializeAsync before first render", "local viz extension Access Local Viz Extensions", "getSummaryDataReaderAsync getAllPagesAsync", "d3-geo orthographic canvas 2D globe", "vendor libraries locally no CDN", "trex manifest xmlns extension_manifest", "apply-workbook install extension programmatically"

## When to Use

Use this guidance when building, debugging, or vibe-coding a custom Tableau **Viz Extension** — particularly when side-loading it locally during development — or when a loaded extension renders blank, errors, or won't parse its manifest. Reach this rung only after "Choosing a Custom Viz Solution" has ruled out native viz and an existing Exchange extension.

This applies to:

- Building a custom worksheet viz that binds to marks-card encodings
- Loading an unsigned, locally hosted extension via "Access Local Viz Extensions" (no Exchange registration)
- Debugging a viz extension that loads but shows nothing

## Best Practices

- **Start from a known-good reference, don't invent.** Download an existing extension's `.trex` (e.g., Globe Path) and mirror its manifest structure, namespace (`xmlns="http://www.tableau.com/xml/extension_manifest"`), `min-api-version`, and especially the **valid `encoding-icon` token values**. Then fetch the extension's hosted HTML to learn how it renders — Globe Path renders into an `<svg>` via d3-geo, which is the tell that it avoids WebGL.
- **Render in 2D (Canvas/SVG), not WebGL.** The viz-extension sandbox (like the dashboard web page view) cannot create a WebGL context on builds where "Enable Accelerated Graphics" is unsupported. three.js / globe.gl fail with "Error creating WebGL context" and render blank. Use a 2D approach — `d3.geoOrthographic` on a canvas for a globe, SVG/Canvas for other custom charts.
- **Do not gate your first paint on `initializeAsync`.** The viz-extension handshake reloads the page; if you `await tableau.extensions.initializeAsync()` before drawing, the viz stays blank. Render immediately on load with a fallback dataset, then upgrade to live data after init resolves.
- **Always ship a hardcoded fallback dataset** so the viz never renders empty during a live demo or before fields are dropped.
- **Surface errors on-screen.** The sandbox has no visible console. A small on-page status/error element turns a silent black box into a readable failure (this is exactly how "Error creating WebGL context" was diagnosed).
- **Read worksheet data via the Viz Extensions API:** `tableau.extensions.worksheetContent.worksheet.getSummaryDataReaderAsync()` → `getAllPagesAsync()`; map columns by `fieldName`; call `releaseAsync()`; re-read on `SummaryDataChanged`. Match fields by name so encoding drop-order does not matter.
- **Vendor libraries locally (no CDN) and serve over `http://localhost:PORT`.** localhost http is allowed for dev; the sandbox blocks many external CDNs. Keep all assets same-origin with the `.trex` source URL.
- **Use the local server access log as a debugger.** It shows exactly which assets the sandbox fetched — if textures/data were never requested, your render code never ran (a lifecycle bug), not a network problem.
- **The entire extension wiring is authorable through `apply-workbook` — not just the UI.** A viz-extension worksheet is ordinary workbook XML: a `<mark class='VizExtension'/>`, an `<add-in add-in-id='…' extension-url='…' instance-id='…'>`, an `<encodings>` block of `<custom custom-type-name='<manifest encoding id>' column='[ds].[<CI>]' encoding-id='{GUID}'/>` (this is how fields bind to the extension's encodings), and a top-level `<referenced-extension>` that embeds the manifest plus a `<referenced-view viewId='SheetName'/>`. All of it round-trips and renders, so an agent can install **and** data-bind an extension programmatically. Caveat: this placement vocabulary is **not** in the `.trex` — the `.trex` only declares the encoding contract — so obtain it by reading back a worksheet that already uses the extension (`get-workbook` after one UI add). This is the "steal a reference" move applied to extension *placement*.

### When to Say No

Say no (reset expectations) when a user wants a 3D/WebGL extension on a build without GPU/accelerated graphics.

Recommended wording:

> "This build can't give the extension a WebGL context, so a three.js-style 3D viz will render blank. I'll build the same thing in 2D (Canvas/SVG) so it actually shows — it'll look nearly identical and run anywhere."

Offer this instead:

- A 2D (d3-geo / Canvas) rendering of the same visual
- An existing 2D-based Exchange extension (defer to "Choosing a Custom Viz Solution")

## Common Mistakes

1. **Invalid `encoding-icon token`.** `token="detail"` (and other non-enum values) fail manifest parsing with "value 'detail' not in enumeration" (Error Code FD722608). Use tokens from a known-good `.trex` — confirmed valid: `size`, `color`, `letter-s`, `letter-t`.
2. **Using WebGL (globe.gl / three.js).** Renders blank with "Error creating WebGL context" in the sandbox. Use 2D (d3-geo / Canvas).
3. **`await initializeAsync()` before first render.** The handshake reloads the page, so the draw never happens and the viz is blank. Render first, init second.
4. **Encoding field-order bugs.** Ordered, multi-field encodings (e.g., Globe Path's Source/Target each take latitude then longitude) break silently if you swap the order — points/arcs land at lng,lat instead of lat,lng (the marks "mirror" to the wrong hemisphere). Reading by `fieldName` in your own code sidesteps this.
5. **Assuming the sandbox behaves like a browser.** CDN access and WebGL availability differ from a normal page; vendor assets locally and avoid WebGL.
6. **No fallback data / no on-screen errors.** A blank viz with no message is undebuggable in the sandbox.
7. **Expecting XML injection to bypass the trust prompt.** Installing a *never-trusted* local/network extension via `apply-workbook` still raises Tableau's one-time security/trust dialog on first load — confirmed with a brand-new extension id (cold test). Everything else automates; the first-trust click is a human gate by design. Plan for one approval, not zero.

## Implementation

Two-file recipe for a local viz extension:

1. **The web app** (`viz.html` + vendored libs): renders the viz in 2D and (optionally) reads live data.
2. **The manifest** (`.trex`): declares the extension and points `source-location` at the local URL.

Serve both over `http://localhost:PORT` and load via the extension dialog → **Access Local Viz Extensions** → pick the `.trex`. No Exchange registration is required.

Minimal manifest (mirroring a known-good reference; note valid icon tokens):

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest manifest-version="0.1" xmlns="http://www.tableau.com/xml/extension_manifest">
  <worksheet-extension id="com.local.mylviz" extension-version="0.1.0">
    <default-locale>en_US</default-locale>
    <name resource-id="name" />
    <description>My local viz</description>
    <author name="Dev" email="dev@example.com" organization="Dev" website="https://example.com" />
    <min-api-version>1.11</min-api-version>
    <source-location><url>http://localhost:8080/viz.html</url></source-location>
    <icon />
    <encoding id="latitude">
      <display-name>Latitude</display-name>
      <role-spec><role-type>continuous-measure</role-type></role-spec>
      <fields max-count="1" />
      <encoding-icon token="size" />
    </encoding>
  </worksheet-extension>
  <resources>
    <resource id="name"><text locale="en_US">My local viz</text></resource>
  </resources>
</manifest>
```

Render-first, init-second lifecycle (the fix for the blank viz):

```javascript
// 1) Draw immediately with a fallback so the page reload during the
//    extension handshake can never leave the viz blank.
try { render(FALLBACK); } catch (e) { showOnScreenError(e); }

// 2) Handshake separately; upgrade to live data once it resolves.
tableau.extensions.initializeAsync().then(async () => {
  const ws = tableau.extensions.worksheetContent.worksheet;
  const reader = await ws.getSummaryDataReaderAsync();
  const dt = await reader.getAllPagesAsync();
  await reader.releaseAsync();
  render(mapColumnsByFieldName(dt));            // match /lat/, /lon|lng/, /city|name/
  ws.addEventListener(tableau.TableauEventType.SummaryDataChanged, refresh);
}).catch(showOnScreenError);
```

Reference-driven debugging loop (how the office-globe extension was fixed):

1. Manifest won't parse → open a working `.trex` (Globe Path), copy its valid `encoding-icon` tokens.
2. Loads but black → add an on-screen error element; it reported "Error creating WebGL context."
3. Confirm the cause → fetch the working extension's HTML; Globe Path renders into `<svg>` (d3-geo), proving 2D is the path.
4. Rewrite the renderer in 2D (d3-geo orthographic on canvas) → globe renders in the sandbox.
5. Check the local server access log to confirm which assets the sandbox actually requested when isolating render-order vs network issues.

API-authoring the placement (confirmed via `apply-workbook`, zero UI clicks except first-time trust):

```xml
<!-- inside the worksheet's <pane> -->
<mark class='VizExtension' />
<add-in add-in-id='com.local.myviz' extension-url='http://localhost:8080/viz.html'
        extension-version='0.1.0' instance-id='A1B2C3D4E5F6...'>
  <instance-settings />
  <type-settings><worksheet /></type-settings>
</add-in>
<encodings>
  <custom column='[federated.xxxx].[avg:Latitude:qk]'  custom-type-name='latitude'  encoding-id='{GUID-1}' />
  <custom column='[federated.xxxx].[avg:Longitude:qk]' custom-type-name='longitude' encoding-id='{GUID-2}' />
  <custom column='[federated.xxxx].[none:City:nk]'     custom-type-name='label'     encoding-id='{GUID-3}' />
</encodings>
```

Plus a top-level `<referenced-extensions><referenced-extension>` embedding the same manifest as the `.trex` and `<referenced-view instances='1' viewId='<sheet>'/>`. `custom-type-name` must equal the manifest's `<encoding id>`. Confirmed: a from-blank worksheet wired this way renders and reads live data; a never-seen extension id installs the same way, gated only by the one-time trust dialog.

## Related Knowledge

- Extends [Choosing a Custom Viz Solution](data/knowledge/personalization/choosing-a-custom-viz-solution.md): this is the build detail for rung 4 of that ladder.
- Relates to [Workbook XML: Dashboards, Zone Layout, and Actions](data/knowledge/tactics/dashboard/zones.md): the dashboard `web` zone is the simpler embed alternative when worksheet-data binding is not needed.

## Source and Confidence

- Source/evidence type: field-tested (live Desktop build session) + product behavior observed
- Source: office-globe custom viz extension build (2026-06-10) — manifest token enum, WebGL-context failure, render-before-initialize lifecycle, and `getSummaryDataReaderAsync` data binding all observed against a live Tableau Desktop build, using Globe Path's `.trex` and hosted HTML as the reference; plus a cold test (never-trusted extension id `com.local.coldglobe`) confirming full install + data-bind via `apply-workbook`, gated only by Tableau's one-time trust dialog
- Customer-identifying details removed: yes
- Confidence: field-tested
- Last reviewed: 2026-06-10
