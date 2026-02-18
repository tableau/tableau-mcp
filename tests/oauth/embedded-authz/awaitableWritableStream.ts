import { Writable } from 'stream';

import { Deferred } from '../deferred.js';

export class AwaitableWritableStream {
  private readonly _deferred = new Deferred<void>();
  private readonly _writableStream: Writable;
  private readonly _chunks: Array<any> = [];

  constructor() {
    this._writableStream = new Writable({
      write: (chunk, _encoding, callback): void => {
        this._chunks.push(chunk);
        callback();
      },
      final: (callback): void => {
        callback();
        this._deferred.resolve();
      },
    });
  }

  get stream(): Writable {
    return this._writableStream;
  }

  getChunks = async <T>(map: (chunk: any) => T): Promise<Array<T>> => {
    await this._deferred.promise;
    return this._chunks.map(map);
  };
}
