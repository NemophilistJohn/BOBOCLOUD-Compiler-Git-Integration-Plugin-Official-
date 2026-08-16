'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const payloadRoot = path.join(root, 'plugin');
// The versioned artifact is intentionally source-controlled so a marketplace
// record can use an immutable raw GitHub URL. The generated unpacked payload
// stays ignored under plugin/.
const artifactRoot = path.join(root, 'artifacts');

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

async function listFiles(directory, prefix = '') {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isDirectory()) files.push(...await listFiles(path.join(directory, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

function localHeader(name, content, checksum) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(content.length, 18);
  header.writeUInt32LE(content.length, 22);
  header.writeUInt16LE(name.length, 26);
  return header;
}

function centralHeader(name, content, checksum, offset) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt32LE(checksum, 16);
  header.writeUInt32LE(content.length, 20);
  header.writeUInt32LE(content.length, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt32LE(offset, 42);
  return header;
}

async function main() {
  const manifest = JSON.parse(await fs.readFile(path.join(payloadRoot, 'manifest.json'), 'utf8'));
  const files = await listFiles(payloadRoot);
  if (!files.includes('manifest.json')) throw new Error('Run integrity generation before packaging.');
  const local = [];
  const central = [];
  let offset = 0;
  for (const relativePath of files) {
    const name = Buffer.from(relativePath, 'utf8');
    const content = await fs.readFile(path.join(payloadRoot, ...relativePath.split('/')));
    const checksum = crc32(content);
    const header = localHeader(name, content, checksum);
    local.push(header, name, content);
    central.push(centralHeader(name, content, checksum, offset), name);
    offset += header.length + name.length + content.length;
  }
  const centralData = Buffer.concat(central);
  const footer = Buffer.alloc(22);
  footer.writeUInt32LE(0x06054b50, 0);
  footer.writeUInt16LE(files.length, 8);
  footer.writeUInt16LE(files.length, 10);
  footer.writeUInt32LE(centralData.length, 12);
  footer.writeUInt32LE(offset, 16);
  await fs.mkdir(artifactRoot, { recursive: true });
  const output = path.join(artifactRoot, manifest.id + '-' + manifest.version + '.boboplugin');
  await fs.writeFile(output, Buffer.concat([...local, centralData, footer]));
  console.log(output);
}

main().catch((error) => {
  console.error('[official-local-scm-plugin] package failed:', error);
  process.exitCode = 1;
});
