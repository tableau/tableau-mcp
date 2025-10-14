import { z } from 'zod';

export const fileUploadSchema = z.object({
  fileUpload: z.object({
    uploadSessionId: z.string(),
    fileSize: z.number(),
  }),
});
