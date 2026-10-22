# Tableau Exchange discovery

The Exchange build provides discovery of published Gallery catalog listings through four read-only
MCP tools, plus one tool that downloads a listing's package file. It supports AI Skills (`skill`),
dashboard extensions (`extension`), viz extensions (`viz`), connectors (`connector`) and
accelerators (`accelerator`). It runs over stdio independently of Tableau Server authentication and
Tableau Desktop discovery.

## Build and configuration

Use the repository's installed dependencies and Node.js version required by `package.json` (at least
22.7.5):

```powershell
npm run build:exchange
$env:GALLERY_API_BASE_URL = 'https://your-gallery-api.example/'
$env:EXCHANGE_WEB_BASE_URL = 'https://your-matching-exchange.example/'
$env:EXCHANGE_CATALOG_SOURCE = 'gallery-api'
$env:EXCHANGE_LOCALE = 'en_US'
$env:TRANSPORT = 'stdio'
node build/index.exchange.js
```

Both URLs are required. Configure the Gallery API and its matching Exchange website explicitly so
listing links point to the correct environment. Remote URLs require HTTPS; HTTP is accepted only on
loopback for local development. URLs must have no credentials, query or fragment. A simple API path
prefix is supported. The locale defaults to `en_US` and is normalized to Gallery's lowercase
underscore format, for example `en_us` or `fr_fr`; unsupported locales are rejected.

`TRANSPORT` and `MCP_TRANSPORT`, when set, must both be `stdio`. HTTP transport is outside this MVP.
No Tableau Server, site, PAT or Desktop session configuration is required.

An MCP client configuration can launch the built server directly. Replace the paths and hosts with
the environment you are using:

```json
{
  "mcpServers": {
    "tableau-exchange": {
      "command": "node",
      "args": ["D:\\dev\\tableau-exchange-1\\tableau-mcp\\build\\index.exchange.js"],
      "env": {
        "GALLERY_API_BASE_URL": "https://your-gallery-api.example/",
        "EXCHANGE_WEB_BASE_URL": "https://your-matching-exchange.example/",
        "EXCHANGE_CATALOG_SOURCE": "gallery-api",
        "EXCHANGE_LOCALE": "en_US",
        "TRANSPORT": "stdio"
      }
    }
  }
}
```

## Tools

| Tool                       | Input and behavior                                                                                                                                                                                                                                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search-exchange-assets`   | `query` plus optional `assetTypes`, canonical `tags`, `publisher`, `tableauVersion`, `communityContent` and `limit`. Filters run before deterministic local ranking. Default five results, maximum ten or the lower configured limit. Every requested tag must match. Empty query is allowed only with a meaningful filter. |
| `get-exchange-asset`       | One positive integer `productId` returned by the catalog. Reads the listing and safe typed details; membership in the published catalog is required.                                                                                                                                                                        |
| `compare-exchange-assets`  | Two to four distinct `productIds`, preserving input order. Compares reported listing metadata and leaves unknown values null.                                                                                                                                                                                               |
| `list-exchange-categories` | Optional `assetType` and `tagType`. Returns canonical tags and asset counts with scope `published-used`; unused configured categories are omitted.                                                                                                                                                                          |
| `download-exchange-asset`  | One catalog `productId`. Saves the listing's package to `EXCHANGE_DOWNLOAD_DIR/{id}/` and returns the path, size and SHA-256. Not read-only: it is annotated `readOnlyHint: false`, so clients ask before running it.                                                                                                       |

Results contain `structuredContent` and readable text, each with `data` and `meta`. Metadata
identifies the source, cache age, catalog size, partial/missing/stale product types and warnings.
`Free` and `Viz Free` are different canonical tags even when their display labels both say Free. Use
canonical names from the category tool as search filters.

Catalog text is untrusted listing data. No tool installs, opens or executes assets. Current Gallery
Skill details do not supply package versions, permissions, executable tools, model support,
evaluations or verified compatibility: Skill `technicalMetadataStatus` is `unavailable`. A reported
minimum Tableau version is a listing field, not a runtime compatibility certification. Connectors,
accelerators and extensions may expose available allowlisted descriptive details; package manifests,
signed download URLs and driver artifacts are excluded.

API discovery does not depend on the website feature flag. Skill listing links render only when the
matching Exchange website enables `skillsExchange`; pointing to a different website or a website
with the flag disabled does not establish that a Skill page works.

## Downloads

`download-exchange-asset` calls Gallery's existing anonymous route `POST /products/{id}:download`,
the same one Exchange uses, which streams the file and records one download (a row in `download` and
an incremented download count). The request is not retried, so a failure never counts twice.

| Type                | Package   | Check before saving      |
| ------------------- | --------- | ------------------------ |
| Skill               | `.tskill` | ZIP signature            |
| Dashboard extension | `.trex`   | XML `<manifest>` element |
| Viz extension       | `.trex`   | XML `<manifest>` element |
| Connector           | `.taco`   | ZIP signature            |
| Accelerator         | `.twbx`   | ZIP signature            |

- Only catalog members can be downloaded. Files are capped at 200 MB and saved as
  `{id}/{listing-name}.{extension}`; the listing name is reduced to `a-z0-9-` and never chooses the
  directory. A file that does not match its type's format is not saved.
- Files go to `EXCHANGE_DOWNLOAD_DIR`, an absolute path that defaults to
  `~/Downloads/tableau-exchange`. They are written to a `.part` file first, then renamed.
- Each response includes `nextStep`, a fixed instruction for the package type (for example, open a
  `.twbx` in Desktop or copy a `.taco` into `My Tableau Repository/Connectors`), plus the listing's
  `installationInstructions` when Gallery has them (currently connectors only; Skill listing text
  stays withheld with other Skill technical details).
- The tool never opens, extracts, installs or runs a package. A `.trex` is a manifest pointing to
  the publisher's hosted extension, and most connectors also need a database driver from the
  publisher's site (`driver_download_url`), which is not downloaded.

## Declared fixture demo

The fixture demo requires no live Gallery service. In one PowerShell window, from the repository
root:

```powershell
node docs/scripts/demo-exchange-gallery.mjs 3928
```

In another window, configure the Exchange server and launch it through your MCP client:

```powershell
$env:GALLERY_API_BASE_URL = 'http://127.0.0.1:3928/'
$env:EXCHANGE_WEB_BASE_URL = 'https://fixture.exchange.invalid/'
$env:EXCHANGE_CATALOG_SOURCE = 'declared-fixture'
$env:EXCHANGE_LOCALE = 'en_US'
$env:TRANSPORT = 'stdio'
node build/index.exchange.js
```

Use the same environment entries in the MCP JSON configuration when your client launches the
process. The fixture website host is deliberately an `.invalid` domain; its listing links are
provenance examples, not working public pages. Keep `EXCHANGE_CATALOG_SOURCE=declared-fixture` for
this demo. The fixed fixture file contains twelve invented listings: seven Skills, two dashboard
extensions and one each of viz extension, connector and accelerator.

Call the tools through the MCP client with these arguments:

| Demo step                      | Tool arguments                                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Find dashboard export listings | `search-exchange-assets` with `{"query":"export dashboard","assetTypes":["extension","viz"],"limit":5}`                                                            |
| Browse each of the five types  | Repeat `search-exchange-assets` with `{"query":"","assetTypes":["skill"],"limit":10}`, replacing `skill` with `extension`, `viz`, `connector`, then `accelerator`. |
| Read an export listing         | `get-exchange-asset` with `{"productId":2000}`                                                                                                                     |
| Compare export extensions      | `compare-exchange-assets` with `{"productIds":[2001,2000]}`                                                                                                        |
| Inspect Skill taxonomy         | `list-exchange-categories` with `{"assetType":"skill","tagType":"category"}`                                                                                       |
| Browse a Skill category        | `search-exchange-assets` with `{"query":"","assetTypes":["skill"],"tags":["Build and Design"]}`                                                                    |
| Inspect safe connector detail  | `get-exchange-asset` with `{"productId":4000}`                                                                                                                     |

The Skill category fixture covers Data and Model, Analysis Support, Calc Family, Build and Design,
Content Quality, Publish and Deploy, and Meta. Those seven categories are present because fixture
listings use them; this does not prove that every category has a published listing in a live
environment. IDs, names, counts and links in this section are declared fixtures.

The demo reads only `scripts/fixtures/exchange-products.json` and binds to loopback. It serves
`GET /products`, `GET /products/{id}`, `GET /tags` and `POST /products/{id}:download` (a generated
`.tskill` for Skills, 404 for other types), rejecting other mutations and routes. Its list responses
use Gallery's `items` envelope and select the global type page before the community partition. The
request history keeps only the last 1,000 requests. Stop the demo with Ctrl+C.

### Catalog snapshot with seeded Skills

To demo against real listings plus Skills that are not yet published, snapshot a live Gallery API
and layer invented listings over it. The snapshot is git-ignored; regenerate it when needed:

```bash
node docs/scripts/snapshot-exchange-catalog.mjs https://development.galleryapi.tabint.net/ scripts/fixtures/exchange-dev-snapshot.json
node docs/scripts/demo-exchange-gallery.mjs 3928 scripts/fixtures/exchange-dev-snapshot.json scripts/fixtures/exchange-demo-skills.json
```

Then launch the MCP with `GALLERY_API_BASE_URL=http://127.0.0.1:3928/`,
`EXCHANGE_WEB_BASE_URL=http://127.0.0.1:3928/web/` and `EXCHANGE_CATALOG_SOURCE=declared-fixture`.

- Later catalog files override earlier ones by product ID. `exchange-demo-skills.json` holds ten
  invented Skills (IDs from 900000, Skill category tags from 900100) so they never collide with live
  IDs.
- Listing links resolve on the fixture server. Snapshot products redirect to the live listing
  (`listingRedirectBase`, default `https://exchange.tableau.com/`; dev IDs match production); seeded
  listings get a local page marked as a demo listing.
- Catalog files are reread when they change on disk, so adding a listing to the seed file
  "publishes" it at the next MCP catalog refresh (within `CATALOG_CACHE_TTL_SECONDS`).
- Skill technical metadata stays `unavailable` by design until Gallery reports Skill details.
- Downloads of snapshot listings are forwarded to the Gallery API recorded in the snapshot's
  `snapshotOf` (dev in the example above), which returns the real file and records a download there.
  Seeded Skills get a generated demo `.tskill`: a ZIP holding one `SKILL.md` built from the listing.
  Other fixture listings have no file.

## Backend reuse, ranking and cache

The MCP reuses existing Gallery routes (catalog GETs and the download POST) without new API
endpoints or backend edits. It requests both community partitions at each page offset because
`include_community` selects a partition. Digest `total` and `next` are not reliable completion
signals; ingestion uses merged page cardinality, bounded pages/assets and duplicate/no-progress
guards. Catalog members gate detail reads.

Normalization, hard filters, stable weighted text scores, factual match reasons and caching reside
in MCP. Results sort by score, downloads, normalized name and numeric ID.

Scoring keeps the design weights (exact name 120, name phrase 80, tag phrase 60, description phrase
45, per-token name 20 / tag 15 / description 8, all tokens matched 15) with three adjustments:

- Per-token points are scaled by a BM25-style IDF over the loaded catalog, normalized so a word on a
  single listing weighs 1. Words on many listings, such as `data`, `salesforce` or `chart`, score
  less, and their reasons are marked `(common term)`.
- Publisher names score 5 per token only when the whole query is a phrase in the publisher name, so
  first-party listings are not boosted by an incidental `tableau` or `salesforce`.
- Word matching folds simple English plurals (`maps` matches `map`, `categories` matches
  `category`).
- A small curated map (`src/exchange/catalog/synonyms.ts`) adds related catalog words for common
  phrasings, for example `flow chart` → `sankey`, `process`, `network`. Each related word scores its
  best field (name 20, tag 15, description 8) times its IDF weight. The best related word counts
  fully and each additional one at a quarter, since they usually describe the same concept; the
  total is capped at 20 and never counts toward the all-tokens bonus. Reasons read
  `Related term match: sankey (via "flow chart")`.

A result needs at least one name, tag or description match, or a publisher phrase match.

The process-memory catalog loads when the server starts and refreshes in the background every
`CATALOG_CACHE_TTL_SECONDS` (default 300), with one shared refresh at a time. Detail reads use a
bounded cache. Failed refreshes may retain prior data with explicit stale/partial metadata; no
persistent cache is required.

| Setting                      | Default                        | Allowed range |
| ---------------------------- | ------------------------------ | ------------- |
| `CATALOG_CACHE_TTL_SECONDS`  | 300                            | 1–3,600       |
| `GALLERY_API_TIMEOUT_MS`     | 5,000                          | 1–60,000      |
| `PRODUCT_PAGE_SIZE`          | 1,000                          | 2–1,000       |
| `MAX_SEARCH_RESULTS`         | 10                             | 1–10          |
| `MAX_CATALOG_PAGES_PER_TYPE` | 100                            | 1–100         |
| `MAX_CATALOG_ASSETS`         | 10,000                         | 1–10,000      |
| `DETAIL_CACHE_MAX_ENTRIES`   | 500                            | 1–500         |
| `EXCHANGE_DOWNLOAD_DIR`      | `~/Downloads/tableau-exchange` | Absolute path |

The fixture path demonstrates the local contract and MCP interoperability. A live Gallery run,
published Skill census, matching website rendering and selected Agent client smoke require separate
environment validation. Production API migration, new catalog endpoints, hosting, HTTP transport and
service authentication hardening remain deferred.
