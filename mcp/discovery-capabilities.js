'use strict';

const { isDeepStrictEqual } = require('node:util');

let preparedReadyEnvelope;

/**
 * Preparatory parser only: no transport, registration or production activation.
 * The local opt-in defaults off and does not read capability data when off.
 * A ready response proves contract compatibility, never production performance.
 * Any contract drift requires a new reviewed fixture rather than inferred support.
 */
function parseDiscoveryCapabilities(response, { enabled = false } = {}) {
  if (enabled !== true) return null;

  if (!preparedReadyEnvelope) {
    // Frozen API contract; test fixtures bind its exact bytes to the reviewed source.
    preparedReadyEnvelope = structuredClone(require('./discovery-capabilities-v1.json'));
    preparedReadyEnvelope.discovery.available = true;
    preparedReadyEnvelope.discovery.readiness = 'ready';
  }

  if (!isDeepStrictEqual(response, preparedReadyEnvelope)) return null;
  return structuredClone(preparedReadyEnvelope.discovery);
}

module.exports = { parseDiscoveryCapabilities };
