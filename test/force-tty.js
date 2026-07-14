'use strict';

// Child-process preload used only by CLI integration tests. execFile pipes are
// not TTYs, so force the same branch an interactive terminal uses without
// adding a production-only output override.
Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
Object.defineProperty(process.stderr, 'isTTY', { configurable: true, value: true });
