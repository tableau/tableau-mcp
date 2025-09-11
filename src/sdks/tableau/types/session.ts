import { z } from 'zod';

import { siteSchema } from './site.js';
import { userSchema } from './user.js';

export const sessionSchema = z.object({
  site: siteSchema,
  user: userSchema,
});
