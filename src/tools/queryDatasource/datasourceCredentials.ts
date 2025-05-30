import { z } from 'zod';

import { getConfig } from '../../config.js';

const schema = z.record(
  z.string().nonempty(),
  z
    .object({ u: z.string().nonempty(), p: z.string().nonempty() })
    .transform(({ u, p }) => ({ username: u, password: p })),
);

let credentialMap: Map<string, { username: string; password: string }> | undefined;
let initialized = false;

export const getDatasourceCredentials = (
  datasourceLuid: string,
): { username: string; password: string } | undefined => {
  if (!initialized) {
    initialized = true;

    const { datasourceCredentials } = getConfig();
    if (!datasourceCredentials) {
      return;
    }

    let obj: any;
    try {
      obj = JSON.parse(datasourceCredentials);
    } catch (e) {
      throw new Error(
        `Invalid datasource credentials format. Could not parse JSON string: ${datasourceCredentials}`,
        { cause: e },
      );
    }

    const parsed = schema.parse(obj);
    credentialMap = new Map(Object.entries(parsed));
  }

  return credentialMap?.get(datasourceLuid);
};

export const exportedForTesting = {
  resetDatasourceCredentials: () => {
    initialized = false;
    credentialMap = undefined;
  },
};
