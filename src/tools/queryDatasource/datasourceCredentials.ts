import { z } from 'zod';

import { getConfig } from '../../config.js';

const schema = z.record(
  z.string().nonempty(),
  z.array(
    z
      .object({ luid: z.string().optional(), u: z.string().nonempty(), p: z.string().nonempty() })
      .transform(({ luid, u, p }) => ({
        connectionLuid: luid,
        connectionUsername: u,
        connectionPassword: p,
      })),
  ),
);

type Connection = {
  connectionLuid: string | undefined;
  connectionUsername: string;
  connectionPassword: string;
};

let credentialMap: Map<string, Array<Connection>> | undefined;
let initialized = false;

export const getDatasourceCredentials = (datasourceLuid: string): Array<Connection> | undefined => {
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
