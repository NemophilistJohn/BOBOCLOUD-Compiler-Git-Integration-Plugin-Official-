'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_CONTROL_ID = 'bobocloud.local-scm.view';
const COMMAND_PREFIX = 'bobocloud.local-scm.';
const messages = {
  en: require(path.join(ROOT, 'locales', 'en.json')),
  'zh-CN': require(path.join(ROOT, 'locales', 'zh-CN.json')),
  ja: require(path.join(ROOT, 'locales', 'ja.json'))
};

let extension;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createContext(options = {}) {
  let locale = options.locale || 'en';
  const snapshots = [];
  const commands = new Map();
  const localeListeners = new Set();
  const calls = { sourceControl: [], decorationSets: [], decorationClears: 0, clearStates: 0, disposed: 0 };
  const view = {
    async setState(state) {
      snapshots.push(clone(state));
      return { version: snapshots.length };
    },
    async clearState() {
      calls.clearStates += 1;
      return { version: snapshots.length + 1 };
    },
    dispose() { calls.disposed += 1; }
  };
  const decorations = {
    async set(entries) { calls.decorationSets.push(clone(entries)); return { entryCount: entries.length }; },
    async clear() { calls.decorationClears += 1; return { entryCount: 0 }; },
    dispose() { calls.disposed += 1; }
  };
  const git = options.git === undefined
    ? { async detect() { return { repositories: [] }; } }
    : options.git;
  const context = {
    i18n: {
      get locale() { return locale; },
      t(key) { return messages[locale][key] || messages.en[key] || key; },
      onDidChange(listener) {
        localeListeners.add(listener);
        return { dispose() { localeListeners.delete(listener); } };
      }
    },
    sourceControl: {
      async register(descriptor) {
        calls.sourceControl.push(clone(descriptor));
        return view;
      }
    },
    fileDecorations: {
      async registerScm(optionsValue) {
        calls.decorationOptions = clone(optionsValue);
        return decorations;
      }
    },
    scm: options.withoutScm ? {} : { git },
    commands: {
      async register(id, handler, metadata) {
        commands.set(id, { handler, metadata: clone(metadata) });
        return { dispose() { commands.delete(id); } };
      }
    }
  };
  return {
    context,
    calls,
    commands,
    snapshots,
    changeLocale(next) {
      locale = next;
      for (const listener of Array.from(localeListeners)) listener();
    }
  };
}

test.before(async () => {
  const output = path.join(ROOT, 'plugin', 'dist', 'extension.js');
  await fs.access(output);
  extension = await import(pathToFileURL(output).href + '?test=' + Date.now());
});

test.after(async () => {
  if (extension) await extension.deactivate();
});

test('worker entry registers only host-rendered local SCM state and responds to localized state updates', async () => {
  const harness = createContext();
  const activation = await extension.activate(harness.context);

  assert.deepEqual(harness.calls.sourceControl, [{
    id: SOURCE_CONTROL_ID,
    title: 'Source Control',
    icon: 'git-branch',
    order: 20,
    openCommand: COMMAND_PREFIX + 'refresh'
  }]);
  assert.deepEqual(harness.calls.decorationOptions, { id: COMMAND_PREFIX + 'tree-status', priority: 100 });
  assert.equal(harness.snapshots.at(-1).phase, 'empty');
  assert.equal(harness.commands.has(COMMAND_PREFIX + 'clone'), true);
  assert.equal(harness.commands.has(COMMAND_PREFIX + 'push'), true);
  assert.equal(harness.commands.has(COMMAND_PREFIX + 'toggleDecorations'), true);

  await harness.commands.get(COMMAND_PREFIX + 'clone').handler({
    sourceControlId: SOURCE_CONTROL_ID,
    actionId: 'clone',
    values: { remote: 'file:outside-workspace' }
  });
  assert.equal(harness.snapshots.at(-1).title, 'Remote repository address is invalid');

  harness.changeLocale('ja');
  await flush();
  assert.equal(harness.snapshots.at(-1).title, 'リモートリポジトリのアドレスが無効です');

  await activation.dispose();
  assert.equal(harness.calls.clearStates > 0, true);
  assert.equal(harness.calls.decorationClears > 0, true);
});

test('missing local SCM broker is a refresh-only localized Git state, not an activation failure', async () => {
  const harness = createContext({ locale: 'zh-CN', withoutScm: true });
  const activation = await extension.activate(harness.context);
  const state = harness.snapshots.at(-1);

  assert.equal(state.phase, 'error');
  assert.equal(state.title, 'Git 不可用');
  assert.equal(state.message, '当前无 Git 环境，请安装 Git 并配置 PATH 后刷新。');
  assert.deepEqual(state.actions.map((item) => item.command), [COMMAND_PREFIX + 'refresh']);
  assert.equal(Object.hasOwn(state, 'sections'), false);
  await activation.dispose();
});

test('worker source has no DOM, network, child-process, or cloud synchronization implementation', async () => {
  const sourceFiles = await fs.readdir(path.join(ROOT, 'src'));
  const sources = await Promise.all(sourceFiles.filter((name) => /\.(?:js|mjs)$/.test(name)).map((name) => (
    fs.readFile(path.join(ROOT, 'src', name), 'utf8')
  )));
  const combined = sources.join('\n');

  assert.doesNotMatch(combined, /\bdocument\b|\bwindow\b|\bXMLHttpRequest\b|child_process|node:child_process/i);
  assert.doesNotMatch(combined, /\brclone\b|cloud\.(?:request|sync)|remoteSync/i);
});
