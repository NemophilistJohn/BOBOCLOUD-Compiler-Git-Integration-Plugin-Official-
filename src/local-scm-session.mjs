import { LocalScmController } from './local-scm-controller.mjs';

function disposable(value) {
  return value && typeof value.dispose === 'function' ? value : { dispose() {} };
}

function requireStateView(view) {
  if (!view || typeof view.setState !== 'function' || typeof view.clearState !== 'function') {
    const error = new Error('BOBOCloud source-control state host is unavailable.');
    error.code = 'EXTENSION_UNAVAILABLE';
    throw error;
  }
  return view;
}

export class LocalScmExtensionSession {
  constructor(options) {
    if (!options || !options.context || !options.commands || typeof options.translate !== 'function') {
      throw new TypeError('LocalScmExtensionSession requires a plugin context, commands, and translator.');
    }
    this._context = options.context;
    this._commands = Object.freeze({ ...options.commands });
    this._translate = options.translate;
    this._sourceControlId = options.sourceControlId;
    this._decorationId = options.decorationId;
    this._commandKey = typeof options.commandKey === 'function' ? options.commandKey : (name) => 'action.' + name;
    this._registrations = [];
    this._controller = null;
    this._view = null;
    this._decorations = null;
    this._localeSubscription = null;
    this._started = false;
    this._disposed = false;
  }

  async start() {
    if (this._disposed) throw new Error('Local source-control session is disposed.');
    if (this._started) return this;
    try {
      this._view = requireStateView(await this._context.sourceControl.register({
        id: this._sourceControlId,
        title: this._translate('activity.title'),
        icon: 'git-branch',
        order: 20,
        openCommand: this._commands.refresh
      }));
      this._registrations.push(this._view);

      this._decorations = await this._context.fileDecorations.registerScm({
        id: this._decorationId,
        priority: 100
      });
      this._registrations.push(this._decorations);

      this._controller = new LocalScmController({
        git: this._context.scm && this._context.scm.git || {},
        decorations: this._decorations,
        commands: this._commands,
        enhancedView: true,
        translate: this._translate,
        publish: (state) => this._view.setState(state)
      });

      for (const [name, id] of Object.entries(this._commands)) {
        const registration = await this._context.commands.register(
          id,
          (invocation) => this._handleCommand(id, invocation),
          { title: this._translate(this._commandKey(name)), category: this._translate('activity.title') }
        );
        this._registrations.push(registration);
      }

      this._localeSubscription = this._context.i18n && typeof this._context.i18n.onDidChange === 'function'
        ? this._context.i18n.onDidChange(() => { void this._controller.refreshLocalization(); })
        : null;
      this._started = true;
      await this._controller.start();
      return this;
    } catch (error) {
      await this.dispose();
      throw error;
    }
  }

  async _handleCommand(command, invocation) {
    if (this._disposed || !this._controller) return { ok: false, ignored: true };
    if (invocation && typeof invocation === 'object' && !Array.isArray(invocation) &&
        invocation.sourceControlId && invocation.sourceControlId !== this._sourceControlId) {
      return { ok: false, ignored: true };
    }
    // Network Git commands can outlive the host's short command-RPC timeout.
    // State updates carry progress and the final outcome while the Worker
    // returns promptly; a timeout must never imply that Git was cancelled.
    if ([this._commands.clone, this._commands.publish, this._commands.fetch,
      this._commands.pull, this._commands.push, this._commands.commitAndPush, this._commands.retryPush, this._commands.pushSelected, this._commands.fetchSelected].includes(command)) {
      void this._controller.handleCommand(command, invocation).catch(() => {});
      return { ok: true, pending: true };
    }
    const result = await this._controller.handleCommand(command, invocation);
    if (result && result.ok === false && result.error && typeof result.error === 'object') {
      const failure = new Error(typeof result.error.message === 'string'
        ? result.error.message
        : 'Local source-control operation failed.');
      failure.code = typeof result.error.code === 'string' && result.error.code
        ? result.error.code
        : 'SCM_GIT_OPERATION_FAILED';
      throw failure;
    }
    return result;
  }

  async dispose() {
    if (this._disposed) return;
    this._disposed = true;
    try { disposable(this._localeSubscription).dispose(); } catch (_) {}
    try { if (this._controller) await this._controller.dispose(); } catch (_) {}
    try { if (this._view) await this._view.clearState(); } catch (_) {}
    for (const registration of this._registrations.splice(0).reverse()) {
      try { disposable(registration).dispose(); } catch (_) {}
    }
    this._controller = null;
    this._view = null;
    this._decorations = null;
  }
}
