'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const PAYLOAD = path.join(ROOT, 'plugin');

async function payloadFiles(directory, prefix = '') {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isDirectory()) result.push(...await payloadFiles(path.join(directory, entry.name), relative));
    else if (entry.isFile() && relative !== 'manifest.json') result.push(relative);
  }
  return result;
}

test('generated payload has a complete SHA-256 manifest for the official 1.1.0 package', async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(PAYLOAD, 'manifest.json'), 'utf8'));
  const files = await payloadFiles(PAYLOAD);

  assert.equal(manifest.id, 'bobocloud.local-scm');
  assert.equal(manifest.version, '1.1.0');
  assert.equal(manifest.engines.pluginApi, '^1.2.0');
  assert.equal(manifest.integrity.algorithm, 'sha256');
  assert.deepEqual(Object.keys(manifest.integrity.files).sort(), files.sort());
  for (const relativePath of files) {
    const content = await fs.readFile(path.join(PAYLOAD, ...relativePath.split('/')));
    const digest = crypto.createHash('sha256').update(content).digest('hex');
    assert.equal(manifest.integrity.files[relativePath], digest, relativePath + ' hash mismatch');
  }
});
