// Test fixture: a module that loads but doesn't implement ActivityLogProvider (no recordToolCall).
class InvalidActivityLogProvider {}

module.exports = { default: InvalidActivityLogProvider };
