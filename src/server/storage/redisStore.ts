import { createClient, RedisClientType } from 'redis';

import { Store } from './store';

export interface RedisStoreConfig {
  url: string;
  keyPrefix: string;
  password?: string;
}

export class RedisStore<T> extends Store<T> {
  private client: RedisClientType;
  private keyPrefix: string;

  constructor(config: RedisStoreConfig) {
    super();
    this.keyPrefix = config.keyPrefix;
    this.client = createClient({ url: config.url, password: config.password });
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async get(key: string): Promise<T | undefined> {
    const fullKey = this.getFullKey(key);
    const data = await this.client.get(fullKey);
    return data ? JSON.parse(data) : undefined;
  }

  async set(key: string, data: T, expirationTimeMs: number): Promise<this> {
    const fullKey = this.getFullKey(key);
    const value = JSON.stringify(data);

    if (expirationTimeMs) {
      await this.client.setEx(fullKey, Math.floor(expirationTimeMs / 1000), value);
    } else {
      await this.client.set(fullKey, value);
    }

    return this;
  }

  async delete(key: string): Promise<boolean> {
    return (await this.client.del(this.getFullKey(key))) === 1;
  }

  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(this.getFullKey(key))) === 1;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.client.quit();
  }

  private getFullKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }
}
