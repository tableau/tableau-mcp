import { InMemoryStore } from './inMemoryStore';
import { Session } from './session';
import { Store } from './store';

export type StorageConfig =
  | {
      type: 'memory';
    }
  | {
      type: 'redis';
      url: string;
      host: string;
      port: number;
      password: string;
      keyPrefix: string;
    }
  | {
      type: 'custom';
      module: string;
      config?: Record<string, any>;
    };

export class SessionStoreFactory {
  static async create(config: StorageConfig): Promise<Store<Session>> {
    switch (config.type) {
      case 'memory':
        return new InMemoryStore<Session>();

      case 'redis': {
        // const store = new RedisSessionStore(config);
        // await store.connect();
        // return store;
        throw new Error('Redis storage is not implemented');
      }

      case 'custom': {
        if (!config.module) {
          throw new Error('Custom storage requires module path');
        }

        // Dynamic import of customer's module
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
    const requiredMethods = ['get', 'set', 'delete', 'exists', 'touch', 'healthCheck', 'close'];

    for (const method of requiredMethods) {
      if (typeof store[method] !== 'function') {
        throw new Error(`Storage implementation missing required method: ${method}`);
      }
    }
  }
}
