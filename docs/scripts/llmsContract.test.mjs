import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  desktopContractPreamble,
  isToolContractPage,
  toContractMarkdown,
} from './lib/llmsContract.mjs';

describe('toContractMarkdown', () => {
  it('leaves non-tool pages intact', () => {
    const src = '# Environment Variables\n\n## `SERVER`\n\nThe URL of the Tableau server.\n';
    assert.equal(isToolContractPage(src), false);
    assert.match(toContractMarkdown(src), /## `SERVER`/);
  });

  it('drops Related, example results, argument examples, and Desktop API lede', () => {
    const src = `# List Worksheets

Lists worksheets.

## APIs called

This tool reads from the workbook open in the running Tableau Studio instance, not the Tableau Cloud or Server REST API. Under the hood these are calls to the local **Tableau Studio External Client API** — a REST API the running Tableau Studio instance serves at \`http://127.0.0.1:<port>/v<x>\`, where \`<x>\` is the latest API version. Because this API is local rather than a cloud service, it uses **no OAuth scopes**; each call is authorized instead by the running Tableau Studio instance's **per-session bearer token over the loopback interface**. A workbook must be open in the resolved Tableau Studio session.

- Reads the worksheet inventory.
  - \`GET /v<x>/workbook/worksheets\` — list worksheets.

## Optional arguments

### \`session\`

Identifier of the target Tableau Studio session. When omitted, the session is resolved automatically (for example, when exactly one Tableau Studio instance is connected or a session has been pinned).

#### Example

\`"studio-1"\`

## Notes and caveats

- **Use the id when a name is ambiguous.**

## Example results

\`\`\`json
{ "count": 3 }
\`\`\`

## Related

- [\`list-dashboards\`](./list-dashboards.md) — lists dashboards.
`;
    const out = toContractMarkdown(src);
    assert.match(out, /## APIs called/);
    assert.match(out, /GET \/v<x>\/workbook\/worksheets/);
    assert.match(out, /A workbook must be open/);
    assert.doesNotMatch(out, /127\.0\.0\.1/);
    assert.doesNotMatch(out, /External Client API/);
    assert.doesNotMatch(out, /## Related/);
    assert.doesNotMatch(out, /## Example results/);
    assert.doesNotMatch(out, /studio-1/);
    assert.doesNotMatch(out, /#### Example/);
    assert.match(out, /Optional\. Resolved automatically when omitted/);
    assert.match(out, /Use the id when a name is ambiguous/);
  });

  it('keeps a Web Tools APIs-called lede that names REST scopes', () => {
    const src = `# Query Datasource

Runs a query.

## APIs called

This tool runs its queries against the VizQL Data Service (VDS) API. The MCP-layer gate requires the \`tableau:mcp:datasource:read\` scope.

- Runs the supplied query.
  - \`POST /api/v1/vizql-data-service/query-datasource\` — execute the query.

## Required arguments

### \`datasourceLuid\`

The LUID of the data source.

#### Example

\`2d935df8-fe7e-4fd8-bb14-35eb4ba31d45\`
`;
    const out = toContractMarkdown(src);
    assert.match(out, /VizQL Data Service/);
    assert.match(out, /tableau:mcp:datasource:read/);
    assert.match(out, /datasourceLuid/);
    assert.doesNotMatch(out, /2d935df8/);
  });
});

describe('desktopContractPreamble', () => {
  it('hoists the Desktop loopback contract once', () => {
    const ect = desktopContractPreamble();
    assert.match(ect, /Shared Desktop contract/);
    assert.match(ect, /127\.0\.0\.1/);
    assert.match(ect, /### `session`/);
    assert.match(ect, /Tableau Studio/);
  });
});
