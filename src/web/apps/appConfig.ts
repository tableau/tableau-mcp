import { WebToolName } from '../../tools/web/toolName.js';

/**
 * Helper to generate MCP App configuration for tools.
 *
 * @param toolName - The tool name (e.g., 'get-workbook')
 * @returns App configuration object with name, resourceUri, and htmlPath
 */
export function getAppConfig(toolName: WebToolName): {
  name: string;
  resourceUri: string;
  htmlPath: string;
} {
  return {
    name: `${toolName}-ui`,
    resourceUri: `ui://${toolName}/mcp-app.html`,
    htmlPath: 'web/apps/dist/mcp-app.html',
  };
}
