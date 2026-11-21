---
sidebar_position: 21
---

# List Saved Data Sources

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Lists %product_name%'s Saved Data Sources (My Tableau Repository, including bundled samples like World Indicators and Sample - Superstore). Connect one by passing its `path` to `open-file`: that keeps its calculations, folders and relationships and resolves its data file.

## APIs called

Talks to the running %product_name% instance through the External Client API.

- Reads the repository location of the running instance with `GET /v<x>/app`, then lists %product_name%'s Saved Data Sources (My Tableau Repository, including bundled samples like World Indicators and Sample - Superstore) from its `Datasources` folder on the local filesystem.

## Optional arguments

### `session`

Session ID; optional if pinned or unique.

### `nameContains`

Case-insensitive substring to filter data source names (e.g. "world").
