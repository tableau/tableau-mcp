// Test fixture: a custom ActivityLogProvider loadable via require() by init.ts's loadCustomProvider.
// It is instantiated inside the loader, out of the test's reach, so it records what it was given
// on globalThis. `globalThis.__activityLogFailure` makes recordToolCall throw or reject.
class RecordingActivityLogProvider {
  constructor(config) {
    globalThis.__activityLogProviderConfig = config;
  }

  recordToolCall(details) {
    (globalThis.__activityLogCalls ??= []).push(details);

    if (globalThis.__activityLogFailure === 'throw') {
      throw new Error('sync failure');
    }
    if (globalThis.__activityLogFailure === 'reject') {
      return Promise.reject(new Error('async failure'));
    }
  }

  close() {
    globalThis.__activityLogClosed = true;
    return Promise.resolve();
  }
}

module.exports = { default: RecordingActivityLogProvider };
