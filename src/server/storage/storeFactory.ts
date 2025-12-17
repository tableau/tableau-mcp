import { InMemoryStore } from './inMemoryStore';
import { RedisStore, RedisStoreConfig } from './redisStore';
import { Store } from './store';

export type StorageConfig =
  | {
      type: 'memory';
    }
  | ({
      type: 'redis';
    } & RedisStoreConfig)
  | {
      type: 'custom';
      module: string;
      config?: Record<string, any>;
    };

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
