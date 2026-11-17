# Native Prep authoring with compact YAML

Two optional tools prepare compact YAML and generate new native Prep files:

- `prepare-prep-flow-edit` starts a new YAML project, exports a local TFL/TFLX, or downloads an
  authorized published flow.
- `generate-prep-flow` validates a preview, then releases its exact reviewed bytes as a new
  TFL/TFLX.

The generator, strict metadata validation, schema defaults, bounded file handling and credential
policy are ported from the existing `ghidra-prep` implementation to TypeScript/Node.js. Strict Zod
models and non-mutating Ajv validation retain the original native document, including unknown
fields. The migration manifest maps every former Python function/class to its Node responsibility
and retains source hashes and the original uncommitted-snapshot provenance. This is the
short-ID/external-resource format, not an unrelated edit-plan format. No Tableau binaries are
bundled.

## Enable in self-hosted stdio

The feature is disabled by default. Configure the MCP process with:

| Variable                   | Meaning                                                                                                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PREP_AUTHORING_ENABLED`   | Set exactly `true` to opt in.                                                                                                                               |
| `PREP_AUTHORING_WORKSPACE` | Existing dedicated local directory containing the selected flows/data and owned cache projects. On Windows choose a short path, such as `C:/PrepWorkspace`. |

The existing Node.js runtime runs a self-contained bundled worker. No Python interpreter, Python
packages, subprocess, native Tableau binaries or extra runtime setup is required. The normal Tableau
server/auth configuration is still needed to start the existing web MCP server. Windows verification
uses a short workspace because deeply nested paths can exceed platform limits; Mac/Linux execution
has not been verified.

HTTP cannot register or execute these tools. The dedicated MCP scope is `tableau:mcp:prep:author`.
Published origins additionally follow `FLOW_READ_TOOLS_ENABLED`, current resource restrictions, and
standard native download permission with `tableau:flows:download`, `tableau:flows:read` and
`tableau:mcp_site_settings:read`. Local/new projects make no Tableau requests. Flow Document API or
its experimental flag is not needed here.

## Prepare, edit, preview, generate

For an existing local file:

```json
{
  "source": { "type": "local", "path": "flows/sales.tflx" },
  "format": "tflx",
  "resources": ["data/new-values.json"]
}
```

Paths are relative to the configured workspace. Use `{"type":"published","flowId":"<flow LUID>"}`
for a published snapshot, or `{"type":"new"}` to create starter YAML and sample CSV without an
existing native file. Optional `resources` imports up to 20 selected file/JSON resources under
`user-resources/`; the response gives their relative names and fingerprints, not row data. CSV, TSV,
XLS/XLSX, JSON, Hyper/TDE and text resources are accepted.

Edit the returned complete `yaml`, then call `generate-prep-flow` with its `sourceHandle`, that
YAML, `format`, `target` (`builder`, `cloud` or `server`) and `mode="preview"`. Inspect `valid`, any
error paths and `compatibility`. To generate, send the same YAML/format with `mode="generate"` and
the successful `expectedPreviewSha256`.

The native artifact is returned as a workspace-relative path plus byte count/SHA256. It is a new
local file; no source is overwritten and nothing is published or run. Previews also create private
local candidate files, so both tools are annotated as non-destructive local writes rather than
read-only calls.

A TFL still depends on its external files at the saved paths. Retain the matching project resources
when moving outputs or cleaning caches; copying only the TFL does not carry those files. TFLX embeds
the declared attachments when the YAML packaging settings are consistent.

The prepared source is an immutable snapshot. Its base/resources and the reviewed candidate are
fingerprinted. A fresh published-resource authorization check precedes later use, but server
revisions are not automatically merged or assumed current. Prepare again for a newer source. Modify
YAML through the tool argument; editing its private base files invalidates the handle. To change a
large externalized value list, import a replacement JSON resource or inline the edited values in
YAML.

## Compact authoring format

The migrated `tableau-prep-flow/v1` format supports only three custom declarative tags:

- `!id name` preserves a saved UUID mapping or generates a stable UUID from the project
  namespace/name.
- `!include relative.json` restores unchanged metadata/value lists from project resources.
- `!path relative.csv` binds a selected file within that private project.

Native export preserves the saved ID map and metadata, externalizes `values` arrays/objects of at
least 1,024 bytes, and retains display/compatibility metadata and attachments in resources. Exact
UUID values/keys are shortened; arbitrary text and calculation strings are not rewritten. New
projects use schema-declared defaults. Unknown retained attributes are not silently dropped.
Changing TFL/TFLX packaging may require matching YAML/connection/resource edits; a suffix change
does not authorize dropping data.

The historical sizing report used `o200k_base` on the `flow` text of 12 samples before the generator
was implemented:

| Representation                                         |  Tokens | Relative to JSON |
| ------------------------------------------------------ | ------: | ---------------: |
| Original JSON                                          | 393,456 |         Baseline |
| Direct full YAML                                       | 425,606 |    About 8% more |
| Short IDs plus externally referenced large value lists |  88,295 |  About 78% fewer |

The eight samples without large value lists showed about 46% fewer tokens with short-ID YAML. These
are reported historical representation estimates, not a benchmark of this PR, every tokenizer/model
or total request/cost. Direct YAML conversion alone did not produce the aggregate reduction.

## Validation and target notices

The Node compiler validates the same matching schema, strict types, graph references and local
resources. YAML scalar rules preserve the former compiler’s interpretation, including arbitrary
integers, integral floats and strings such as `08`. It serializes native metadata, rereads it, and
checks metadata equality and ZIP CRC. The wrapper compares the actual archive with the validated
candidate, rejects numeric precision loss, and checks source/resource/candidate fingerprints before
releasing the exact preview bytes. This matching schema is not the reference project's later
exhaustive node catalog and does not establish every operation's native semantics.

After successful static validation, the response returns official target-specific notices:

- Python/R script steps are unsupported for flows authored or published to Cloud. Server support
  requires the appropriate TabPy/Rserve connection/configuration; web authoring/editing requires a
  supported version (2020.4.1+). Scripts are not universally local-only.
  [Tableau script documentation](https://help.tableau.com/current/prep/en-us/prep_scripts.htm).
- Input unions are created/edited in Builder and can be scheduled to run on the web. Additional file
  filters have version/scheduling limits. A packaged TFLX does not automatically pick up newly
  matching files. Cloud file inputs require refreshing in Builder and republishing when needed.
  [Tableau input documentation](https://help.tableau.com/current/prep/en-us/prep_add_input_data.htm).

`valid=true` means static checks passed. `nativeExecutionVerified` remains false, and
`publicationReadiness` is either `unsupported` or `requires-runtime-verification`. No formula,
script, model, database operation, publish or native flow run is executed.

## Boundaries

Detailed I/O scope is non-database files and published Tableau data sources. Known credential
attributes/inline authentication and provider-specific database/custom-SQL settings are rejected
before YAML disclosure or artifact release. Private native bytes/resources stay in the operator
workspace. The fixed Node worker starts with an empty environment and bounded heap/output/deadline;
MCP PAT/UAT/session credentials are not passed to it. YAML is sent through the worker message
channel and omitted from invocation logs.

Network/absolute input paths, parent escapes, links, arbitrary tags, aliases and duplicate keys are
rejected. Archives are inspected without extracting their original paths. Limits include 32 MiB
native input/output, 64 MiB expanded/project data, 1 MiB YAML, 4,096 entries and 100,000 values. One
authoring operation runs at a time, with a 60-second engine deadline. Handles expire after 30
minutes; each session/workspace admits at most 20 prepared projects and each handle permits 10
preview attempts. Stored files remain for operator review; retain wanted deliverables before
cleaning owned cache projects.

Node-only regression fixtures retain expected results from the former Python implementation; local
verification additionally compares all native metadata values/types and attachments across twelve
reference flows. Independent ZIP readback checks the actual generated files. Offline corpus/fixture
evidence and source hashes are documented in the PR. The new tools have not been exercised end to
end on a live Cloud/Server deployment, and schema/round-trip success does not prove runtime
compatibility or business results.
