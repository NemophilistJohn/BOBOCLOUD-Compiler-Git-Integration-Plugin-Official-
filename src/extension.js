import en from '../locales/en.json';
import zhCN from '../locales/zh-CN.json';
import ja from '../locales/ja.json';
import { LocalScmController, createTranslator } from './local-scm-controller.mjs';

const EXTENSION_ID = 'bobocloud.local-scm';
const SOURCE_CONTROL_ID = EXTENSION_ID + '.view';
const DECORATION_ID = EXTENSION_ID + '.tree-status';

const COMMANDS = Object.freeze({
  refresh: EXTENSION_ID + '.refresh',
  initialize: EXTENSION_ID + '.initialize',
  clone: EXTENSION_ID + '.clone',
  stage: EXTENSION_ID + '.stage',
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
  loadMoreHistory: EXTENSION_ID + '.loadMoreHistory'
});

const LOCALES = Object.freeze({ en, 'zh-CN': zhCN, ja });
let activeSession = null;

function disposable(value) {
  return value && typeof value.dispose === 'function' ? value : { dispose() {} };
}

function localize(context) {
  if (context.i18n && typeof context.i18n.t === 'function') {
    return (key, params) => context.i18n.t(key, params);
  }
  return createTranslator(LOCALES, context.i18n && context.i18n.locale);
}

function requireStateView(view) {
  if (!view || typeof view.setState !== 'function' || typeof view.clearState !== 'function') {
    const error = new Error('BOBOCloud Plugin API 1.2 source-control state host is unavailable.');
    error.code = 'EXTENSION_UNAVAILABLE';
    throw error;
  }
  return view;
}

function commandMetadata(t, key) {
  return { title: t(key), category: t('activity.title') };
}

function validSourceControlInvocation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  if (value.sourceControlId && value.sourceControlId !== SOURCE_CONTROL_ID) return null;
  return value;
}

async function disposeSession(session) {
  if (!session || session.disposed) return;
  session.disposed = true;
  try { disposable(session.localeSubscription).dispose(); } catch (_) {}
  try { await session.controller.dispose(); } catch (_) {}
  try { await session.view.clearState(); } catch (_) {}
  for (const registration of session.registrations.slice().reverse()) {
    try { disposable(registration).dispose(); } catch (_) {}
  }
}

export async function activate(context) {
  await disposeSession(activeSession);
  activeSession = null;

  const t = localize(context);
  const registrations = [];
  let view;
  let decorations;
  let controller;
  try {
    view = requireStateView(await context.sourceControl.register({
      id: SOURCE_CONTROL_ID,
      title: t('activity.title'),
      icon: 'git-branch',
      order: 20,
      openCommand: COMMANDS.refresh
    }));
    registrations.push(view);
    decorations = await context.fileDecorations.registerScm({ id: DECORATION_ID, priority: 100 });
    registrations.push(decorations);

    controller = new LocalScmController({
      // An unavailable or older host still activates the state view. The
      // controller converts the missing broker into the localized Git error
      // state instead of failing extension activation.
      git: context.scm && context.scm.git || {},
      decorations,
      commands: COMMANDS,
      translate: t,
      publish: (state) => view.setState(state)
    });

    for (const [name, id] of Object.entries(COMMANDS)) {
      const registration = await context.commands.register(id, (invocation) => {
        const event = validSourceControlInvocation(invocation);
        return event === null ? { ok: false, ignored: true } : controller.handleCommand(id, event);
      }, commandMetadata(t, commandKeyFor(name)));
      registrations.push(registration);
    }

    const localeSubscription = context.i18n && typeof context.i18n.onDidChange === 'function'
      ? context.i18n.onDidChange(() => { void controller.refreshLocalization(); })
      : null;
    const session = { view, decorations, controller, registrations, localeSubscription, disposed: false };
    activeSession = session;
    await controller.start();
    return { dispose: () => disposeSession(session) };
  } catch (error) {
    try { if (controller) await controller.dispose(); } catch (_) {}
    try { if (view) await view.clearState(); } catch (_) {}
    for (const registration of registrations.slice().reverse()) {
      try { disposable(registration).dispose(); } catch (_) {}
    }
    throw error;
  }
}

function commandKeyFor(name) {
  if (name === 'loadMoreChanges' || name === 'loadMoreHistory') return 'action.loadMore';
  if (name === 'selectRepository') return 'section.repositories';
  return 'action.' + name;
}

export async function deactivate() {
  await disposeSession(activeSession);
  activeSession = null;
}
