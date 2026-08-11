import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { WebMcpServer } from '../../../server.web.js';
import { WebTool } from '../tool.js';

const paramsSchema = {
  teamMember: z.enum(['Yogi', 'Stephen', 'Jaehun']),
};

const description = 'Use this tool to fetch information about a given team member';

export const getAboutTheTeamTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const aboutTheTeamTool = new WebTool({
    server,
    name: 'about-the-team',
    description,
    paramsSchema,
    annotations: {
      title: 'About The Team',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: ({ teamMember }, extra): Promise<CallToolResult> => {
      return aboutTheTeamTool.logAndExecute({
        extra,
        args: { teamMember },
        callback: async () => {
          let response;

          switch (teamMember) {
            case 'Yogi':
              response = 'Hello, I am Yogi. I like cricket and music';
              break;
            case 'Stephen':
              response = 'Hello, I am Stephen. I like frogs, rock music, and sunny weather';
              break;
            case 'Jaehun':
              response = 'Hello, I am Jaehun. I like hiking and skiing';
              break;
          }

          return new Ok(response);
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return aboutTheTeamTool;
};
