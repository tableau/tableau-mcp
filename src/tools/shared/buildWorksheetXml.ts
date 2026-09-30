import { randomUUID } from 'crypto';
import { z } from 'zod';

import {
  ArgsValidationError,
  XmlModificationError,
  XmlValidationError,
} from '../../errors/sharedMcpToolError.js';
import { buildWorksheetXml } from '../../metadata/templates/buildWorksheetXml.js';
import type { Server } from '../../server.js';
import { SharedTool } from './tool.js';

const paramsSchema = {
  workbookXml: z.string().min(1).describe('Base workbook XML.'),
  templateXml: z.string().min(1).describe('Worksheet template XML.'),
  templateName: z.string().trim().min(1).max(128).describe('Template ID.'),
  title: z.string().trim().min(1).max(255).describe('Worksheet name.'),
  datasource: z.string().trim().min(1).max(255).describe('Workbook datasource.'),
  fieldMapping: z
    .record(z.string().trim().min(1).max(128), z.string().trim().min(1).max(255))
    .describe('Map template slot ID to exact column_ref.'),
  derivationOverrides: z
    .record(z.string(), z.enum(['cnt', 'ctd']))
    .optional()
    .describe('Count derivation by slot ID.'),
  topN: z.number().int().min(1).max(50).optional().describe('Rank limit (1-50).'),
};

export const getBuildWorksheetXmlTool = (server: Server): SharedTool<typeof paramsSchema> => {
  const tool: SharedTool<typeof paramsSchema> = new SharedTool({
    server,
    name: 'build-worksheet-xml',
    title: 'Building worksheet XML',
    description: 'Build worksheet and window XML from supplied workbook and template XML.',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async (args, extra) =>
      tool.logAndExecute({
        extra,
        args: {
          ...args,
          workbookXml: '[redacted workbook XML]',
          templateXml: '[redacted template XML]',
        },
        callback: async () => {
          const { workbookXml, templateXml, ...plan } = args;
          const result = buildWorksheetXml({ workbookXml, templateXml, plan, nonce: randomUUID() });
          if (result.isOk()) return result;
          if (result.error.kind === 'args')
            return new ArgsValidationError(result.error.message).toErr();
          if (result.error.kind === 'xml')
            return new XmlValidationError(result.error.issues).toErr();
          return new XmlModificationError(result.error.message).toErr();
        },
      }),
  });
  return tool;
};
