import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { BuildTwbxError } from '../../../errors/mcpToolError.js';
import { WebMcpServer } from '../../../server.web.js';
import { checkUnder64Mb } from '../_lib/publishShared.js';
import { buildParamsSchema, buildParamsToInput } from '../createAndPublishWorkbook/buildParams.js';
import { buildTwbx } from '../createAndPublishWorkbook/buildTwbx.js';
import { WebTool } from '../tool.js';
import { assetReferenceCheck } from './assetReferenceCheck.js';

// Reuse the exact build inputs of create-and-publish-workbook (packageId, workbookName, html,
// assets, toolbarLabel). We deliberately do NOT add projectId/showTabs/overwrite — this tool never
// publishes, so publish-target params would be meaningless.
const paramsSchema = { ...buildParamsSchema };

// A plain-JSON pre-flight result. No `appView` field — this tool sets neither `app` nor `meta`, so
// it rides the plain-JSON path and renders no MCP-App card.
type ValidateWorkbookPackageResult = {
  ok: boolean;
  warnings: string[];
  byteLength: number;
};

export const getValidateWorkbookPackageTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const validateWorkbookPackageTool = new WebTool({
    server,
    name: 'validate-workbook-package',
    description: `
Builds a Tableau workbook package (\`.twbx\`) from HTML/JS content **in memory** and validates it
**without publishing** — nothing is written to disk and no Tableau REST API call is made.

Use this as the recommended pre-flight before \`create-and-publish-workbook\`: it runs the same
in-memory builder and reports every structural problem, size problem, and referenced-but-missing
asset up front, so you can fix them before a publish attempt.

It checks:
- **Structure** — the package assembles into a valid archive (legal \`packageId\`, safe content
  paths, a \`.trex\` source-location that resolves to a bundled file).
- **Size** — the built package is under the 64 MB single-request publish limit.
- **Asset references** — every local \`src\`/\`href\`/CSS \`url()\` in the HTML points at a file that is
  actually bundled (index.html or an entry in \`assets\`). This catches the exact class of bug the
  builder cannot: an asset the HTML references but that was never added to the package would 404 at
  serve time and render blank.

**Parameters:** same build inputs as \`create-and-publish-workbook\` — \`packageId\`, \`workbookName\`,
\`html\`, optional \`assets\`, optional \`toolbarLabel\`. There are no publish-target parameters.

**Result:** \`{ ok, warnings, byteLength }\`. \`ok\` is true only when \`warnings\` is empty. \`byteLength\`
is the built package size in bytes.

A successful (ok:true) result means the package is structurally VALID and under 64 MB. It does NOT mean the dashboard is good, nor that every asset will render — review the inline preview before publishing.
`.trim(),
    paramsSchema,
    annotations: {
      title: 'Validate Workbook Package',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    // Neither `app` nor `meta`: this is a plain-JSON tool with no MCP-App card.
    callback: async (args, extra): Promise<CallToolResult> => {
      return await validateWorkbookPackageTool.logAndExecute<ValidateWorkbookPackageResult>({
        extra,
        args,
        callback: async () => {
          // Build in memory. buildTwbx throws BuildTwbxError on genuinely malformed input (illegal
          // packageId, unsafe content path, unresolved source-location); convert to a returned Err
          // so it renders as a clean 400 instead of the generic catch's noisier stack line.
          let bytes: Uint8Array;
          let warnings: string[];
          try {
            const built = buildTwbx(buildParamsToInput(args));
            bytes = built.bytes;
            warnings = [...built.warnings];
          } catch (error) {
            if (error instanceof BuildTwbxError) {
              return error.toErr();
            }
            throw error;
          }

          // Append the referenced-but-unbundled-asset warnings — the class buildTwbx cannot see.
          warnings.push(
            ...assetReferenceCheck(
              args.html,
              (args.assets ?? []).map((a) => a.path),
            ),
          );

          // Over-size is a REPORTABLE condition for a pre-flight validator, not a hard failure: we
          // surface the message as a warning rather than returning an Err so the caller still gets
          // the full report (byteLength + any other warnings) in one shot.
          const sizeError = checkUnder64Mb(bytes.byteLength);
          if (sizeError) {
            warnings.push(sizeError.getErrorText());
          }

          const byteLength = bytes.byteLength;
          // Discard the bytes — this tool never publishes them.
          const ok = warnings.length === 0;
          return new Ok({ ok, warnings, byteLength });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return validateWorkbookPackageTool;
};
