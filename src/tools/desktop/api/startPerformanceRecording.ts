import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { startPerformanceRecording } from '../../../desktop/wrappers/startPerformanceRecording.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
};
const title = 'Start Performance Recording';

export const getStartPerformanceRecordingTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const startPerformanceRecordingTool = new DesktopTool({
    server,
    name: 'start-performance-recording',
    minApiVersion: '0.2.11',
    title,
    description:
      'Start performance recording for the open workbook in Tableau Desktop. Starting again while recording is already active succeeds without resetting the recording.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    paramsSchema,
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await startPerformanceRecordingTool.logAndExecute({
        extra,
        args: { session },
        callback: async () => {
          const result = await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) =>
              await read(
                'start-performance-recording',
                async (executor, signal) => await startPerformanceRecording({ executor, signal }),
              ),
          });
          if (result.isErr()) {
            return result;
          }

          return new Ok({
            message:
              result.value.status === 'completed'
                ? 'Started workbook performance recording in Tableau Desktop.'
                : 'Requested workbook performance recording; Desktop is still starting it.',
          });
        },
      });
    },
  });

  return startPerformanceRecordingTool;
};
