export class Deferred<T> {
  private _promise: Promise<T>;
  private _resolve: (response: T | PromiseLike<T>) => void = (_) => undefined;
  private _reject: (reason?: unknown) => void = (_) => undefined;

  constructor() {
    this._promise = new Promise<T>((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });
  }

  get promise(): Promise<T> {
    return this._promise;
  }

  resolve(response: T | PromiseLike<T>): void {
    this._resolve(response);
  }

  reject(reason?: unknown): void {
    this._reject(reason);
  }
}
