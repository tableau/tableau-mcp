import { z } from 'zod';

export const fileUploadSchema = z.object({
  uploadSessionId: z.string(),
  fileSize: z.coerce.number().optional(),
});

export const fileUploadResponseSchema = z.object({
  fileUpload: fileUploadSchema,
});

export type FileUpload = z.infer<typeof fileUploadSchema>;
