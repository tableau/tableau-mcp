import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { DesktopMcpServer } from '../../../../server.desktop.js';
import { jsonToolResult } from '../../structuredContent.js';
import { DesktopTool } from '../../tool.js';
import { parseCustomThemeJson } from './customTheme.js';
import { summarizeCustomTheme } from './customThemeSummary.js';

const REDACTED_THEME_JSON = '[redacted custom theme JSON]';

const paramsSchema = {
  themeJson: z
    .string()
    .min(2)
    .max(64 * 1024),
  themeSha256: z.string().regex(/^[0-9a-f]{64}$/),
};

type InspectCustomThemeResult = {
  readonly themeSha256: string;
  readonly schemaVersion: '1.0.0';
  readonly byteCount: number;
  readonly propertyGroups: string[];
};

export const getInspectCustomThemeTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'inspect-custom-theme',
    title: 'Inspect Custom Theme',
    description: 'Validate Tableau Custom Theme JSON and return bounded metadata.',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    callback: async ({ themeJson, themeSha256 }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<InspectCustomThemeResult>({
        extra,
        args: { themeJson: REDACTED_THEME_JSON, themeSha256 },
        callback: async () => {
          const parsed = parseCustomThemeJson(themeJson, themeSha256);
          return new Ok({
            themeSha256: parsed.sha256,
            byteCount: Buffer.byteLength(themeJson, 'utf8'),
            ...summarizeCustomTheme(parsed.value),
          });
        },
        getSuccessResult: (result) => jsonToolResult(result, { isError: false }),
      });
    },
  });
  return tool;
};
