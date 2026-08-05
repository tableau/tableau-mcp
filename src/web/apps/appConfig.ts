import { WebToolName } from '../../tools/web/toolName.js';

/**
 * The MCP App bundles the server ships. Each maps to a self-contained, single-file HTML built by
 * `src/scripts/build.ts`, bundled by functionality:
 * - `embed-viz`: embeds a Tableau viz (get-view / get-workbook).
 * - `hitl-confirm`: the MCP-Apps HITL confirm panel for delete/update preview tools.
 */
export type AppBundle = 'embed-viz' | 'hitl-confirm';

const BUNDLE_HTML: Record<AppBundle, string> = {
  'embed-viz': 'mcp-app.html',
  'hitl-confirm': 'hitl-confirm.html',
};

/**
 * Helper to generate MCP App configuration for tools.
 *
 * @param toolName - The tool name (e.g., 'get-workbook')
 * @param bundle - Which app bundle the tool renders (defaults to the embed-viz bundle)
 * @returns App configuration object with name, resourceUri, and htmlPath
 */
export function getAppConfig(
  toolName: WebToolName,
  bundle: AppBundle = 'embed-viz',
): {
  name: string;
  resourceUri: string;
  htmlPath: string;
} {
  const html = BUNDLE_HTML[bundle];
  return {
    name: `${toolName}-ui`,
    resourceUri: `ui://${toolName}/${html}`,
    htmlPath: `web/apps/dist/${html}`,
  };
}
