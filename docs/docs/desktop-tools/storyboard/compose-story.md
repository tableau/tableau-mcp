---
sidebar_position: 7
---

# Compose Story

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Sets the ordered story points of a story that already exists in the workbook open in %product_name%. You name the story and between one and twelve story points, each capturing one dashboard from the same workbook; the tool reads those dashboards, requires that they all use one identical fixed size, writes that size onto the story, replaces the story's entire point list in the order you gave, and then reads the story back to confirm the points and size survived. It sets points on an existing story and never creates one.

:::warning[Destructive]
This tool is not read-only. It replaces the story's whole point list rather than appending to it, so any points already on the story are discarded — which is why a story that already carries points is refused unless you pass `replaceExisting`. It is idempotent: composing the same points at the same size onto a story that already matches makes no change and writes nothing.
:::

## APIs called

This tool acts on the workbook open in the local %product_name% instance, not on the Tableau Cloud or Tableau Server REST API. Under the hood these are calls to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version. There are no OAuth scopes: each call is authorized by the running %product_name% instance's per-session bearer token over the loopback interface.

- Resolves the story you named to a single story in the open workbook.
  - `GET /v<x>/workbook/storyboards` — list the workbook's storyboards so the name or id can be matched to one. [API reference](ext://eca/reference/index.html#tag/Storyboards/operation/listStoryboards)
- Resolves each story point's dashboard to a single dashboard in the same workbook.
  - `GET /v<x>/workbook/dashboards` — list the workbook's dashboards. [API reference](ext://eca/reference/index.html#tag/Dashboards/operation/listDashboards)
- Reads each selected dashboard's document to determine its size, which is how the tool learns whether the dashboard uses a fixed size and whether all of the selected dashboards agree on one.
  - `GET /v<x>/workbook/dashboards/{id}/document` — read one dashboard's document by id. [API reference](ext://eca/reference/index.html#tag/Dashboards/operation/getDashboardDocument)
- Reads the story's own document and composes the new point list, the shared fixed size, and the story's navigation settings into it. The composition and the preflight check that follows it both run in-process (not API calls), so a story that fails preflight never reaches %product_name%.
  - `GET /v<x>/workbook/storyboards/{id}/document` — read the story's document by id. [API reference](ext://eca/reference/index.html#tag/Storyboards/operation/getStoryboardDocument)
- Re-reads the story and every selected dashboard immediately before writing, and compares them against what preflight saw. A dashboard that was renamed, changed, or is no longer readable, or a story that changed, stops the write. This repeats the two dashboard reads and the story read listed above.
- Replaces the story with the composed document. Skipped entirely when the story already matches what would be composed.
  - `POST /v<x>/workbook/storyboards/{id}/document` — replace one storyboard from the posted document (`Content-Type: application/xml`). [API reference](ext://eca/reference/index.html#tag/Storyboards/operation/applyStoryboardDocument)
- Reads the story back after the write, repeatedly until its points and size match what was composed, and reports the result as verified only once they do.
  - `GET /v<x>/workbook/storyboards/{id}/document` — re-read the story's document to confirm the composition landed. [API reference](ext://eca/reference/index.html#tag/Storyboards/operation/getStoryboardDocument)

## Required arguments

### `storyboard`

The story whose points you are setting, given as either its name or its id. 1–255 characters, trimmed. The story must already exist in the open workbook — this tool sets points on a story rather than creating one.

#### Example

```json
{ "storyboard": "Executive Story" }
```

#### Name resolution

An exact id match is tried first, then an exact name match. A value that matches no story is reported as not found, and the message lists the available stories as `name (id)` so you can retry with a specific value. A name that matches more than one story is refused with a request to supply an id instead. A value containing XML entities (for example `&amp;`) is also matched against its decoded form.

:::note[The target must be an existing Tableau story]
The tool composes into the story's existing document rather than generating one from scratch, so it needs the structure %product_name% puts there. A document that is not a story is refused, and so is a story missing the %product_name%-authored size, navigation, or story-points container it composes into. In both cases nothing is written; create the story in %product_name% (or with [`add-storyboard`](./add-storyboard.md)) and compose into that.
:::

<hr />

### `points`

The ordered story points to set, as an array of objects. Range: 1-12 points. The array replaces the story's point list outright — position in the array is the point's position in the story — so it always describes the finished story, never an addition to it.

#### Example

```json
{
  "points": [
    { "dashboard": "Sales Overview", "caption": "Overview" },
    { "dashboard": "Regional Performance", "caption": "Regions" }
  ]
}
```

#### `points[].dashboard`

Required. The dashboard this story point captures, given as either its name or its id. 1–255 characters, trimmed. It is resolved against the dashboards in the open workbook the same way `storyboard` is resolved against the stories: id first, then name, with a not-found message that lists the available dashboards and an ambiguous-name message that asks for an id.

Every point must capture a different dashboard. Because the check compares the *resolved* dashboards, naming the same dashboard twice is caught even when one entry uses its name and the other its id, and the call is refused with `Story points must target distinct dashboards.` before anything is written.

#### `points[].caption`

Optional. The caption shown for this story point in the story's navigator. 1–80 characters, trimmed. When omitted, the resolved dashboard's own name is used as the caption.

:::note[An omitted caption inherits a length limit]
An explicit caption longer than 80 characters is rejected by the schema. An omitted one is not, so a dashboard whose name exceeds 80 characters cannot supply its own caption: the tool refuses with `Dashboard "<name>" cannot use its full name as a story point caption. Pass a shorter explicit caption, then retry.` Pass a caption for that point.
:::

#### Point order and navigation

Points are numbered from 1 in array order, and the story's navigator is set to show captions with navigation arrows. The point that was active before the composition stays active if its position still exists in the new list; otherwise the first point becomes the active one.

:::note[Every selected dashboard must use the same fixed size]
The story is composed at one fixed size, taken from the dashboards themselves, so each selected dashboard has to supply one and they all have to agree.

- A dashboard that does not use a fixed size — its size is set to any other sizing mode, or its width and height bounds disagree — is refused with `Dashboard "<name>" must use a fixed size before it can be added to this story.` A dashboard that pins equal width and height bounds without declaring a sizing mode counts as fixed.
- Dashboards that each use a fixed size but not the *same* one are refused with `All story dashboards must use the same fixed size. Resize them consistently, then retry.`

Both refusals happen before anything is written. Resize the dashboards in %product_name% so they match, then retry.
:::

## Optional arguments

### `replaceExisting`

Boolean permission to discard story points that are already on the story. Defaults to `false`.

It is only consulted when the composition would actually change the story: a story whose points and size already match what you asked for is accepted as a no-op regardless, and so is a story whose points are still %product_name%'s empty placeholder.

:::note[A populated story is refused without it]
When the story already carries story points and the composition would change them, the call is refused with `Story "<name>" already contains story points. Set replaceExisting only after an explicit rebuild/replace request.` Treat that as a prompt to confirm the intent rather than a flag to set by default — the existing points are discarded, not merged.
:::

:::note[Some populated stories are refused even with it]
Permission to replace is not permission to replace anything. A populated story that also carries layout zones bound to its existing story points cannot have those bindings rewritten safely, so it is refused with `Story "<name>" uses zone mappings tied to existing story points that compose-story cannot safely replace. Rebuild the story in %product_name% instead.` Nothing is written; rebuild that story in %product_name%, or compose into a story that has no such zones.
:::

#### Example

`true`

<hr />

### `session`
Identifier of the target %product_name% session. When omitted, the session is resolved automatically (for example, when exactly one %product_name% instance is connected).

#### Example

`"12345"`

## Notes and caveats

- **The composed story is preflighted, and only new problems block it.** Before writing, the tool checks the composed story against the story as it stands and compares the blocking problems each one has. Only problems the composition would newly introduce stop the write, so a story that already had a blocking problem can still be composed; the refusal reads `The composed story failed preflight: <detail>` and names what was introduced.
- **A story that already matches is not written to.** When the story's points, size, and navigation are already what the composition would produce, no write is issued at all and the result still reports the composition as verified. This is what makes repeating the same call safe.
- **Concurrent changes stop the write rather than overwriting them.** The story and every selected dashboard are re-read immediately before the write. A dashboard that was renamed or edited, or a story that changed, since the tool read it means the composition was planned against stale content, so the tool reports that it changed during composition and asks you to re-read and retry instead of writing. A selected dashboard that has become unreadable in the meantime is reported the same way, naming the dashboard.
- **Success is confirmed by reading the story back, not assumed.** %product_name% settles a story write asynchronously, so the tool re-reads the story until its points and size match the composition. If they never do, the tool reports that %product_name% accepted the story but its points or size did not survive the readback — read the story back yourself before retrying, since the write itself was accepted.

## Example result

```json
{
  "storyboard": "Executive Story",
  "size": { "width": 1400, "height": 1000 },
  "points": [
    { "dashboard": "Sales Overview", "caption": "Overview" },
    { "dashboard": "Regional Performance", "caption": "Regions" }
  ],
  "verified": true
}
```

The `points` echo back the *resolved* dashboard names and the captions that were actually used, so a point you selected by id, or left without a caption, comes back naming the dashboard and the caption it was given. `size` is the shared fixed size taken from those dashboards and written onto the story.

## Related

- [`add-storyboard`](./add-storyboard.md) — adds the empty story to compose into, when the target does not exist yet.
- [`apply-storyboard`](./apply-storyboard.md) — replaces a story with a document you author yourself, when the point list is not the only thing you need to change.
