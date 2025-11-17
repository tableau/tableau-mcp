/* v8 ignore file -- @preserve */

const MAX_SIGNED_INT32 = 2 ** 31 - 1;

// https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout#maximum_delay_value
export function setLongTimeout<TArgs extends any[]>(
  callback: (...args: TArgs) => void,
  delay: number,
  ...args: TArgs
): NodeJS.Timeout {
  const MAX_DELAY = MAX_SIGNED_INT32;

  if (delay > MAX_DELAY) {
    return setTimeout(() => {
      setLongTimeout(callback, delay - MAX_DELAY, ...args);
    }, MAX_DELAY);
  }

  return setTimeout(callback, delay, ...args);
}
