import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { stopPerformanceRecording } from '../../../desktop/wrappers/stopPerformanceRecording.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
};
const title = 'Stop Performance Recording';

export const getStopPerformanceRecordingTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const stopPerformanceRecordingTool = new DesktopTool({
    server,
    name: 'stop-performance-recording',
    minApiVersion: '0.2.11',
    title,
    description:
      'Stop performance recording for the open workbook in Tableau Desktop and return the path on the Desktop computer to the generated packaged recording.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    paramsSchema,
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await stopPerformanceRecordingTool.logAndExecute({
        extra,
        args: { session },
        callback: async () => {
          const result = await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) =>
              await read(
                'stop-performance-recording',
                async (executor, signal) => await stopPerformanceRecording({ executor, signal }),
              ),
          });
          if (result.isErr()) {
            return result;
          }

          if (result.value.status !== 'completed') {
            return new Ok({
              message:
                'Requested stopping workbook performance recording; Desktop is still stopping it.',
            });
          }

          const { filePath } = result.value.parsedResult;
          return new Ok({
            filePath,
            message: `Stopped workbook performance recording. Tableau Desktop created the packaged recording at "${filePath}".`,
          });
        },
      });
    },
  });

  return stopPerformanceRecordingTool;
};
