'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const REPOSITORY_ID = 'scm-1234567890abcdef';

let api;

function messages(locale) {
  return require(path.join(ROOT, 'locales', locale + '.json'));
}

function error(code) {
  const value = new Error(code);
  value.code = code;
  return value;
}

function commandIds() {
  const prefix = 'bobocloud.local-scm.';
  return Object.freeze({
    refresh: prefix + 'refresh',
    initialize: prefix + 'initialize',
    clone: prefix + 'clone',
    stage: prefix + 'stage',
    unstage: prefix + 'unstage',
    commit: prefix + 'commit',
    fetch: prefix + 'fetch',
    pull: prefix + 'pull',
    push: prefix + 'push',
    checkout: prefix + 'checkout',
    createBranch: prefix + 'createBranch',
    deleteBranch: prefix + 'deleteBranch',
    selectRepository: prefix + 'selectRepository',
    loadMoreChanges: prefix + 'loadMoreChanges',
    loadMoreHistory: prefix + 'loadMoreHistory',
    toggleDecorations: prefix + 'toggleDecorations'
  });
}

function section(state, id) {
  return state.sections.find((item) => item.id === id);
}

function readyBroker(options = {}) {
  const calls = [];
  const descriptor = {
    repositoryId: REPOSITORY_ID,
    relativeRoot: 'apps/demo',
    isWorkspaceRoot: false
  };
  const allChanges = [
    { path: 'src/app.js', index: 'M', workingTree: '.', kind: 'changed', indexStats: { additions: 23, deletions: 9 }, workingTreeStats: null },
    { path: 'README.md', index: '.', workingTree: 'M', kind: 'changed', indexStats: null, workingTreeStats: { additions: 1, deletions: 0 } },
    { path: 'new/file.go', index: '?', workingTree: '?', kind: 'untracked', indexStats: null, workingTreeStats: null },
    { path: 'old-name.txt', originalPath: 'new-name.txt', index: 'R', workingTree: '.', kind: 'renamed', indexStats: null, workingTreeStats: null },
    { path: 'conflict.txt', index: 'U', workingTree: 'U', kind: 'unmerged', indexStats: null, workingTreeStats: null }
  ];
  const status = (args = {}) => {
    const offset = args.offset === undefined ? 0 : args.offset;
    const limit = args.limit === undefined ? 100 : args.limit;
    const changes = allChanges.slice(offset, offset + limit);
    const hasMore = offset + changes.length < allChanges.length;
    return {
      repositoryId: REPOSITORY_ID,
      relativeRoot: 'apps/demo',
      branch: { head: 'main', upstream: 'origin/main', ahead: 1, behind: 0, oid: '0123456789abcdef' },
      changes,
      offset,
      limit,
      total: allChanges.length,
      hasMore,
      nextOffset: hasMore ? offset + changes.length : null
    };
  };
  const commits = Array.from({ length: 5 }, (_value, index) => ({
    hash: String(index).padStart(40, '0'), parents: [], author: { name: 'Local', email: 'local@example.invalid' }, date: '2026-08-17T00:00:00Z', subject: 'Commit ' + index
  }));
  const broker = {
    calls,
    async detect() {
      calls.push(['detect']);
      return options.detectResult || { repositories: [descriptor] };
    },
    async status(args) {
      calls.push(['status', args]);
      return status(args);
    },
    async branches(args) {
      calls.push(['branches', args]);
      return {
        repositoryId: REPOSITORY_ID,
        current: 'main',
        local: [
          { name: 'main', hash: '0123', upstream: 'origin/main' },
          { name: 'feature/preview', hash: '5678', upstream: '' }
        ],
        remote: []
      };
    },
    async remotes(args) {
      calls.push(['remotes', args]);
      return { repositoryId: REPOSITORY_ID, remotes: [{ name: 'origin', urls: ['https://example.invalid/project.git'] }] };
    },
    async history(args) {
      calls.push(['history', args]);
      const offset = args.offset === undefined ? 0 : args.offset;
      const limit = args.limit === undefined ? 100 : args.limit;
      const page = commits.slice(offset, offset + limit);
      const hasMore = offset + page.length < commits.length;
      return {
        repositoryId: REPOSITORY_ID,
        commits: page,
        offset,
        limit,
        hasMore,
        nextOffset: hasMore ? offset + page.length : null
      };
    },
    async stage(args) { calls.push(['stage', args]); return status(args); },
    async unstage(args) { calls.push(['unstage', args]); return status(args); },
    async commit(args) { calls.push(['commit', args]); return { repositoryId: REPOSITORY_ID, commit: 'a'.repeat(40) }; },
    async fetch(args) { calls.push(['fetch', args]); return { repositoryId: REPOSITORY_ID, remote: 'origin', branch: 'main', output: '' }; },
    async pull(args) { calls.push(['pull', args]); return { repositoryId: REPOSITORY_ID, remote: 'origin', branch: 'main', output: '' }; },
    async push(args) { calls.push(['push', args]); return { repositoryId: REPOSITORY_ID, remote: 'origin', branch: 'main', output: '' }; },
    async checkout(args) { calls.push(['checkout', args]); return { repositoryId: REPOSITORY_ID, branch: args.branch }; },
    async createBranch(args) { calls.push(['createBranch', args]); return { repositoryId: REPOSITORY_ID, branch: args.name, checkedOut: args.checkout }; },
    async deleteBranch(args) { calls.push(['deleteBranch', args]); return { repositoryId: REPOSITORY_ID, branch: args.name, deleted: true }; },
    async init() { calls.push(['init']); return descriptor; },
    async clone(args) { calls.push(['clone', args]); return descriptor; }
  };
  return broker;
}

function createHarness(git, locale = 'en') {
  const snapshots = [];
  const decorationSets = [];
  const decorationClears = [];
  const controller = new api.LocalScmController({
    git,
    translate: api.createTranslator({ en: messages('en'), 'zh-CN': messages('zh-CN'), ja: messages('ja') }, locale),
    commands: commandIds(),
    publish: async (state) => snapshots.push(state),
    decorations: {
      async set(entries) { decorationSets.push(entries); },
      async clear(paths) { decorationClears.push(paths); }
    },
    changePageSize: 2,
    historyPageSize: 2
  });
  return { controller, snapshots, decorationSets, decorationClears };
}

test.before(async () => {
  api = await import(pathToFileURL(path.join(ROOT, 'src', 'local-scm-controller.mjs')).href);
});

test('empty-workspace fixture produces an initialize-or-clone local-only state', async () => {
  const fixture = JSON.parse(await fs.readFile(path.join(ROOT, 'fixtures', 'empty-workspace', 'scenario.json'), 'utf8'));
  const git = readyBroker({ detectResult: fixture.detect });
  const { controller, snapshots, decorationClears } = createHarness(git, 'zh-CN');
  const result = await controller.start();
  const state = snapshots.at(-1);

  assert.equal(result.ok, true);
  assert.equal(state.phase, fixture.expectedPhase);
  assert.equal(state.title, '未检测到本地仓库');
  assert.match(state.message, /初始化此本地工作区/);
  assert.equal(state.summary.items[0].value, '此扩展仅操作本地工作区，不会改变云端同步。');
  assert.equal(state.actions.some((item) => item.id === 'initialize'), true);
  assert.equal(state.actions.some((item) => item.id === 'clone'), true);
  assert.equal(decorationClears.length > 0, true);
});

test('unavailable Git presents a refreshable localized error state', async () => {
  const git = { async detect() { throw error('SCM_GIT_UNAVAILABLE'); } };
  const { controller, snapshots } = createHarness(git, 'zh-CN');
  const result = await controller.start();
  const state = snapshots.at(-1);

  assert.equal(result.ok, false);
  assert.deepEqual(result.error, {
    code: 'SCM_GIT_UNAVAILABLE',
    message: '当前无 Git 环境，请安装 Git 并配置 PATH 后刷新。'
  });
  assert.equal(Object.getPrototypeOf(result.error), Object.prototype);
  assert.equal(state.phase, 'error');
  assert.equal(state.title, 'Git 不可用');
  assert.equal(state.message, '当前无 Git 环境，请安装 Git 并配置 PATH 后刷新。');
  assert.deepEqual(state.actions.map((item) => item.command), ['bobocloud.local-scm.refresh']);
  assert.equal(Object.hasOwn(state, 'sections'), false);
  assert.equal(Object.hasOwn(state, 'summary'), false);
});

test('startup before a workspace is open presents a dedicated recoverable state', async () => {
  const git = { async detect() { throw error('SCM_GIT_NO_WORKSPACE'); } };
  const { controller, snapshots } = createHarness(git, 'zh-CN');
  const result = await controller.start();
  const state = snapshots.at(-1);

  assert.deepEqual(result.error, {
    code: 'SCM_GIT_NO_WORKSPACE',
    message: '请先打开本地工作区，然后刷新源代码管理。'
  });
  assert.equal(state.phase, 'error');
  assert.equal(state.title, '尚未打开本地工作区');
  assert.equal(state.message, '请先打开本地工作区，然后刷新源代码管理。');
  assert.deepEqual(state.actions.map((item) => item.command), ['bobocloud.local-scm.refresh']);
});

test('invalid clone address is rejected locally and never becomes a network request', async () => {
  const git = readyBroker({ detectResult: { repositories: [] } });
  const { controller, snapshots } = createHarness(git, 'zh-CN');
  await controller.start();
  const result = await controller.cloneRemote('file:///outside-workspace/repository.git');
  const state = snapshots.at(-1);

  assert.equal(result.ok, false);
  assert.deepEqual(result.error, {
    code: 'SCM_GIT_OPERATION_FAILED',
    message: '请输入有效的 HTTPS 或 SSH 远程仓库地址，然后重试。'
  });
  assert.equal(Object.getPrototypeOf(result.error), Object.prototype);
  assert.equal(state.title, '远程仓库地址无效');
  assert.equal(state.message, '请输入有效的 HTTPS 或 SSH 远程仓库地址，然后重试。');
  assert.equal(git.calls.some(([method]) => method === 'clone'), false);
});

test('nested repository status uses broker offsets, preserves groups, and publishes only workspace-relative decorations', async () => {
  const git = readyBroker();
  const { controller, snapshots, decorationSets, decorationClears } = createHarness(git);
  await controller.start();
  await controller.loadMoreChanges();
  await controller.loadMoreChanges();
  const state = snapshots.at(-1);
  const decorations = decorationSets.at(-1);

  assert.equal(state.phase, 'ready');
  assert.equal(state.summary.title, 'Local workspace source control');
  assert.deepEqual(git.calls.filter(([method]) => method === 'status').map(([, args]) => args), [
    { repositoryId: REPOSITORY_ID, offset: 0, limit: 2 },
    { repositoryId: REPOSITORY_ID, offset: 2, limit: 2 },
    { repositoryId: REPOSITORY_ID, offset: 4, limit: 2 }
  ]);
  assert.deepEqual(decorations, [
    { path: 'apps/demo/src/app.js', status: 'modified' },
    { path: 'apps/demo/README.md', status: 'modified' },
    { path: 'apps/demo/new/file.go', status: 'untracked' },
    { path: 'apps/demo/old-name.txt', status: 'renamed' },
    { path: 'apps/demo/conflict.txt', status: 'conflicted' }
  ]);
  assert.equal(section(state, 'staged').items.length, 2);
  assert.equal(section(state, 'unstaged').items.length, 1);
  assert.equal(section(state, 'untracked').items.length, 1);
  assert.equal(section(state, 'conflicted').items.length, 1);
  assert.equal(section(state, 'staged').items[0].meta, '+23 -9');
  assert.equal(section(state, 'unstaged').items[0].meta, '+1 -0');
  assert.equal(section(state, 'untracked').items[0].meta, '?');
  assert.equal(state.actions.find((item) => item.id === 'commit').form.fields[0].maxLength, 4096);
  assert.equal(state.summary.items.find((item) => item.label === 'File tree status').value, 'On');
  assert.equal(state.actions.find((item) => item.id === 'toggleDecorations').title, 'Hide file tree status');

  const clearsBeforeToggle = decorationClears.length;
  await controller.handleCommand(commandIds().toggleDecorations, {});
  assert.equal(decorationClears.length, clearsBeforeToggle + 1);
  assert.equal(snapshots.at(-1).summary.items.find((item) => item.label === 'File tree status').value, 'Off');
  const setsBeforeEnable = decorationSets.length;
  await controller.handleCommand(commandIds().toggleDecorations, {});
  assert.equal(decorationSets.length, setsBeforeEnable + 1);
  assert.equal(snapshots.at(-1).actions.find((item) => item.id === 'toggleDecorations').title, 'Hide file tree status');

  await controller.stage(['src/app.js']);
  const stageCall = git.calls.find(([method]) => method === 'stage');
  assert.deepEqual(stageCall[1], { repositoryId: REPOSITORY_ID, paths: ['src/app.js'] });
});

test('ready state preloads the first history page and continues with broker offsets', async () => {
  const git = readyBroker();
  const { controller, snapshots } = createHarness(git);
  await controller.start();

  let state = snapshots.at(-1);
  const initialHistoryCalls = git.calls.filter(([method]) => method === 'history');
  assert.deepEqual(initialHistoryCalls.map(([, args]) => args), [{
    repositoryId: REPOSITORY_ID,
    offset: 0,
    limit: 2
  }]);
  assert.equal(section(state, 'history').items.length, 2);
  assert.equal(section(state, 'history').loadMore.command, 'bobocloud.local-scm.loadMoreHistory');

  await controller.loadMoreHistory();
  state = snapshots.at(-1);
  const historyCalls = git.calls.filter(([method]) => method === 'history');
  assert.deepEqual(historyCalls[1][1], { repositoryId: REPOSITORY_ID, offset: 2, limit: 2 });
  assert.equal(section(state, 'history').items.length, 4);

  const featureBranch = section(state, 'branches').items.find((item) => item.title === 'feature/preview');
  await controller.handleCommand(commandIds().checkout, { itemId: featureBranch.id, values: {} });
  assert.deepEqual(git.calls.find(([method]) => method === 'checkout')[1], {
    repositoryId: REPOSITORY_ID,
    branch: 'feature/preview',
    force: false
  });
  state = snapshots.at(-1);
  assert.equal(section(state, 'history').items.length, 2);
  assert.deepEqual(git.calls.filter(([method]) => method === 'history')[2][1], {
    repositoryId: REPOSITORY_ID,
    offset: 0,
    limit: 2
  });

  await controller.createBranch('feature/local-only', true);
  await controller.deleteBranch('feature/local-only', true);
  assert.deepEqual(git.calls.find(([method]) => method === 'createBranch')[1], {
    repositoryId: REPOSITORY_ID,
    name: 'feature/local-only',
    checkout: true
  });
  assert.deepEqual(git.calls.find(([method]) => method === 'deleteBranch')[1], {
    repositoryId: REPOSITORY_ID,
    name: 'feature/local-only',
    force: true
  });
  state = snapshots.at(-1);
  assert.equal(state.phase, 'ready');
});

test('a failed repository mutation preserves the current status and history context', async () => {
  const git = readyBroker();
  git.push = async () => { throw error('SCM_GIT_AUTH_REQUIRED'); };
  const { controller, snapshots, decorationClears } = createHarness(git, 'zh-CN');
  await controller.start();
  const clearsBeforePush = decorationClears.length;

  const result = await controller.push({ remote: 'origin', branch: 'main' });
  const state = snapshots.at(-1);

  assert.equal(result.ok, false);
  assert.deepEqual(result.error, {
    code: 'SCM_GIT_AUTH_REQUIRED',
    message: '无法在本地工作区完成该操作。请刷新后重试。'
  });
  assert.equal(Object.getPrototypeOf(result.error), Object.prototype);
  assert.equal(state.phase, 'ready');
  assert.equal(state.message, '无法在本地工作区完成该操作。请刷新后重试。');
  assert.equal(section(state, 'staged').items.length, 1);
  assert.equal(section(state, 'history').items.length, 2);
  assert.equal(state.actions.some((item) => item.id === 'push'), true);
  assert.equal(decorationClears.length, clearsBeforePush);
});

test('remote clone broker failure exposes a recoverable remote error instead of claiming cloud state', async () => {
  const git = readyBroker({ detectResult: { repositories: [] } });
  git.clone = async () => { throw error('SCM_GIT_CLONE_FAILED'); };
  const { controller, snapshots } = createHarness(git);
  await controller.start();
  const result = await controller.cloneRemote('https://github.com/example/local-only.git');
  const state = snapshots.at(-1);

  assert.equal(result.ok, false);
  assert.equal(state.title, 'Unable to clone the remote repository');
  assert.match(state.message, /local Git service/i);
  assert.deepEqual(state.actions.map((item) => item.command), ['bobocloud.local-scm.refresh']);
});

test('ambiguous local clone addresses are rejected before they reach the broker', async () => {
  const git = readyBroker({ detectResult: { repositories: [] } });
  const { controller } = createHarness(git);
  await controller.start();

  await controller.cloneRemote('file:relative-repository');
  await controller.cloneRemote('C:/local-repository');

  assert.equal(git.calls.some(([method]) => method === 'clone'), false);
});

test('a nonempty-workspace clone response remains local and tells the user why it was not written', async () => {
  const git = readyBroker({ detectResult: { repositories: [] } });
  git.clone = async () => { throw error('SCM_GIT_WORKSPACE_NOT_EMPTY'); };
  const { controller, snapshots } = createHarness(git, 'zh-CN');
  await controller.start();
  const result = await controller.cloneRemote('https://github.com/example/local-only.git');
  const state = snapshots.at(-1);

  assert.equal(result.ok, false);
  assert.equal(state.title, '本地工作区不是空目录');
  assert.match(state.message, /空的本地工作区/);
  assert.deepEqual(state.actions.map((item) => item.command), ['bobocloud.local-scm.refresh']);
});
