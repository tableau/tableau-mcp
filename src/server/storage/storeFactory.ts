import { z } from 'zod';

import { InMemoryStore } from './inMemoryStore';
import { RedisStore, RedisStoreConfig } from './redisStore';
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
  let expirationTimeMs = options.expirationTimeMs.defaultValue;

  if (!config) {
    return { type: 'memory', expirationTimeMs };
  }

  const configObj = JSON.parse(config);
  const result = storageConfigSchema.safeParse(configObj);

  if (result.success) {
    const minValue = options.expirationTimeMs.minValue ?? Number.NEGATIVE_INFINITY;
    const maxValue = options.expirationTimeMs.maxValue ?? Number.POSITIVE_INFINITY;

    expirationTimeMs = result.data.expirationTimeMs ?? options.expirationTimeMs.defaultValue;
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
  static async create<T>({
    config,
    RedisStoreCtor,
  }: {
    config: StorageConfig;
    RedisStoreCtor: new (config: RedisStoreConfig) => RedisStore<T>;
  }): Promise<Store<T>> {
    switch (config.type) {
      case 'memory': {
        return new InMemoryStore<T>();
      }
      case 'redis': {
        const store = new RedisStoreCtor(config);
        // if (!(await store.healthCheck())) {
        //   throw new Error(`Redis health check failed. Could not connect to Redis at ${config.url}`);
        // }

        await store.connect();
        return store;
      }
      case 'custom': {
        if (!config.module) {
          throw new Error('Custom storage requires module path');
        }

        const CustomStore = await import(config.module);
        const StoreClass = CustomStore.default || CustomStore;

        const store = new StoreClass(config.config);

        this.validateStore(store);

        if (typeof store.connect === 'function') {
          await store.connect();
        }

        return store;
      }
    }
  }

  private static validateStore(store: any): void {
    const requiredMethods = ['get', 'set', 'delete', 'exists', 'healthCheck', 'close'];

    for (const method of requiredMethods) {
      if (typeof store[method] !== 'function') {
        throw new Error(`Storage implementation missing required method: ${method}`);
      }
    }
  }
}
