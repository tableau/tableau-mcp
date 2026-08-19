import { z } from 'zod';

export const validationIssueSchema = z.object({
  severity: z.string(),
  message: z.string(),
  line: z.number(),
  column: z.number(),
  elementName: z.string(),
});

export type ValidationIssue = z.infer<typeof validationIssueSchema>;

export const workbookValidationResultSchema = z.object({
  timestamp: z.string(),
  uploadId: z.string().optional(),
  errors: z.array(validationIssueSchema).optional(),
  warnings: z.array(validationIssueSchema).optional(),
});

export type WorkbookValidationResult = z.infer<typeof workbookValidationResultSchema>;
