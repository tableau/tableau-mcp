import { z } from 'zod';

export const validationIssueSchema = z.object({
  severity: z.string(),
  message: z.string(),
  // Tableau omits line/column for structural XML errors (e.g. an unclosed tag) that the
  // parser can't map to a specific location, unlike content-validation errors which include them.
  line: z.number().optional(),
  column: z.number().optional(),
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
