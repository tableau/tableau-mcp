import { z } from 'zod';

import { requiredString } from '../../../utils/requiredString';

export const bearerTokenSchema = z.object({
  iss: requiredString('iss'),
  aud: requiredString('aud'),
  exp: z.number().int().nonnegative(),
  sub: requiredString('sub'),
  scope: requiredString('scope'),
  'https://tableau.com/siteId': requiredString('https://tableau.com/siteId'),
  'https://tableau.com/targetUrl': requiredString('https://tableau.com/targetUrl'),
});
