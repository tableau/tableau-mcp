import { RequestId } from '@modelcontextprotocol/sdk/types.js';

import { getConfig } from '../config.js';
import { log } from '../logging/log.js';
import { Server } from '../server.js';

export async function getUserAttributes({
  initialUserAttributes,
  server,
  requestId,
}: {
  initialUserAttributes: unknown;
  server: Server;
  requestId: RequestId;
}): Promise<Record<string, unknown> | undefined | 'invalid'> {
  function isUserAttributeObjectLocal(
    object: unknown,
  ): object is Record<string, unknown> | undefined {
    if (!isUserAttributeObject(object)) {
      log.error(server, `Invalid user attributes: ${JSON.stringify(object)}`, {
        logger: 'query-datasource',
        requestId,
      });
      return false;
    }

    return true;
  }

  if (!isUserAttributeObjectLocal(initialUserAttributes)) {
    return 'invalid';
  }

  const elicitedUserAttributes = await elicitUserAttributes(server, requestId);
  if (!isUserAttributeObjectLocal(elicitedUserAttributes)) {
    return 'invalid';
  }

  return { ...initialUserAttributes, ...elicitedUserAttributes };
}

async function elicitUserAttributes(server: Server, requestId: RequestId): Promise<unknown> {
  let userAttributes: unknown;
  const { elicitation } = getConfig();

  if (!elicitation.elicitUserAttributes) {
    return;
  }

  const result = await server.elicitInput({
    message:
      'Please provide any additional, non-sensitive user attributes to include in the query. The format should be a JSON string representation of the object to add to the JWT payload.',
    requestedSchema: {
      type: 'object',
      properties: {
        object: { type: 'string', title: 'Object' },
      },
      required: ['object'],
    },
  });

  if (typeof result === 'string') {
    if (result === 'disabled') {
      log.debug(server, 'Elicitation is disabled by the server', {
        logger: 'query-datasource',
        requestId,
      });
    }

    if (result === 'unsupported') {
      log.debug(server, 'Elicitation is not supported by the client', {
        logger: 'query-datasource',
        requestId,
      });
    }
  } else if (
    result.action === 'accept' &&
    result.content?.object &&
    typeof result.content.object === 'string'
  ) {
    try {
      userAttributes = JSON.parse(result.content.object);
    } catch {
      log.error(server, `Error parsing user attributes: ${result.content.object}`, {
        logger: 'query-datasource',
        requestId,
      });
    }
  } else {
    log.error(server, `Unable to elicit user attributes: ${JSON.stringify(result)}`, {
      logger: 'query-datasource',
      requestId,
    });
  }

  return userAttributes;
}

function isUserAttributeObject(object: unknown): object is Record<string, unknown> | undefined {
  if (object === undefined) {
    return true;
  }

  if (object === null) {
    return false;
  }

  if (Array.isArray(object)) {
    return false;
  }

  if (
    typeof object !== 'object' &&
    Object.prototype.isPrototypeOf.call(Object.getPrototypeOf(object), Object)
  ) {
    return true;
  }

  return false;
}
