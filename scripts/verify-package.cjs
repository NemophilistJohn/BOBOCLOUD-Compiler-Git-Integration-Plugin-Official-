'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const payloadRoot = path.join(root, 'plugin');
const artifactRoot = path.join(root, 'artifacts');

function requireZip(condition, message) {
  if (!condition) throw new Error('Invalid .boboplugin archive: ' + message);
}

async function main() {
  const manifest = JSON.parse(await fs.readFile(path.join(payloadRoot, 'manifest.json'), 'utf8'));
  const archivePath = path.join(artifactRoot, manifest.id + '-' + manifest.version + '.boboplugin');
  const archive = await fs.readFile(archivePath);
  requireZip(archive.length >= 22, 'archive is too short');
  const footer = archive.length - 22;
  requireZip(archive.readUInt32LE(footer) === 0x06054b50, 'missing end-of-central-directory record');
  const count = archive.readUInt16LE(footer + 10);
  const centralSize = archive.readUInt32LE(footer + 12);
  let offset = archive.readUInt32LE(footer + 16);
  requireZip(offset + centralSize === footer, 'central directory boundary is invalid');
  const names = [];
  for (let index = 0; index < count; index += 1) {
    requireZip(offset + 46 <= footer && archive.readUInt32LE(offset) === 0x02014b50, 'invalid central-directory entry');
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    requireZip(end <= footer, 'entry exceeds central directory');
    names.push(archive.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'));
    offset = end;
  }
  requireZip(offset === footer, 'central directory has trailing data');
  const expected = ['manifest.json', ...Object.keys(manifest.integrity.files)].sort();
  requireZip(JSON.stringify(names.sort()) === JSON.stringify(expected), 'archive file list differs from integrity manifest');
  console.log('[official-local-scm-plugin] verified ' + archivePath);
}

main().catch((error) => {
  console.error('[official-local-scm-plugin] package verification failed:', error.message || error);
  process.exitCode = 1;
});
