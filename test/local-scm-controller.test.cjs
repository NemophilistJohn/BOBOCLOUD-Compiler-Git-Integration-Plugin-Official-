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
    publish: prefix + 'publish',
    stage: prefix + 'stage',
    stageAll: prefix + 'stageAll',
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
    toggleDecorations: prefix + 'toggleDecorations',
    viewDiff: prefix + 'viewDiff',
    setRemote: prefix + 'setRemote',
    selectPage: prefix + 'selectPage', selectRemote: prefix + 'selectRemote',
    configureRemote: prefix + 'configureRemote', removeRemote: prefix + 'removeRemote',
    commitAndPush: prefix + 'commitAndPush', retryPush: prefix + 'retryPush', pushSelected: prefix + 'pushSelected', fetchSelected: prefix + 'fetchSelected'
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
      branch: { head: 'main', upstream: 'origin/main', ahead: 1, behind: 0, oid: '0123456789abcdef'.padEnd(40, '0') },
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
  const configuredRemotes = [{ name: 'origin', urls: ['https://example.invalid/project.git'], pushUrls: ['https://example.invalid/project.git'], label: '', platform: '', selected: false, pushFingerprint: 'f'.repeat(64) }];
  const broker = {
    calls,
    configuredRemotes,
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
      return { repositoryId: REPOSITORY_ID, remotes: configuredRemotes.map((entry) => ({ ...entry })) };
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
    async stageAll(args) { calls.push(['stageAll', args]); return status(args); },
    async unstage(args) { calls.push(['unstage', args]); return status(args); },
    async commit(args) { calls.push(['commit', args]); return { repositoryId: REPOSITORY_ID, commit: 'a'.repeat(40) }; },
    async fetch(args) { calls.push(['fetch', args]); return { repositoryId: REPOSITORY_ID, remote: 'origin', branch: 'main', output: '' }; },
    async pull(args) { calls.push(['pull', args]); return { repositoryId: REPOSITORY_ID, remote: 'origin', branch: 'main', output: '' }; },
    async push(args) { calls.push(['push', args]); return { repositoryId: REPOSITORY_ID, remote: 'origin', branch: 'main', output: '' }; },
    async diff(args) { calls.push(['diff', args]); return { repositoryId: REPOSITORY_ID, content: '@@ -1 +1 @@\n-old\n+new\n' }; },
    async checkout(args) { calls.push(['checkout', args]); return { repositoryId: REPOSITORY_ID, branch: args.branch }; },
    async createBranch(args) { calls.push(['createBranch', args]); return { repositoryId: REPOSITORY_ID, branch: args.name, checkedOut: args.checkout }; },
    async deleteBranch(args) { calls.push(['deleteBranch', args]); return { repositoryId: REPOSITORY_ID, branch: args.name, deleted: true }; },
    async init() { calls.push(['init']); return descriptor; },
    async setRemote(args) { calls.push(['setRemote', args]); return { repositoryId: REPOSITORY_ID, name: args.name, url: args.url }; },
    async configureRemote(args) {
      calls.push(['configureRemote', args]);
      let entry = configuredRemotes.find((item) => item.name === args.name);
      if (args.create) { entry = { name: args.name, urls: [args.url], pushUrls: [args.url], selected: false, pushFingerprint: 'a'.repeat(64) }; configuredRemotes.push(entry); }
      if (!entry) throw error('SCM_GIT_REMOTE_CONFLICT');
      for (const key of ['label', 'platform', 'selected']) if (args[key] !== undefined) entry[key] = args[key];
      if (args.url) entry.urls = [args.url];
      return { repositoryId: REPOSITORY_ID, name: args.name };
    },
    async removeRemote(args) { calls.push(['removeRemote', args]); configuredRemotes.splice(configuredRemotes.findIndex((entry) => entry.name === args.name), 1); return { repositoryId: REPOSITORY_ID, name: args.name, removed: true }; },
    async clone(args) { calls.push(['clone', args]); return descriptor; }
  };
  return broker;
}

function createHarness(git, locale = 'en', enhancedView = false) {
  const snapshots = [];
  const decorationSets = [];
  const decorationClears = [];
  const controller = new api.LocalScmController({
    git,
    translate: api.createTranslator({ en: messages('en'), 'zh-CN': messages('zh-CN'), ja: messages('ja') }, locale),
    commands: commandIds(),
    enhancedView,
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
  assert.equal(Object.hasOwn(state, 'summary'), false);
  assert.equal(state.actions.some((item) => item.id === 'initialize'), true);
  assert.equal(state.actions.some((item) => item.id === 'clone'), true);
  assert.equal(decorationClears.length > 0, true);
});

test('an unborn local repository is ready for its first publish instead of failing history', async () => {
  const git = readyBroker();
  const originalStatus = git.status;
  const originalHistory = git.history;
  let published = false;
  git.status = async (args) => {
    const result = await originalStatus(args);
    result.branch = published
      ? { head: 'main', upstream: 'origin/main', ahead: 0, behind: 0, oid: 'a'.repeat(40) }
      : { head: 'master', upstream: '', ahead: 0, behind: 0, oid: '(initial)' };
    return result;
  };
  git.history = async (args) => {
    if (!published) {
      git.calls.push(['history', args]);
      return { repositoryId: REPOSITORY_ID, commits: [], offset: args.offset || 0, limit: args.limit || 30, hasMore: false, nextOffset: null };
    }
    return originalHistory(args);
  };
  git.push = async (args) => {
    git.calls.push(['push', args]);
    published = true;
    return { repositoryId: REPOSITORY_ID, remote: 'origin', branch: 'main', output: '' };
  };
  const { controller, snapshots } = createHarness(git, 'en');
  await controller.start();
  const unborn = snapshots.at(-1);

  assert.equal(unborn.phase, 'ready');
  assert.match(unborn.message, /no commits yet/);
  assert.equal(unborn.dashboard.tabs.active, 'changes');
  assert.equal(unborn.actions.find((item) => item.id === 'commit').placement, 'inline');
  assert.equal(unborn.actions.find((item) => item.id === 'stageAll').placement, 'toolbar');

  const result = await controller.publishInitial({
    remote: 'https://github.com/example/empty.git',
    branch: 'main',
    message: 'Initial project'
  });
  assert.equal(result.ok, true);
  assert.deepEqual(
    git.calls.filter(([method]) => ['createBranch', 'stageAll', 'commit', 'setRemote', 'push'].includes(method)).map(([method]) => method),
    ['createBranch', 'stageAll', 'commit', 'setRemote', 'push']
  );
  assert.equal(snapshots.at(-1).phase, 'ready');
  assert.equal(snapshots.at(-1).dashboard.items[0].description, 'project');
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

  assert.deepEqual(result, { ok: true, phase: 'empty' });
  assert.equal(state.phase, 'empty');
  assert.equal(state.title, '源代码管理');
  assert.equal(state.message, '工作区为空');
  assert.deepEqual(state.actions, []);
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
  assert.equal(state.dashboard.tabs.active, 'changes');
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
  assert.equal(state.actions.find((item) => item.id === 'toggleDecorations').title, 'Hide file tree status');

  const clearsBeforeToggle = decorationClears.length;
  await controller.handleCommand(commandIds().toggleDecorations, {});
  assert.equal(decorationClears.length, clearsBeforeToggle + 1);
  const setsBeforeEnable = decorationSets.length;
  await controller.handleCommand(commandIds().toggleDecorations, {});
  assert.equal(decorationSets.length, setsBeforeEnable + 1);
  assert.equal(snapshots.at(-1).actions.find((item) => item.id === 'toggleDecorations').title, 'Hide file tree status');

  await controller.stage(['src/app.js']);
  const stageCall = git.calls.find(([method]) => method === 'stage');
  assert.deepEqual(stageCall[1], { repositoryId: REPOSITORY_ID, paths: ['src/app.js'] });
});

test('history page reads the selected remote and paginates its commit graph', async () => {
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
  assert.equal(section(state, 'history'), undefined);
  await controller.selectPage('history');
  state = snapshots.at(-1);
  assert.equal(state.dashboard.selectionMode, 'single');
  assert.equal(section(state, 'history').items.length, 2);
  assert.equal(section(state, 'history').loadMore.command, 'bobocloud.local-scm.loadMoreHistory');

  await controller.loadMoreHistory();
  state = snapshots.at(-1);
  const historyCalls = git.calls.filter(([method]) => method === 'history');
  assert.deepEqual(historyCalls[1][1], { repositoryId: REPOSITORY_ID, offset: 0, limit: 2, remote: 'origin' });
  assert.deepEqual(historyCalls[2][1], { repositoryId: REPOSITORY_ID, offset: 2, limit: 2, remote: 'origin' });
  assert.equal(section(state, 'history').items.length, 4);
  assert.equal(section(state, 'history').items[0].graph.node, 0);

  await controller.checkout('feature/preview');
  assert.deepEqual(git.calls.find(([method]) => method === 'checkout')[1], {
    repositoryId: REPOSITORY_ID,
    branch: 'feature/preview',
    force: false
  });
  state = snapshots.at(-1);
  assert.equal(section(state, 'history').items.length, 2);
  assert.deepEqual(git.calls.filter(([method]) => method === 'history').at(-1)[1], {
    repositoryId: REPOSITORY_ID,
    offset: 0,
    limit: 2,
    remote: 'origin'
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
    message: '请配置本机凭据管理器或 SSH agent 后重试；此处无法弹出交互式凭据提示。'
  });
  assert.equal(Object.getPrototypeOf(result.error), Object.prototype);
  assert.equal(state.phase, 'ready');
  assert.equal(state.message, '请配置本机凭据管理器或 SSH agent 后重试；此处无法弹出交互式凭据提示。');
  assert.equal(section(state, 'staged').items.length, 1);
  assert.equal(state.dashboard.tabs.active, 'changes');
  assert.equal(state.actions.some((item) => item.id === 'commit'), true);
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

test('blank optional branch and multiline commit work with the configured upstream', async () => {
  const git = readyBroker();
  const { controller } = createHarness(git);
  await controller.start();
  assert.equal((await controller.commit('Title\n\nDetails')).ok, true);
  assert.equal(git.calls.find(([name]) => name === 'commit')[1].message, 'Title\n\nDetails');
  assert.equal((await controller.push({ remote: '', branch: '' })).ok, true);
  assert.deepEqual(git.calls.find(([name]) => name === 'push')[1], { repositoryId: REPOSITORY_ID, remote: 'origin' });
  assert.equal(controller.state.message, 'Push completed.');
});

test('enhanced rows preview without staging and offer an independent staging action', async () => {
  const git = readyBroker();
  const { controller } = createHarness(git, 'en', true);
  await controller.start();
  await controller.loadMoreChanges();
  const file = section(controller.state, 'unstaged').items[0];
  assert.equal(file.command, commandIds().viewDiff);
  assert.equal(file.secondaryAction.command, commandIds().stage);
  await controller.handleCommand(file.command, { itemId: file.id });
  assert.match(controller.state.detail.content, /\+new/);
  assert.equal(git.calls.some(([name]) => name === 'stage'), false);
  await controller.handleCommand(file.secondaryAction.command, { itemId: file.id });
  assert.deepEqual(git.calls.find(([name]) => name === 'stage')[1].paths, ['README.md']);
});

test('failed initial publish reloads the repository after the first commit', async () => {
  const git = readyBroker();
  let initial = true;
  const originalStatus = git.status;
  git.detect = async () => ({ repositories: [{ repositoryId: REPOSITORY_ID, relativeRoot: '', isWorkspaceRoot: true }] });
  git.status = async (args) => {
    const page = await originalStatus(args);
    return { ...page, relativeRoot: '', branch: { ...page.branch, head: 'main', oid: initial ? '(initial)' : 'a'.repeat(40) } };
  };
  git.commit = async () => { initial = false; return { repositoryId: REPOSITORY_ID }; };
  git.push = async () => { throw error('SCM_GIT_AUTH_REQUIRED'); };
  const { controller } = createHarness(git);
  await controller.start();
  assert.equal((await controller.publishInitial({ remote: 'https://example.invalid/a.git', branch: 'main', message: 'First' })).ok, false);
  assert.equal(controller.state.phase, 'ready');
  assert.equal(controller.state.actions.some((item) => item.id === 'commit'), true);
  assert.match(controller.state.message, /credential helper/);
});

test('a successful commit followed by a refresh failure is not reported as a failed commit', async () => {
  const git = readyBroker();
  const { controller } = createHarness(git);
  await controller.start();
  git.detect = async () => { throw error('SCM_GIT_OPERATION_FAILED'); };
  const result = await controller.commit('Keep this commit');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'SCM_GIT_REFRESH_AFTER_SUCCESS');
  assert.match(controller.state.message, /Git completed the operation/);
  assert.equal(git.calls.filter(([name]) => name === 'commit').length, 1);
});

test('remote card selections persist across controller sessions', async () => {
  const git = readyBroker();
  const { controller } = createHarness(git);
  await controller.start();
  const card = controller.state.dashboard.items[0];
  assert.equal(card.selected, false);
  await controller.handleCommand(card.command, { itemId: card.id });
  assert.equal(controller.state.dashboard.items[0].selected, true);
  const second = createHarness(git).controller;
  await second.start();
  assert.equal(second.state.dashboard.items[0].selected, true);
});

test('multi-remote commit happens once, reports individual failures, and retries only failed pushes', async () => {
  const git = readyBroker();
  git.configuredRemotes[0].selected = true;
  git.configuredRemotes.push({ name: 'mirror', urls: ['https://example.invalid/mirror.git'], label: 'Mirror', platform: 'Git', selected: true, pushFingerprint: 'e'.repeat(64) });
  let mirrorFails = true;
  git.push = async (args) => { git.calls.push(['push', args]); if (args.remote === 'mirror' && mirrorFails) throw error('SCM_GIT_AUTH_REQUIRED'); return { output: '' }; };
  const { controller } = createHarness(git);
  await controller.start();
  assert.equal((await controller.commitAndPush('Ship once\n\nDetails')).ok, true);
  assert.equal(git.calls.filter(([name]) => name === 'commit').length, 1);
  assert.equal(git.calls.find(([name]) => name === 'commit')[1].expectedBranch, 'main');
  assert.deepEqual(git.calls.filter(([name]) => name === 'push').map(([, args]) => args.remote), ['origin', 'mirror']);
  assert.equal(git.calls.find(([name]) => name === 'push')[1].expectedHead, 'a'.repeat(40));
  assert.equal(git.calls.find(([name]) => name === 'push')[1].expectedBranch, 'main');
  assert.deepEqual(section(controller.state, 'results').items.map((item) => item.badge), ['Pushed', 'Failed']);
  mirrorFails = false;
  await controller.retryPush();
  assert.equal(git.calls.filter(([name]) => name === 'commit').length, 1);
  assert.deepEqual(git.calls.filter(([name]) => name === 'push').map(([, args]) => args.remote), ['origin', 'mirror', 'mirror']);
  assert.deepEqual(section(controller.state, 'results').items.map((item) => item.badge), ['Pushed', 'Pushed']);
});

test('an unknown push outcome is not automatically retried', async () => {
  const git = readyBroker();
  git.configuredRemotes[0].selected = true;
  git.push = async (args) => { git.calls.push(['push', args]); throw error('SCM_GIT_OUTCOME_UNKNOWN'); };
  const { controller } = createHarness(git);
  await controller.start();
  await controller.commitAndPush('One commit');
  assert.equal(section(controller.state, 'results').items[0].badge, 'Unconfirmed');
  assert.equal(controller.state.actions.some((item) => item.id === 'retryPush'), false);
  await controller.retryPush();
  assert.equal(git.calls.filter(([name]) => name === 'push').length, 1);
});

test('repeated commit-and-push requests cannot create duplicate commits', async () => {
  const git = readyBroker();
  git.configuredRemotes[0].selected = true;
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  git.commit = async (args) => { git.calls.push(['commit', args]); await barrier; return { commit: 'a'.repeat(40) }; };
  const { controller } = createHarness(git);
  await controller.start();
  const first = controller.commitAndPush('One commit');
  const duplicate = await controller.commitAndPush('One commit');
  assert.equal(duplicate.ignored, true);
  release();
  await first;
  assert.equal(git.calls.filter(([name]) => name === 'commit').length, 1);
});

test('vertical graph retains separate lanes through a merge', async () => {
  const { buildCommitGraph } = await import(pathToFileURL(path.join(ROOT, 'src', 'local-scm-dashboard.mjs')).href);
  const rows = buildCommitGraph([
    { hash: 'merge', parents: ['main', 'feature'] },
    { hash: 'feature', parents: ['base'] },
    { hash: 'main', parents: ['base'] },
    { hash: 'base', parents: [] }
  ]);
  assert.equal(rows[0].links.filter((link) => link.viaNode).length, 2);
  assert.equal(rows[1].incoming, true);
  assert.equal(rows[2].incoming, true);
  assert.equal(rows[3].links.length, 0);
  assert.ok(rows.every((row) => row.width >= 1 && row.width <= 12 && row.node < row.width));
});
