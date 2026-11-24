import en from '../locales/en.json';
import zhCN from '../locales/zh-CN.json';
import ja from '../locales/ja.json';
import { createTranslator } from './local-scm-controller.mjs';
import { LocalScmExtensionSession } from './local-scm-session.mjs';

const EXTENSION_ID = 'bobocloud.local-scm';
const SOURCE_CONTROL_ID = EXTENSION_ID + '.view';
const DECORATION_ID = EXTENSION_ID + '.tree-status';

const COMMANDS = Object.freeze({
  refresh: EXTENSION_ID + '.refresh',
  initialize: EXTENSION_ID + '.initialize',
  clone: EXTENSION_ID + '.clone',
  publish: EXTENSION_ID + '.publish',
  stage: EXTENSION_ID + '.stage',
  stageAll: EXTENSION_ID + '.stageAll',
  unstage: EXTENSION_ID + '.unstage',
  commit: EXTENSION_ID + '.commit',
  fetch: EXTENSION_ID + '.fetch',
  pull: EXTENSION_ID + '.pull',
  push: EXTENSION_ID + '.push',
  checkout: EXTENSION_ID + '.checkout',
  createBranch: EXTENSION_ID + '.createBranch',
  deleteBranch: EXTENSION_ID + '.deleteBranch',
  selectRepository: EXTENSION_ID + '.selectRepository',
  loadMoreChanges: EXTENSION_ID + '.loadMoreChanges',
  loadMoreHistory: EXTENSION_ID + '.loadMoreHistory',
  toggleDecorations: EXTENSION_ID + '.toggleDecorations',
  viewDiff: EXTENSION_ID + '.viewDiff',
  setRemote: EXTENSION_ID + '.setRemote',
  selectPage: EXTENSION_ID + '.selectPage',
  selectRemote: EXTENSION_ID + '.selectRemote',
  configureRemote: EXTENSION_ID + '.configureRemote',
  removeRemote: EXTENSION_ID + '.removeRemote',
  commitAndPush: EXTENSION_ID + '.commitAndPush',
  retryPush: EXTENSION_ID + '.retryPush',
  pushSelected: EXTENSION_ID + '.pushSelected',
  fetchSelected: EXTENSION_ID + '.fetchSelected'
});

const LOCALES = Object.freeze({ en, 'zh-CN': zhCN, ja });
let activeSession = null;

function localize(context) {
  if (context.i18n && typeof context.i18n.t === 'function') {
    return (key, params) => context.i18n.t(key, params);
  }
  return createTranslator(LOCALES, context.i18n && context.i18n.locale);
}

export async function activate(context) {
  if (activeSession) await activeSession.dispose();
  activeSession = null;

  const t = localize(context);
  const session = new LocalScmExtensionSession({
    context,
    commands: COMMANDS,
    translate: t,
    sourceControlId: SOURCE_CONTROL_ID,
    decorationId: DECORATION_ID,
    commandKey: commandKeyFor
  });
  await session.start();
  activeSession = session;
  return { dispose: () => session.dispose() };
}

function commandKeyFor(name) {
  if (name === 'loadMoreChanges' || name === 'loadMoreHistory') return 'action.loadMore';
  if (name === 'toggleDecorations') return 'action.toggleDecorations';
  if (name === 'selectRepository') return 'section.repositories';
  return 'action.' + name;
}

export async function deactivate() {
  if (activeSession) await activeSession.dispose();
  activeSession = null;
}
