'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const payloadRoot = path.join(root, 'plugin');
const localeRoot = path.join(root, 'locales');

async function copyLocale(name) {
  const source = path.join(localeRoot, name);
  const target = path.join(payloadRoot, 'locales', name);
  await fs.copyFile(source, target);
}

async function main() {
  await fs.rm(payloadRoot, { recursive: true, force: true });
  await fs.mkdir(path.join(payloadRoot, 'dist'), { recursive: true });
  await fs.mkdir(path.join(payloadRoot, 'locales'), { recursive: true });

  await esbuild.build({
    absWorkingDir: root,
    entryPoints: ['src/extension.js'],
    outfile: path.join(payloadRoot, 'dist', 'extension.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2020'],
    charset: 'utf8',
    legalComments: 'none',
    minify: true,
    logLevel: 'info'
  });

  await Promise.all(['en.json', 'zh-CN.json', 'ja.json'].map(copyLocale));
}

main().catch((error) => {
  console.error('[official-local-scm-plugin] build failed:', error);
  process.exitCode = 1;
});
