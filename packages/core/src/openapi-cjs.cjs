/* global exports */
// Keep route loading native: require() cannot load ESM routes with top-level await.
exports.generateOpenAPI = async function generateOpenAPI(...args) {
  return (await import('./index.js')).generateOpenAPI(...args);
};
