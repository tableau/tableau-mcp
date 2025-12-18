import { createPublicKey, KeyObject } from 'crypto';
import { compactDecrypt, CompactEncrypt } from 'jose';
import { createClient, RedisClientType } from 'redis';

import { Store } from './store';
import { RedisStorageConfig } from './storeFactory';

export class RedisStore<T> extends Store<T> {
  private client: RedisClientType;
  private keyPrefix: string;

  private readonly privateKey: KeyObject | undefined;
  private readonly publicKey: KeyObject | undefined;

  constructor(config: RedisStorageConfig, { privateKey }: { privateKey?: KeyObject }) {
    super();
    this.keyPrefix = config.keyPrefix;

    this.privateKey = privateKey;
    this.publicKey = privateKey ? createPublicKey(privateKey) : undefined;

    this.client = createClient({
      ...config.clientConfig,
    });
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async get(key: string): Promise<T | undefined> {
    const fullKey = this.getFullKey(key);
    let data = await this.client.get(fullKey);

    if (data === null) {
      return undefined;
    }

    if (this.privateKey) {
      const { plaintext } = await compactDecrypt(data, this.privateKey);
      data = new TextDecoder().decode(plaintext);
    }

    return data ? JSON.parse(data) : undefined;
  }

  async set(key: string, data: T, expirationTimeMs: number): Promise<this> {
    const fullKey = this.getFullKey(key);
    let value = JSON.stringify(data);

    if (this.publicKey) {
      value = await new CompactEncrypt(new TextEncoder().encode(value))
        .setProtectedHeader({ alg: 'RSA-OAEP-256', enc: 'A256GCM' })
        .encrypt(this.publicKey);
    }

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
    const result = await this.client.ping();
    return result === 'PONG';
  }

  async close(): Promise<void> {
    await this.client.quit();
  }

  private getFullKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }
}
