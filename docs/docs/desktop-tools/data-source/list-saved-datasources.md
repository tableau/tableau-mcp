---
sidebar_position: 21
---

# List Saved Data Sources

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Lists %product_name%'s Saved Data Sources (My Tableau Repository, including bundled samples like World Indicators and Sample - Superstore). Connect one by passing its `path` to `open-file`: that keeps its calculations, folders and relationships and resolves its data file.

## APIs called

This tool makes one call to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version. There are no OAuth scopes: the call is authorized by the running %product_name% instance's per-session bearer token over the loopback interface. No workbook needs to be open.

- Reads the repository location and locale of the running instance.
  - `GET /v<x>/app` — read the application information of the running instance. [API reference](ext://eca/reference/index.html#tag/Application/operation/getApp)
- Scans the `Datasources` folder of that repository for `.tds` and `.tdsx` files. Local filesystem; no API call. When %product_name% reports no repository, the `TABLEAU_REPOSITORY_DIR` environment variable is used instead.

## Optional arguments

### `session`

Session ID; optional if pinned or unique.

### `nameContains`

Case-insensitive substring to filter data source names (e.g. "world").

## Notes and caveats

- **Only the newest built-in samples are listed.** Older releases leave their sample folders behind, so only the newest sample version is kept, and the folder for %product_name%'s locale is preferred. Your own saved data sources are listed first, then the samples, each sorted by name.
- **An empty result carries a message.** When nothing is found, the result includes `No saved data sources found under "<repositoryLocation>".`, or `No saved data sources found.` when no repository location is known.

## Example result

```json
{
  "repositoryLocation": "/Users/me/Documents/My Tableau Repository",
  "datasources": [
    {
      "name": "Regional Sales",
      "path": "/Users/me/Documents/My Tableau Repository/Datasources/Regional Sales.tds",
      "fileType": "tds",
      "builtInSample": false
    },
    {
      "name": "Sample - Superstore",
      "path": "/Users/me/Documents/My Tableau Repository/Datasources/2026.1/en_US/Sample - Superstore.tds",
      "fileType": "tds",
      "builtInSample": true
    }
  ]
}
```
