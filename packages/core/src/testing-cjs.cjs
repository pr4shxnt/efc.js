// Keep native import(): the helper and ESM routes must share auth/context state.
/* global exports */
exports.createTestApp = async function createTestApp(options) {
  return (await import('./testing.js')).createTestApp(options);
};
