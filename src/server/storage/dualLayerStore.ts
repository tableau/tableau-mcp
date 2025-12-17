import { InMemoryStore } from './inMemoryStore';
import { Store } from './store';

export class DualLayerStore<T> extends Store<T> {
  private memoryStore: Store<T>;
  private persistentStore: Store<T> | undefined;

  constructor({ persistentStore }: { persistentStore?: Store<T> } = {}) {
    super();
    this.memoryStore = new InMemoryStore<T>();
    this.persistentStore = persistentStore;
  }

  async get(key: string): Promise<T | undefined> {
    const memoryStoreResult = await this.memoryStore.get(key);
    if (memoryStoreResult) {
      return memoryStoreResult;
    }

    const persistentStoreResult = await this.persistentStore?.get(key);
    if (persistentStoreResult) {
      await this.memoryStore.set(key, persistentStoreResult);
      return persistentStoreResult;
    }
  }

  async set(key: string, data: T, expirationTimeMs?: number): Promise<this> {
    await this.memoryStore.set(key, data, expirationTimeMs);
    await this.persistentStore?.set(key, data, expirationTimeMs);
    return this;
  }

  async delete(key: string): Promise<boolean> {
    const memoryStoreResult = await this.memoryStore.delete(key);
    const persistentStoreResult = (await this.persistentStore?.delete(key)) ?? true;
    return memoryStoreResult && persistentStoreResult;
  }

  async exists(key: string): Promise<boolean> {
    return (
      (await this.memoryStore.exists(key)) ?? (await this.persistentStore?.exists(key)) ?? false
    );
  }

  async healthCheck(): Promise<boolean> {
    return (
      (await this.memoryStore.healthCheck()) &&
      ((await this.persistentStore?.healthCheck()) ?? true)
    );
  }

  async close(): Promise<void> {
    await this.memoryStore.close();
    await this.persistentStore?.close();
  }
}
