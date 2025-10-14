import { z } from 'zod';

export const fileUploadSchema = z.object({
  uploadSessionId: z.string(),
  fileSize: z.coerce.number(),
});

export type FileUpload = z.infer<typeof fileUploadSchema>;
