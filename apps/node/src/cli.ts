#!/usr/bin/env -S node --import tsx

import { runNodeRuntimeFromEnv } from './runtime.js';

runNodeRuntimeFromEnv().catch((error: unknown) => {
  console.error('Failed to start Sphere reference node', error);
  process.exit(1);
});
