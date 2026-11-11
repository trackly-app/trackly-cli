'use strict';

// Test-only preload (node --require): exercises the held cloud auto-apply CLI path,
// which published releases keep off until the hosted tool ships (lib/auto-apply.js).
require('../lib/auto-apply').cloudAutoApply.released = true;
