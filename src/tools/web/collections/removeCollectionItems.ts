import { WebMcpServer } from '../../../server.web.js';
import { WebTool } from '../tool.js';
import {
  collectionMembershipParamsSchema,
  getCollectionMembershipTool,
} from './collectionMembershipTool.js';

export const getRemoveCollectionItemsTool = (
  server: WebMcpServer,
): WebTool<typeof collectionMembershipParamsSchema> =>
  getCollectionMembershipTool(server, 'remove');
