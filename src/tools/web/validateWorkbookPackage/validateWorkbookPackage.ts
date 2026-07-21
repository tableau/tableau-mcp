import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createHash } from 'crypto';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getDataAppWorkspaceStore } from '../../../dataApps/init.js';
import { appIdSchema, generateOpaqueId } from '../../../dataApps/opaqueId.js';
import { BuildTwbxError, McpToolError } from '../../../errors/mcpToolError.js';
import { WebMcpServer } from '../../../server.web.js';
import { checkUnder64Mb } from '../_lib/publishShared.js';
import {
  buildWorkspaceTwbx,
  listPackagedWorkspaceFiles,
} from '../createAndPublishWorkbook/buildWorkspaceTwbx.js';
import { resolveScopeFromExtra } from '../dataApps/scopeFromExtra.js';
import { WebTool } from '../tool.js';
import { assetReferenceCheck } from './assetReferenceCheck.js';

const paramsSchema = {
  appId: appIdSchema,
  workbookName: z
    .string()
    .max(255)
    .describe('Display name for the workbook and the base name of the `.twb` inside the package.'),
  toolbarLabel: z
    .string()
    .optional()
    .describe('Label for the toolbar button. Defaults to the workbook name.'),
};

// The kinds of check this tool performs. They are all STRUCTURAL/SIZE/REFERENCE checks — never a
// judgment of visual or business correctness. Surfacing them lets a caller see that "ok:true" only
// means "assembles into a valid, under-limit archive with all references resolved", not "the
// dashboard is good".
const CHECKS_PERFORMED = ['structure', 'asset-references', 'size'] as const;

// A plain-JSON receipt. No `appView` field — this tool sets neither `app` nor `meta`, so it rides
// the plain-JSON path and renders no MCP-App card. The built bytes are NEVER returned to the model;
// only the scoped `validationId` (a handle to the immutable stored package) and its digest.
type ValidateWorkbookPackageResult = {
  ok: boolean;
  validationId?: string;
  digest?: string;
  warnings: string[];
  checksPerformed: Array<(typeof CHECKS_PERFORMED)[number]>;
  byteLength: number;
  expiresAt?: string;
};

export const getValidateWorkbookPackageTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const validateWorkbookPackageTool = new WebTool({
    server,
    name: 'validate-workbook-package',
    description: `
Packages an existing **data-app workspace** (created by \`scaffold-data-app\` and authored with
\`upsert-data-app-files\`) into a Tableau workbook package (\`.twbx\`) **in memory**, validates it,
and — on success — stores the exact validated bytes and returns an opaque \`validationId\` receipt.
Nothing is published and no Tableau REST API call is made. The bytes themselves are never returned.

Run this as the pre-flight before \`create-and-publish-workbook\`: publication consumes only the
\`validationId\`, guaranteeing it uploads the exact bytes that were validated even if the workspace
changes afterward.

It checks:
- **Structure** — the workspace's \`index.html\` and its sibling files assemble into a valid archive
  (legal \`packageId\`, safe content paths, a \`.trex\` source-location that resolves to a bundled file).
- **Asset references** — every local \`src\`/\`href\`/CSS \`url()\` in the packaged HTML and CSS resolves
  to a file that is actually packaged. A referenced-but-missing asset would 404 at serve time and
  render blank; it is a hard failure that blocks a receipt.
- **Size** — the built package is under the 64 MB single-request publish limit.

**Parameters:** \`appId\` (required) — the workspace handle. \`workbookName\` (required) — the display
name for the workbook. \`toolbarLabel\` (optional) — toolbar button label.

**Result:** \`{ ok, validationId?, digest?, warnings, checksPerformed, byteLength, expiresAt? }\`.
On success \`ok\` is true and \`validationId\`/\`digest\`/\`expiresAt\` are set. Hard structural, reference,
or size failures return \`ok:false\` with no \`validationId\`. Advisory serve-time extension warnings
do not block a receipt: \`ok\` stays true and the warnings are preserved.

A successful (ok:true) result means the package is structurally VALID and under 64 MB. It does NOT mean the dashboard is good, nor that every asset will render — review the inline preview before publishing.
`.trim(),
    paramsSchema,
    annotations: {
      title: 'Validate Workbook Package',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    // Neither `app` nor `meta`: this is a plain-JSON tool with no MCP-App card.
    callback: async (args, extra): Promise<CallToolResult> => {
      return await validateWorkbookPackageTool.logAndExecute<ValidateWorkbookPackageResult>({
        extra,
        args,
        callback: async () => {
          const scope = resolveScopeFromExtra(extra);
          if (scope.isErr()) {
            return scope;
          }

          const store = getDataAppWorkspaceStore();

          // Load the workspace metadata and an immutable snapshot of its files. A missing/expired/
          // wrong-scope appId surfaces as a clean not-found error (never a thrown stack).
          let packageId: string;
          let snapshot: Awaited<ReturnType<typeof store.snapshot>>;
          try {
            const workspace = await store.get(scope.value, args.appId);
            packageId = workspace.packageId;
            snapshot = await store.snapshot(scope.value, args.appId);
          } catch (error) {
            if (error instanceof McpToolError) {
              return error.toErr();
            }
            throw error;
          }

          // STRUCTURE. buildWorkspaceTwbx throws BuildTwbxError on a hard structural problem
          // (no index.html, illegal packageId, unsafe content path). That is a validation OUTCOME,
          // not a tool error: report ok:false with the reason and issue no receipt.
          let bytes: Uint8Array;
          let advisoryWarnings: string[];
          try {
            const built = buildWorkspaceTwbx(snapshot, {
              packageId,
              workbookName: args.workbookName,
              toolbarLabel: args.toolbarLabel,
            });
            bytes = built.bytes;
            advisoryWarnings = [...built.warnings];
          } catch (error) {
            if (error instanceof BuildTwbxError) {
              return new Ok({
                ok: false,
                warnings: [error.getErrorText()],
                checksPerformed: ['structure'],
                byteLength: 0,
              });
            }
            throw error;
          }

          // ASSET REFERENCES (hard) — run against the EXACT files that were packaged.
          const referenceWarnings = assetReferenceCheck(listPackagedWorkspaceFiles(snapshot));

          // SIZE (hard).
          const sizeError = checkUnder64Mb(bytes.byteLength);
          const sizeWarnings = sizeError ? [sizeError.getErrorText()] : [];
          const checksPerformed = [...CHECKS_PERFORMED];

          const hardWarnings = [...referenceWarnings, ...sizeWarnings];

          if (hardWarnings.length > 0) {
            // Report ALL checks and warnings (advisory + hard) but issue NO validationId.
            return new Ok({
              ok: false,
              warnings: [...advisoryWarnings, ...hardWarnings],
              checksPerformed,
              byteLength: bytes.byteLength,
            });
          }

          // SUCCESS. Only advisory extension warnings (if any) remain — they do not block a receipt.
          // Store the exact bytes as an immutable, scoped, expiring validation record and return
          // only its handle + digest. The bytes are discarded from the tool result entirely.
          const validationId = generateOpaqueId();
          const digest = createHash('sha256').update(bytes).digest('hex');
          try {
            await store.saveValidation(scope.value, {
              validationId,
              appId: args.appId,
              bytes,
              digest,
              sourceDigest: snapshot.digest,
              // Persist the validated display name so publication uploads the exact metadata that
              // was validated, reading it from the immutable receipt rather than the mutable
              // workspace.
              workbookName: args.workbookName,
              warnings: advisoryWarnings,
              checksPerformed,
              byteLength: bytes.byteLength,
            });
            const stored = await store.getValidation(scope.value, validationId);
            return new Ok({
              ok: true,
              validationId,
              digest: stored.digest,
              warnings: stored.warnings ?? advisoryWarnings,
              checksPerformed,
              byteLength: stored.byteLength ?? bytes.byteLength,
              expiresAt: stored.expiresAt?.toISOString(),
            });
          } catch (error) {
            if (error instanceof McpToolError) {
              return error.toErr();
            }
            throw error;
          }
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return validateWorkbookPackageTool;
};
