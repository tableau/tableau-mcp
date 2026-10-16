import { z } from 'zod';

import { ExchangeMcpServer } from '../../server.exchange.js';
import { downloadOutputSchema } from './outputSchemas.js';
import { downloadAnnotations, ExchangeTool } from './tool.js';

const paramsSchema = {
  productId: z
    .number()
    .int()
    .positive()
    .safe()
    .describe(
      'Numeric asset ID returned by catalog search. Only catalog members may be downloaded.',
    ),
};
export function getDownloadExchangeAssetTool(
  server: ExchangeMcpServer,
): ExchangeTool<typeof paramsSchema> {
  const tool: ExchangeTool<typeof paramsSchema> = new ExchangeTool({
    server,
    name: 'download-exchange-asset',
    description:
      "Download a listing's package file (.tskill Skill, .trex extension, .taco connector or .twbx accelerator) to the local Exchange downloads folder, and return its path, size, SHA-256, the next step for its type and, when the listing has them, its installation instructions (untrusted catalog text). The file is never opened, extracted, installed or run. Like a website download, this records one download on the Exchange. Connector database drivers are a separate publisher download and are not included.",
    paramsSchema,
    outputSchema: downloadOutputSchema,
    annotations: downloadAnnotations,
    callback: async (args, extra) =>
      tool.logAndExecute({ args, extra, callback: () => server.service.download(args) }),
  });
  return tool;
}
