import { z } from 'zod';

/**
 * Subset of Tableau REST API custom view resource (Get Custom View).
 * @see https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#get_custom_view
 */
export const customViewSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  lastAccessedAt: z.string().optional(),
  shared: z.union([z.boolean(), z.string()]).optional(),
  view: z.object({
    id: z.string(),
    name: z.string().optional(),
  }),
  workbook: z
    .object({
      id: z.string(),
      name: z.string().optional(),
    })
    .optional(),
  owner: z
    .object({
      id: z.string(),
      name: z.string().optional(),
    })
    .optional(),
});

export type CustomView = z.infer<typeof customViewSchema>;
