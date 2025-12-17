import { z } from 'zod';

import { InMemoryStore } from './inMemoryStore';
import { RedisStore } from './redisStore';
import { Store } from './store';

const storageConfigSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('memory'),
    expirationTimeMs: z.number().optional(),
  }),
  z.object({
    type: z.literal('redis'),
    url: z.string(),
    keyPrefix: z.string(),
    password: z.string().optional(),
    expirationTimeMs: z.number().optional(),
  }),
  z.object({
    type: z.literal('custom'),
    module: z.string(),
    config: z.record(z.any()).optional(),
    expirationTimeMs: z.number().optional(),
  }),
]);

type RequireProperty<T, K extends keyof T> = T extends any // <-- distribute the conditional type over each union member
  ? Required<Pick<T, K>> & Omit<T, K> // <-- make the property required and omit it from the type
  : never; // <-- return never if the type is not an object

export type StorageConfig = RequireProperty<
  z.infer<typeof storageConfigSchema>,
  'expirationTimeMs'
>;

export function getStorageConfig(
  config: string | undefined,
  options: {
    expirationTimeMs: {
      defaultValue: number;
      minValue?: number;
      maxValue?: number;
    };
  } = {
    expirationTimeMs: {
      defaultValue: 0,
      minValue: Number.NEGATIVE_INFINITY,
      maxValue: Number.POSITIVE_INFINITY,
    },
  },
): StorageConfig {
  const { defaultValue } = options.expirationTimeMs;
  let expirationTimeMs = defaultValue;

  if (!config) {
    return { type: 'memory', expirationTimeMs };
  }

  const configObj = JSON.parse(config);
  const result = storageConfigSchema.safeParse(configObj);

  if (result.success) {
    const minValue = options.expirationTimeMs.minValue ?? Number.NEGATIVE_INFINITY;
    const maxValue = options.expirationTimeMs.maxValue ?? Number.POSITIVE_INFINITY;

    expirationTimeMs = result.data.expirationTimeMs ?? defaultValue;
    if (expirationTimeMs < minValue) {
      expirationTimeMs = minValue;
    } else if (expirationTimeMs > maxValue) {
      expirationTimeMs = maxValue;
    }

    return {
      ...result.data,
      expirationTimeMs,
    };
  }

  return { type: 'memory', expirationTimeMs };
}

export class StoreFactory {
  static async create<T>({ config }: { config: StorageConfig }): Promise<Store<T>> {
    switch (config.type) {
      case 'memory': {
        return new InMemoryStore<T>();
      }
      case 'redis': {
        const store = new RedisStore<T>(config);
        try {
          await store.connect();
        } catch (e) {
          console.error(`Could not connect to Redis at ${config.url}`);
          throw e;
        }

        try {
          await store.healthCheck();
        } catch (e) {
          console.error('Redis health check failed.');
          throw e;
        }

        return store;
      }
      case 'custom': {
        if (!config.module) {
          throw new Error('Custom storage requires module path');
        }

        const CustomStore = await import(config.module);
        const StoreClass = CustomStore.default || CustomStore;

        const store = new StoreClass(config.config);

        this.validateStore<T>(store);

        try {
          await store.connect();
        } catch (e) {
          console.error('Could not connect to store');
          throw e;
        }

        try {
          await store.healthCheck();
        } catch (e) {
          console.error('Store health check failed.');
          throw e;
        }

        return store;
      }
    }
  }

  private static validateStore<T>(store: any): asserts store is Store<T> {
    const requiredMethods = getInstanceMethods(Store);
    const missingMethods = requiredMethods.filter((method) => typeof store[method] !== 'function');

    if (missingMethods.length > 0) {
      throw new Error(
        `Storage implementation missing required methods: ${missingMethods.join(', ')}`,
      );
    }
  }
}

function getInstanceMethods(instance: any): Array<string> {
  const methods = new Set<string>();
  let prototype = instance.prototype;
  while (prototype && prototype !== Object.prototype) {
    Object.getOwnPropertyNames(prototype).forEach((name) => {
      if (
        name !== 'constructor' &&
        typeof prototype[name as keyof typeof prototype] === 'function'
      ) {
        methods.add(name);
      }
    });
    prototype = Object.getPrototypeOf(prototype);
  }
  return [...methods];
}

export const exportedForTesting = {
  getInstanceMethods,
};
