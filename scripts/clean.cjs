'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

Promise.all([
  fs.rm(path.join(root, 'plugin'), { recursive: true, force: true })
]).catch((error) => {
  console.error('[official-local-scm-plugin] clean failed:', error);
  process.exitCode = 1;
});
