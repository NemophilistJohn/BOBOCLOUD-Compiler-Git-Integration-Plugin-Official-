'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const payloadRoot = path.join(root, 'plugin');
const templatePath = path.join(root, 'manifest.template.json');

async function listFiles(directory, prefix = '') {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(absolute, relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

async function sha256(filePath) {
  const data = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

async function main() {
  const manifest = JSON.parse(await fs.readFile(templatePath, 'utf8'));
  const files = await listFiles(payloadRoot);
  if (files.includes('manifest.json')) {
    throw new Error('Payload directory must not contain manifest.json before integrity generation.');
  }
  const integrityFiles = Object.create(null);
  for (const relativePath of files) {
    integrityFiles[relativePath] = await sha256(path.join(payloadRoot, ...relativePath.split('/')));
  }
  manifest.integrity = { algorithm: 'sha256', files: integrityFiles };
  await fs.writeFile(path.join(payloadRoot, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

main().catch((error) => {
  console.error('[official-local-scm-plugin] integrity generation failed:', error);
  process.exitCode = 1;
});
