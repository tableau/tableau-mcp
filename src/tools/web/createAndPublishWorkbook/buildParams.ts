import { z } from 'zod';

import { BuildTwbxInput } from './buildTwbx.js';

// The build inputs for create-and-publish-workbook. Asset bytes arrive as base64 over the wire
// (MCP args are JSON — no binary), so buildParamsToInput decodes them before handing off to the
// pure builder.
export const buildParamsSchema = {
  packageId: z
    .string()
    .describe(
      'Reverse-domain extension id, e.g. "com.example.myviz". Becomes both the ' +
        'Packages/<id>/ folder name and the manifest id — they must match or the reader 404s.',
    ),
  workbookName: z
    .string()
    .max(255)
    .describe('Display name for the workbook and the base name of the .twb inside the package.'),
  html: z
    .string()
    .describe(
      'The extension entrypoint HTML (index.html). Typically the single-file artifact a Claude ' +
        'session produced that queries live data via same-origin VDS.',
    ),
  assets: z
    .array(
      z.object({
        path: z
          .string()
          .describe('Path relative to content/, forward-slashed (e.g. "app.js", "img/logo.png").'),
        base64: z.string().describe('Base64-encoded file bytes.'),
      }),
    )
    .optional()
    .describe('Additional content/ files beside index.html (js, css, images, fonts…).'),
  toolbarLabel: z
    .string()
    .optional()
    .describe('Label for the toolbar button. Defaults to the workbook name.'),
};

// Turn validated tool params into the pure builder's input, decoding base64 assets to bytes.
export function buildParamsToInput(params: {
  packageId: string;
  workbookName: string;
  html: string;
  assets?: Array<{ path: string; base64: string }>;
  toolbarLabel?: string;
}): BuildTwbxInput {
  return {
    packageId: params.packageId,
    workbookName: params.workbookName,
    html: params.html,
    assets: params.assets?.map((a) => ({
      path: a.path,
      bytes: new Uint8Array(Buffer.from(a.base64, 'base64')),
    })),
    toolbar: params.toolbarLabel ? { label: params.toolbarLabel } : undefined,
  };
}
