import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

import { TableauAuthInfo, tableauAuthInfoSchema } from './schemas.js';

export const getTableauAuthInfo = (authInfo: AuthInfo | undefined): TableauAuthInfo | undefined => {
  if (!authInfo) {
    return;
  }

  const tableauAuthInfo = tableauAuthInfoSchema.safeParse(authInfo.extra);
  if (!tableauAuthInfo.success) {
    return;
  }

  return tableauAuthInfo.data;
};
