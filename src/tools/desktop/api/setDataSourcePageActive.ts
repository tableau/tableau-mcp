import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';
import { commandOk, commandSuccessResult } from './desktopCommandResult.js';

const paramsSchema = {
  session: sessionParam(),
  isDataSourcePageActive: z
    .boolean()
    .describe(
      'True to switch Tableau Desktop to the Data Source page, false to switch back to a sheet.',
    ),
};

const title = 'Set Data Source Page Active';

export const getSetDataSourcePageActiveTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const setDataSourcePageActiveTool = new DesktopTool({
    server,
    name: 'set-data-source-page-active',
    minApiVersion: '0.2.25',
    title,
    description:
      'Switch Tableau Desktop to the Data Source page or back to a sheet, then read back and ' +
      'return whether the Data Source page is actually active. The request can succeed without ' +
      'changing the page, for example when a published datasource cannot connect.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    paramsSchema,
    callback: async ({ session, isDataSourcePageActive }, extra): Promise<CallToolResult> => {
      return await setDataSourcePageActiveTool.logAndExecute({
        extra,
        args: { session, isDataSourcePageActive },
        getSuccessResult: commandSuccessResult,
        callback: async () => {
          const result = await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, call) => {
              const toggled = await call(
                'data-source page toggle',
                async (executor, signal) =>
                  await executor.toggleDataSourcePage(isDataSourcePageActive, signal),
              );
              if (toggled.isErr()) {
                return toggled;
              }

              const app = await call(
                'app info',
                async (executor, signal) => await executor.getApp(signal),
              );
              if (app.isErr()) {
                return app;
              }

              return new Ok({
                commandResult: toggled.value,
                isDataSourcePageActive: app.value.isDataSourcePageActive === true,
              });
            },
          });
          if (result.isErr()) {
            return result;
          }

          const actualState = result.value.isDataSourcePageActive;
          const subject = `The Data Source page is ${actualState ? 'active' : 'not active'}`;
          return new Ok(
            commandOk(
              { isDataSourcePageActive: actualState, message: `${subject}.` },
              result.value.commandResult,
              subject,
            ),
          );
        },
      });
    },
  });

  return setDataSourcePageActiveTool;
};
