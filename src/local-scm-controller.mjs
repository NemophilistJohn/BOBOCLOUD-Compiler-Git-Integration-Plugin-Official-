const DEFAULT_CHANGE_PAGE_SIZE = 60;
const DEFAULT_HISTORY_PAGE_SIZE = 30;
// The generic source-control host validates each section independently. Keep
// the published view below that boundary even when a repository has thousands
// of changes or commits; loading still uses broker offsets rather than a
// client-side prefix of the first response.
const MAX_VISIBLE_SECTION_ITEMS = 160;
const MAX_DECORATION_ENTRIES = 4096;

export const LocalScmPhase = Object.freeze({
  LOADING: 'loading',
  EMPTY: 'empty',
  READY: 'ready',
  ERROR: 'error'
});

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function errorCode(error) {
  return error && typeof error.code === 'string' ? error.code : '';
}

function normalizedLocale(locale) {
  if (locale === 'zh-CN' || locale === 'ja') return locale;
  return 'en';
}

function requireRelativePath(value, label) {
  if (typeof value !== 'string' || !value || value.length > 1024 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError(label + ' must be a short relative path.');
  }
  const path = value.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!path || path.startsWith('/') || /^[A-Za-z]:\//.test(path)) {
    throw new TypeError(label + ' must be relative.');
  }
  const parts = path.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new TypeError(label + ' must not escape the local workspace.');
  }
  return parts.join('/');
}

function requestedPaths(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 256) {
    throw new TypeError('Select between one and 256 local files.');
  }
  const paths = value.map((path) => requireRelativePath(path, 'File path'));
  if (new Set(paths).size !== paths.length) throw new TypeError('Selected local files must not repeat.');
  return paths;
}

function optionalString(value, label, maxLength = 160) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError(label + ' is invalid.');
  }
  return value.trim();
}

function commitMessage(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096 || value.includes('\0')) {
    throw new TypeError('Commit message is invalid.');
  }
  return value.trim();
}

function branchName(value) {
  const branch = optionalString(value, 'Branch name', 120);
  if (!branch || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) || branch.includes('..') ||
      branch.includes('//') || branch.includes('@{') || branch.endsWith('.') || branch.endsWith('/')) {
    throw new TypeError('Branch name is invalid.');
  }
  return branch;
}

function repositoryId(value) {
  if (typeof value !== 'string' || !/^scm-[A-Za-z0-9-]{16,128}$/.test(value)) {
    throw new TypeError('Repository selection is invalid.');
  }
  return value;
}

function remoteName(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) {
    throw new TypeError('Remote name is invalid.');
  }
  return value;
}

export function validateRemoteAddress(value) {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\s\u0000]/.test(value)) {
    throw new TypeError('Remote repository address is invalid.');
  }
  if (/^https:\/\//i.test(value) || /^ssh:\/\//i.test(value)) {
    let parsed;
    try { parsed = new URL(value); } catch (_) { throw new TypeError('Remote repository address is invalid.'); }
    if (!parsed.hostname || parsed.password || parsed.search || parsed.hash ||
        (parsed.protocol === 'https:' && parsed.username)) {
      throw new TypeError('Remote repository address is invalid.');
    }
    return value;
  }
  if (value.includes('://')) {
    throw new TypeError('Remote repository address must use HTTPS or SSH.');
  }
  const scp = value.match(/^([A-Za-z0-9._-]+@)?([A-Za-z0-9.-]+):[A-Za-z0-9._~/-]+$/);
  // Keep the worker-side preflight aligned with the broker: "file:repo" and
  // Windows drive syntax are not treated as SCP-style SSH remotes.
  if (scp && (scp[1] || scp[2].includes('.') || scp[2].toLowerCase() === 'localhost')) return value;
  throw new TypeError('Remote repository address must use HTTPS or SSH.');
}

function statusCode(value) {
  return typeof value === 'string' && /^[.MADRCUT?!]$/.test(value) ? value : '.';
}

function displayText(value, maxLength, fallback = '-') {
  const source = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '') : '';
  const text = source.trim() ? source : fallback;
  return text.length <= maxLength ? text : text.slice(0, Math.max(1, maxLength - 3)) + '...';
}

function normalizedLineStats(value) {
  if (!plainObject(value) || !Number.isInteger(value.additions) || !Number.isInteger(value.deletions) ||
      value.additions < 0 || value.deletions < 0 || value.additions > 100000000 || value.deletions > 100000000) {
    return null;
  }
  return { additions: value.additions, deletions: value.deletions };
}

function decorationStatus(change) {
  if (!plainObject(change)) return 'modified';
  if (change.kind === 'unmerged') return 'conflicted';
  if (change.kind === 'untracked') return 'untracked';
  if (change.kind === 'ignored') return 'ignored';
  if (change.kind === 'renamed') return 'renamed';
  const codes = [statusCode(change.index), statusCode(change.workingTree)];
  if (codes.includes('D')) return 'deleted';
  if (codes.includes('A')) return 'added';
  if (codes.includes('U')) return 'conflicted';
  return 'modified';
}

function workspacePath(relativeRoot, relativePath) {
  const path = requireRelativePath(relativePath, 'Repository file path');
  if (!relativeRoot) return path;
  return requireRelativePath(relativeRoot, 'Repository root') + '/' + path;
}

export function statusToDecorationEntries(status) {
  if (!plainObject(status) || !Array.isArray(status.changes)) return [];
  const entries = new Map();
  const root = status.relativeRoot || '';
  for (const change of status.changes) {
    if (!plainObject(change) || typeof change.path !== 'string') continue;
    try {
      entries.set(workspacePath(root, change.path), decorationStatus(change));
    } catch (_) {
      // The main-process broker should already guarantee this property. A bad
      // response must not let the plugin publish a path outside the tree.
    }
  }
  return Array.from(entries, ([path, status]) => ({ path, status }));
}

function toChangeItem(change, side) {
  const code = side === 'index' ? statusCode(change.index) : statusCode(change.workingTree);
  return {
    path: change.path,
    originalPath: typeof change.originalPath === 'string' ? change.originalPath : '',
    status: decorationStatus(change),
    code,
    lineStats: normalizedLineStats(side === 'index' ? change.indexStats : change.workingTreeStats),
    kind: change.kind || 'changed'
  };
}

export function groupStatusChanges(changes) {
  const groups = { staged: [], unstaged: [], untracked: [], conflicted: [] };
  for (const change of Array.isArray(changes) ? changes : []) {
    if (!plainObject(change) || typeof change.path !== 'string' || !change.path) continue;
    if (change.kind === 'unmerged') {
      groups.conflicted.push(toChangeItem(change, 'workingTree'));
      continue;
    }
    if (change.kind === 'untracked') {
      groups.untracked.push(toChangeItem(change, 'workingTree'));
      continue;
    }
    if (change.kind === 'ignored') continue;
    if (statusCode(change.index) !== '.') groups.staged.push(toChangeItem(change, 'index'));
    if (statusCode(change.workingTree) !== '.') groups.unstaged.push(toChangeItem(change, 'workingTree'));
  }
  return groups;
}

export function classifyScmError(error, operation = '') {
  const code = errorCode(error);
  if (code === 'SCM_GIT_NO_WORKSPACE') return 'noWorkspace';
  if (code === 'SCM_GIT_UNAVAILABLE') return 'gitUnavailable';
  if (code === 'SCM_GIT_IDENTITY_REQUIRED') return 'identityRequired';
  if (code === 'SCM_GIT_NOTHING_TO_COMMIT') return 'nothingToCommit';
  if (code === 'SCM_GIT_AUTH_REQUIRED') return 'authenticationRequired';
  if (code === 'SCM_GIT_CONFLICT') return 'conflict';
  if (code === 'SCM_GIT_BRANCH_CHECKED_OUT') return 'branchCheckedOut';
  if (code === 'SCM_GIT_OUTCOME_UNKNOWN') return 'outcomeUnknown';
  if (code === 'SCM_GIT_REFRESH_AFTER_SUCCESS') return 'refreshAfterSuccess';
  if (code === 'SCM_GIT_UPSTREAM_MISMATCH') return 'upstreamMismatch';
  if (code === 'SCM_GIT_REMOTE_DENIED') return operation === 'clone' ? 'remoteInvalid' : 'remoteUnavailable';
  if (operation === 'clone' && code === 'SCM_GIT_WORKSPACE_NOT_EMPTY') return 'workspaceNotEmpty';
  if (operation === 'clone' && (code === 'SCM_GIT_REMOTE_DENIED' || code === 'SCM_GIT_AUTH_REQUIRED' ||
      code === 'SCM_GIT_CLONE_FAILED' || code === 'SCM_GIT_OPERATION_FAILED')) {
    return 'remoteFailed';
  }
  return 'operationFailed';
}

function descriptorLabel(descriptor) {
  return displayText(descriptor.relativeRoot || '.', 256, '.');
}

function normalRepository(value) {
  if (!plainObject(value)) return null;
  try {
    return {
      repositoryId: repositoryId(value.repositoryId),
      relativeRoot: value.relativeRoot ? requireRelativePath(value.relativeRoot, 'Repository root') : '',
      isWorkspaceRoot: value.isWorkspaceRoot === true
    };
  } catch (_) {
    return null;
  }
}

function pageSize(value, fallback) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_VISIBLE_SECTION_ITEMS ? value : fallback;
}

function pageOffset(value, fallback) {
  return Number.isInteger(value) && value >= 0 && value <= 10000 ? value : fallback;
}

function boundedChanges(changes) {
  if (!Array.isArray(changes)) return [];
  const result = [];
  for (const change of changes) {
    if (!plainObject(change)) continue;
    try {
      const path = requireRelativePath(change.path, 'Repository file path');
      const originalPath = typeof change.originalPath === 'string' && change.originalPath
        ? requireRelativePath(change.originalPath, 'Original repository file path')
        : undefined;
      result.push({ ...change, path, originalPath });
    } catch (_) {
      // A malformed broker record must not become a worker target or a tree
      // decoration. It is safer to omit that row and keep the rest usable.
    }
  }
  return result;
}

function normalizeStatusPage(value, activeRepositoryId, requestedOffset, requestedLimit) {
  if (!plainObject(value) || value.repositoryId !== activeRepositoryId) {
    throw new TypeError('Local Git status response is invalid.');
  }
  const offset = pageOffset(value.offset, requestedOffset);
  const limit = pageSize(value.limit, requestedLimit);
  if (offset !== requestedOffset || limit !== requestedLimit) {
    throw new TypeError('Local Git status pagination does not match the request.');
  }
  const hasMore = value.hasMore === true;
  const nextOffset = hasMore ? pageOffset(value.nextOffset, -1) : null;
  if (hasMore && (nextOffset <= offset || nextOffset > 10000)) {
    throw new TypeError('Local Git status pagination is invalid.');
  }
  let relativeRoot = '';
  if (value.relativeRoot) relativeRoot = requireRelativePath(value.relativeRoot, 'Repository root');
  return {
    repositoryId: activeRepositoryId,
    relativeRoot,
    branch: plainObject(value.branch) ? value.branch : {},
    changes: boundedChanges(value.changes),
    offset,
    limit,
    total: Number.isInteger(value.total) && value.total >= 0 ? value.total : 0,
    hasMore,
    nextOffset
  };
}

function normalizeHistoryPage(value, activeRepositoryId, requestedOffset, requestedLimit) {
  if (!plainObject(value) || value.repositoryId !== activeRepositoryId || !Array.isArray(value.commits)) {
    throw new TypeError('Local Git history response is invalid.');
  }
  const offset = pageOffset(value.offset, requestedOffset);
  const limit = pageSize(value.limit, requestedLimit);
  if (offset !== requestedOffset || limit !== requestedLimit) {
    throw new TypeError('Local Git history pagination does not match the request.');
  }
  const hasMore = value.hasMore === true;
  const nextOffset = hasMore ? pageOffset(value.nextOffset, -1) : null;
  if (hasMore && (nextOffset <= offset || nextOffset > 10000)) {
    throw new TypeError('Local Git history pagination is invalid.');
  }
  return {
    repositoryId: activeRepositoryId,
    commits: value.commits.filter(plainObject),
    offset,
    limit,
    hasMore,
    nextOffset
  };
}

function textField(id, label, options = {}) {
  return {
    id,
    label,
    type: options.type || 'text',
    description: options.description || undefined,
    placeholder: options.placeholder || undefined,
    required: options.required === true,
    value: options.value || undefined,
    maxLength: options.maxLength || undefined
  };
}

function checkboxField(id, label, value = false) {
  return { id, label, type: 'checkbox', value: value === true };
}

function form(title, submitLabel, fields) {
  return { title, submitLabel, fields };
}

function action(id, title, command, options = {}) {
  return {
    id,
    title,
    description: options.description || undefined,
    command,
    kind: options.kind || 'secondary',
    placement: options.placement || 'button',
    icon: options.icon || undefined,
    disabled: options.disabled === true,
    form: options.form || undefined
  };
}

/**
 * Data-only controller used by the worker entry. It has no DOM, filesystem,
 * process, network, or cloud-synchronization dependency. Every operation is
 * mediated by the host-provided local SCM broker.
 */
export class LocalScmController {
  constructor(options) {
    if (!options || !options.git || typeof options.publish !== 'function') {
      throw new TypeError('LocalScmController requires a local SCM broker and a state publisher.');
    }
    this._git = options.git;
    this._publish = options.publish;
    this._decorations = options.decorations || null;
    this._t = typeof options.translate === 'function' ? options.translate : (key) => key;
    this._commands = Object.freeze({ ...options.commands });
    this._enhancedView = options.enhancedView === true;
    this._detail = null;
    this._changePageSize = pageSize(options.changePageSize, DEFAULT_CHANGE_PAGE_SIZE);
    this._historyPageSize = pageSize(options.historyPageSize, DEFAULT_HISTORY_PAGE_SIZE);
    this._queue = Promise.resolve();
    this._disposed = false;
    this._phase = LocalScmPhase.LOADING;
    this._repositories = [];
    this._activeRepositoryId = '';
    this._status = null;
    this._branches = null;
    this._remotes = null;
    this._statusHasMore = false;
    this._statusNextOffset = null;
    this._statusChangeKeys = new Set();
    this._decorationEntries = new Map();
    this._history = [];
    this._historyHasMore = true;
    this._historyNextOffset = 0;
    this._error = null;
    this._notice = '';
    this._operation = '';
    this._publishCommitted = false;
    this._emptyKind = 'repository';
    this._itemTargets = new Map();
    this._decorationsEnabled = options.decorationsEnabled !== false;
  }

  get state() {
    return jsonClone(this._snapshot());
  }

  start() {
    return this.refresh();
  }

  refreshLocalization() {
    return this._enqueue(async () => {
      await this._emit();
      return { ok: true };
    });
  }

  refresh() {
    return this._enqueue(async () => {
      await this._setLoading();
      try {
        const detected = await this._requireGitMethod('detect')({ includeNested: true });
        const repositories = Array.isArray(detected && detected.repositories)
          ? detected.repositories.map(normalRepository).filter(Boolean)
          : [];
        this._repositories = repositories;
        if (repositories.length === 0) {
          this._activeRepositoryId = '';
          this._resetRepositoryData();
          this._emptyKind = 'repository';
          this._phase = LocalScmPhase.EMPTY;
          await this._clearDecorations();
          await this._emit();
          return { ok: true, phase: this._phase };
        }
        if (!repositories.some((item) => item.repositoryId === this._activeRepositoryId)) {
          const workspaceRoot = repositories.find((item) => item.isWorkspaceRoot);
          this._activeRepositoryId = (workspaceRoot || repositories[0]).repositoryId;
        }
        await this._loadActiveRepository(true);
        return { ok: true, phase: this._phase };
      } catch (error) {
        return this._showError(error, 'refresh');
      }
    });
  }

  selectRepository(value) {
    return this._enqueue(async () => {
      try {
        const id = repositoryId(value);
        if (!this._repositories.some((item) => item.repositoryId === id)) throw new TypeError('Repository is not available in this local workspace.');
        this._activeRepositoryId = id;
        await this._setLoading();
        await this._loadActiveRepository(true);
        return { ok: true };
      } catch (error) {
        return this._showError(error, 'select');
      }
    });
  }

  initializeRepository() {
    return this._enqueue(async () => {
      try {
        await this._setLoading();
        const created = await this._requireGitMethod('init')();
        const repository = normalRepository(created);
        if (repository) this._activeRepositoryId = repository.repositoryId;
        await this._refreshAfterMutation();
        return { ok: true };
      } catch (error) {
        return this._showError(error, 'init');
      }
    });
  }

  publishInitial(options = {}) {
    return this._enqueue(async () => {
      let remote;
      let branch;
      let message;
      try {
        const values = plainObject(options) ? options : {};
        remote = validateRemoteAddress(values.remote);
        branch = branchName(values.branch || 'main');
        message = commitMessage(values.message);
      } catch (error) {
        return this._showNamedError('remoteInvalid', error);
      }
      try {
        await this._setLoading('publish');
        const detected = await this._requireGitMethod('detect')({ includeNested: true });
        const repositories = Array.isArray(detected && detected.repositories)
          ? detected.repositories.map(normalRepository).filter(Boolean)
          : [];
        let root = repositories.find((item) => item.isWorkspaceRoot);
        if (!root) root = normalRepository(await this._requireGitMethod('init')());
        if (!root) throw new TypeError('The local workspace could not be initialized.');
        this._activeRepositoryId = root.repositoryId;
        const status = await this._requireGitMethod('status')({ repositoryId: root.repositoryId, offset: 0, limit: 1 });
        const branchState = plainObject(status) && plainObject(status.branch) ? status.branch : {};
        if (branchState.oid !== '(initial)') {
          const error = new Error('The local repository already has a commit.');
          error.code = 'SCM_GIT_OPERATION_FAILED';
          throw error;
        }
        if (branchState.head !== branch) {
          await this._requireGitMethod('createBranch')({ repositoryId: root.repositoryId, name: branch, checkout: true });
        }
        await this._requireGitMethod('stageAll')({ repositoryId: root.repositoryId });
        await this._requireGitMethod('commit')({ repositoryId: root.repositoryId, message });
        this._publishCommitted = true;
        await this._requireGitMethod('setRemote')({ repositoryId: root.repositoryId, name: 'origin', url: remote });
        await this._requireGitMethod('push')({ repositoryId: root.repositoryId, remote: 'origin', branch, setUpstream: true });
        await this._refreshAfterSuccess();
        this._notice = 'notice.published';
        await this._emit();
        return { ok: true };
      } catch (error) {
        // A publish consists of several independent Git mutations. Re-read the
        // repository even when a later step fails so retry never repeats a
        // successful initial commit or hides the real repository state.
        try { await this._refreshAfterMutation(); } catch (_) {}
        return this._showError(error, 'publish');
      }
    });
  }

  cloneRemote(value) {
    return this._enqueue(async () => {
      let remote;
      try { remote = validateRemoteAddress(value); } catch (error) { return this._showNamedError('remoteInvalid', error); }
      try {
        await this._setLoading('clone');
        const cloned = await this._requireGitMethod('clone')({ url: remote });
        const repository = normalRepository(cloned && (cloned.repository || cloned));
        if (repository) this._activeRepositoryId = repository.repositoryId;
        await this._refreshAfterSuccess();
        this._notice = 'notice.cloned';
        await this._emit();
        return { ok: true };
      } catch (error) {
        return this._showError(error, 'clone');
      }
    });
  }

  stage(paths) {
    return this._enqueue(async () => {
      try {
        return await this._mutateStatusNow('stage', { paths: requestedPaths(paths) });
      } catch (error) {
        return this._showError(error, 'stage');
      }
    });
  }

  stageAll() {
    return this._enqueue(async () => {
      try {
        return await this._mutateStatusNow('stageAll', {});
      } catch (error) {
        return this._showError(error, 'stageAll');
      }
    });
  }

  unstage(paths) {
    return this._enqueue(async () => {
      try {
        return await this._mutateStatusNow('unstage', { paths: requestedPaths(paths) });
      } catch (error) {
        return this._showError(error, 'unstage');
      }
    });
  }

  commit(message) {
    return this._enqueue(async () => {
      try {
        const text = commitMessage(message);
        await this._setLoading('commit');
        await this._requireGitMethod('commit')({ repositoryId: this._active(), message: text });
        await this._refreshAfterSuccess();
        this._notice = 'notice.committed';
        await this._emit();
        return { ok: true };
      } catch (error) {
        return this._showError(error, 'commit');
      }
    });
  }

  fetch(options = {}) { return this._remoteOperation('fetch', options); }
  pull(options = {}) { return this._remoteOperation('pull', options); }
  push(options = {}) { return this._remoteOperation('push', options); }

  setRemote(options = {}) {
    return this._enqueue(async () => {
      try {
        const name = remoteName(options.name || 'origin');
        const url = validateRemoteAddress(options.url);
        await this._setLoading('setRemote');
        await this._requireGitMethod('setRemote')({ repositoryId: this._active(), name, url });
        await this._refreshAfterSuccess();
        this._notice = 'notice.remoteSaved';
        await this._emit();
        return { ok: true };
      } catch (error) { return this._showError(error, 'setRemote'); }
    });
  }

  viewDiff(target) {
    return this._enqueue(async () => {
      try {
        const path = requireRelativePath(target.path, 'Repository file path');
        if (target.fileKind === 'untracked') {
          this._detail = { title: path, content: this._t('detail.untracked') };
        } else {
          const result = await this._requireGitMethod('diff')({ repositoryId: this._active(), path, staged: target.side === 'staged' });
          const content = typeof result.content === 'string' ? result.content : '';
          this._detail = {
            title: path,
            content: content ? content.slice(0, 30000) + (content.length > 30000 ? '\n\n' + this._t('detail.truncated') : '') : this._t('detail.empty')
          };
        }
        await this._emit();
        return { ok: true };
      } catch (error) { return this._showError(error, 'diff'); }
    });
  }

  checkout(branch, force = false) {
    return this._enqueue(async () => {
      try {
        await this._setLoading();
        await this._requireGitMethod('checkout')({ repositoryId: this._active(), branch: branchName(branch), force: force === true });
        await this._refreshAfterSuccess();
        return { ok: true };
      } catch (error) {
        return this._showError(error, 'checkout');
      }
    });
  }

  createBranch(name, checkout = true) {
    return this._enqueue(async () => {
      try {
        await this._setLoading();
        await this._requireGitMethod('createBranch')({ repositoryId: this._active(), name: branchName(name), checkout: checkout === true });
        await this._refreshAfterSuccess();
        return { ok: true };
      } catch (error) {
        return this._showError(error, 'createBranch');
      }
    });
  }

  deleteBranch(name, force = false) {
    return this._enqueue(async () => {
      try {
        await this._setLoading();
        await this._requireGitMethod('deleteBranch')({ repositoryId: this._active(), name: branchName(name), force: force === true });
        await this._refreshAfterSuccess();
        return { ok: true };
      } catch (error) {
        return this._showError(error, 'deleteBranch');
      }
    });
  }

  loadMoreChanges() {
    return this._enqueue(async () => {
      try {
        if (this._phase !== LocalScmPhase.READY || !this._canLoadMoreChanges()) return { ok: true };
        const offset = this._statusNextOffset;
        const result = await this._requireGitMethod('status')({
          repositoryId: this._active(),
          offset,
          limit: this._changePageSize
        });
        this._appendStatusPage(normalizeStatusPage(result, this._active(), offset, this._changePageSize));
        await this._publishDecorations();
        await this._emit();
        return { ok: true };
      } catch (error) {
        return this._showError(error, 'status');
      }
    });
  }

  loadMoreHistory() {
    return this._enqueue(async () => {
      try {
        if (this._phase !== LocalScmPhase.READY || !this._canLoadMoreHistory()) return { ok: true };
        const offset = this._historyNextOffset;
        const limit = Math.min(this._historyPageSize, MAX_VISIBLE_SECTION_ITEMS - this._history.length);
        const result = await this._requireGitMethod('history')({ repositoryId: this._active(), offset, limit });
        const historyPage = normalizeHistoryPage(result, this._active(), offset, limit);
        this._appendHistoryPage(historyPage);
        await this._emit();
        return { ok: true };
      } catch (error) {
        return this._showError(error, 'history');
      }
    });
  }

  toggleDecorations(enabled) {
    return this._enqueue(async () => {
      this._decorationsEnabled = typeof enabled === 'boolean' ? enabled : !this._decorationsEnabled;
      if (this._decorationsEnabled) await this._publishDecorations();
      else await this._clearDecorations();
      await this._emit();
      return { ok: true, enabled: this._decorationsEnabled };
    });
  }

  /**
   * The source-control host only returns a bounded action envelope. Targets
   * such as repository ids and repository-relative paths stay in this Worker
   * map, so the rendered host never receives a generic operation payload.
   */
  handleCommand(command, invocation) {
    const event = plainObject(invocation) ? invocation : {};
    const values = plainObject(event.values) ? event.values : {};
    const target = typeof event.itemId === 'string' ? this._itemTargets.get(event.itemId) : null;
    // Item commands share the same owned command ids as their corresponding
    // forms. Resolve the opaque item target first so a branch click cannot be
    // mistaken for an empty checkout form submission.
    if (command === this._commands.selectRepository && target && target.kind === 'repository') {
      return this.selectRepository(target.repositoryId);
    }
    if (command === this._commands.checkout && target && target.kind === 'branch') {
      return this.checkout(target.name, false);
    }
    if (command === this._commands.stage && target && target.kind === 'change') {
      return this.stage([target.path]);
    }
    if (command === this._commands.unstage && target && target.kind === 'change') {
      return this.unstage([target.path]);
    }
    if (command === this._commands.viewDiff && target && target.kind === 'change') return this.viewDiff(target);
    if (command === this._commands.refresh) return this.refresh();
    if (command === this._commands.initialize) return this.initializeRepository();
    if (command === this._commands.clone) return this.cloneRemote(values.remote);
    if (command === this._commands.publish) return this.publishInitial(values);
    if (command === this._commands.commit) return this.commit(values.message);
    if (command === this._commands.stageAll) return this.stageAll();
    if (command === this._commands.fetch) return this.fetch(values);
    if (command === this._commands.pull) return this.pull(values);
    if (command === this._commands.push) return this.push(values);
    if (command === this._commands.setRemote) return this.setRemote(values);
    if (command === this._commands.checkout) return this.checkout(values.branch, values.force === true);
    if (command === this._commands.createBranch) return this.createBranch(values.name, values.checkout === true);
    if (command === this._commands.deleteBranch) return this.deleteBranch(values.name, values.force === true);
    if (command === this._commands.loadMoreChanges) return this.loadMoreChanges();
    if (command === this._commands.loadMoreHistory) return this.loadMoreHistory();
    if (command === this._commands.toggleDecorations) return this.toggleDecorations();
    return Promise.resolve({ ok: false, ignored: true });
  }

  async dispose() {
    if (this._disposed) return;
    this._disposed = true;
    await this._clearDecorations();
  }

  async _mutateStatusNow(method, input) {
    await this._setLoading();
    await this._requireGitMethod(method)({ repositoryId: this._active(), ...input });
    await this._refreshAfterSuccess();
    return { ok: true };
  }

  _remoteOperation(method, options) {
    return this._enqueue(async () => {
      try {
        const input = plainObject(options) ? options : {};
        const configured = Array.isArray(this._remotes && this._remotes.remotes) ? this._remotes.remotes : [];
        const upstream = this._status && this._status.branch && this._status.branch.upstream || '';
        const trackedRemote = configured.find((entry) => entry && typeof entry.name === 'string' && upstream.startsWith(entry.name + '/'));
        const remote = remoteName(input.remote) || (trackedRemote && trackedRemote.name) || (configured[0] && configured[0].name);
        const branch = input.branch === undefined || input.branch === null || input.branch === '' ? undefined : branchName(input.branch);
        const currentBranch = this._status && this._status.branch && this._status.branch.head || '';
        if (method === 'push' && !this._enhancedView && !branch && trackedRemote && remote === trackedRemote.name &&
            upstream.slice(trackedRemote.name.length + 1) !== currentBranch) {
          const error = new Error('The installed host cannot safely push to a differently named upstream branch.');
          error.code = 'SCM_GIT_UPSTREAM_MISMATCH';
          throw error;
        }
        const args = { repositoryId: this._active() };
        if (remote) args.remote = remote;
        if (branch) args.branch = branch;
        if (method === 'push') {
          if (input.force !== undefined) args.force = input.force === true;
          if (input.setUpstream !== undefined) args.setUpstream = input.setUpstream === true;
        }
        await this._setLoading(method);
        const result = await this._requireGitMethod(method)(args);
        await this._refreshAfterSuccess();
        const output = typeof result?.output === 'string' ? result.output.trim() : '';
        if (output && this._enhancedView) this._detail = { title: this._t('label.operationLog'), content: output.slice(0, 30000) };
        this._notice = method === 'push' && /(?:up.to.date|everything up.to.date)/i.test(output)
          ? 'notice.pushUpToDate' : 'notice.' + method + 'Complete';
        await this._emit();
        return { ok: true };
      } catch (error) {
        return this._showError(error, method);
      }
    });
  }

  async _refreshAfterSuccess() {
    try { await this._refreshAfterMutation(); }
    catch (_) {
      const error = new Error('The Git operation completed, but the view could not be refreshed.');
      error.code = 'SCM_GIT_REFRESH_AFTER_SUCCESS';
      throw error;
    }
  }

  async _refreshAfterMutation() {
    const detected = await this._requireGitMethod('detect')({ includeNested: true });
    this._repositories = Array.isArray(detected && detected.repositories)
      ? detected.repositories.map(normalRepository).filter(Boolean)
      : [];
    if (this._repositories.length === 0) {
      this._activeRepositoryId = '';
      this._resetRepositoryData();
      this._emptyKind = 'repository';
      this._phase = LocalScmPhase.EMPTY;
      await this._clearDecorations();
      await this._emit();
      return;
    }
    if (!this._repositories.some((item) => item.repositoryId === this._activeRepositoryId)) {
      this._activeRepositoryId = this._repositories[0].repositoryId;
    }
    await this._loadActiveRepository(true);
  }

  async _loadActiveRepository(resetPages) {
    const id = this._active();
    // A ready source-control view should already contain useful history. Fetch
    // the first bounded page with the primary repository snapshot; later pages
    // still follow the broker-provided nextOffset cursor.
    const loadInitialHistory = resetPages || this._history.length === 0;
    const historyLimit = Math.min(this._historyPageSize, MAX_VISIBLE_SECTION_ITEMS);
    const [status, branches, remotes, history] = await Promise.all([
      this._requireGitMethod('status')({ repositoryId: id, offset: 0, limit: this._changePageSize }),
      this._requireGitMethod('branches')({ repositoryId: id }),
      this._requireGitMethod('remotes')({ repositoryId: id }),
      loadInitialHistory
        ? this._requireGitMethod('history')({ repositoryId: id, offset: 0, limit: historyLimit })
        : Promise.resolve(null)
    ]);
    const statusPage = normalizeStatusPage(status, id, 0, this._changePageSize);
    if (resetPages) this._resetStatusPages();
    this._appendStatusPage(statusPage);
    this._branches = plainObject(branches) ? branches : null;
    this._remotes = plainObject(remotes) ? remotes : null;
    if (resetPages) {
      this._resetHistoryPages();
    }
    if (loadInitialHistory) {
      this._appendHistoryPage(normalizeHistoryPage(history, id, 0, historyLimit));
    }
    this._phase = LocalScmPhase.READY;
    this._error = null;
    await this._publishDecorations();
    await this._emit();
  }

  _resetRepositoryData() {
    this._status = null;
    this._detail = null;
    this._branches = null;
    this._remotes = null;
    this._resetStatusPages();
    this._resetHistoryPages();
    this._error = null;
  }

  _resetStatusPages() {
    this._status = null;
    this._statusHasMore = false;
    this._statusNextOffset = null;
    this._statusChangeKeys.clear();
    this._decorationEntries.clear();
  }

  _resetHistoryPages() {
    this._history = [];
    this._historyHasMore = true;
    this._historyNextOffset = 0;
  }

  _appendStatusPage(pageResult) {
    if (this._status && this._status.relativeRoot !== pageResult.relativeRoot) {
      throw new TypeError('Local Git status changed repository roots while paging.');
    }
    const changes = this._status && Array.isArray(this._status.changes) ? this._status.changes : [];
    for (const change of pageResult.changes) {
      if (typeof change.path !== 'string') continue;
      const key = change.path + '\u0000' + (typeof change.originalPath === 'string' ? change.originalPath : '');
      if (this._statusChangeKeys.has(key)) continue;
      this._statusChangeKeys.add(key);
      changes.push(change);
    }
    this._status = { ...pageResult, changes };
    this._statusHasMore = pageResult.hasMore;
    this._statusNextOffset = pageResult.nextOffset;
    for (const entry of statusToDecorationEntries(pageResult)) {
      if (this._decorationEntries.has(entry.path) || this._decorationEntries.size < MAX_DECORATION_ENTRIES) {
        this._decorationEntries.set(entry.path, entry);
      }
    }
  }

  _appendHistoryPage(pageResult) {
    const remaining = MAX_VISIBLE_SECTION_ITEMS - this._history.length;
    this._history.push(...pageResult.commits.slice(0, Math.max(0, remaining)));
    this._historyHasMore = pageResult.hasMore;
    this._historyNextOffset = pageResult.nextOffset;
  }

  _canLoadMoreChanges() {
    if (!this._statusHasMore || !Number.isInteger(this._statusNextOffset)) return false;
    const groups = groupStatusChanges(this._status && this._status.changes);
    return Object.values(groups).some((entries) => entries.length < MAX_VISIBLE_SECTION_ITEMS);
  }

  _canLoadMoreHistory() {
    return this._historyHasMore && Number.isInteger(this._historyNextOffset) &&
      this._history.length < MAX_VISIBLE_SECTION_ITEMS;
  }

  async _setLoading(operation = '') {
    this._phase = LocalScmPhase.LOADING;
    this._error = null;
    this._notice = '';
    this._operation = operation;
    this._publishCommitted = false;
    await this._emit();
  }

  _active() {
    return repositoryId(this._activeRepositoryId);
  }

  _requireGitMethod(name) {
    if (!this._git || typeof this._git[name] !== 'function') {
      const error = new Error('The installed local source-control API does not provide ' + name + '.');
      error.code = 'SCM_GIT_UNAVAILABLE';
      throw error;
    }
    return this._git[name].bind(this._git);
  }

  async _showNamedError(kind, error) {
    if (kind === 'noWorkspace') {
      this._phase = LocalScmPhase.EMPTY;
      this._emptyKind = 'workspace';
      this._repositories = [];
      this._activeRepositoryId = '';
      this._resetRepositoryData();
      this._error = null;
      await this._clearDecorations();
      await this._emit();
      return { ok: true, phase: this._phase };
    }
    this._phase = LocalScmPhase.ERROR;
    this._error = this._errorState(kind, error);
    await this._clearDecorations();
    await this._emit();
    return this._commandFailure(kind, error);
  }

  async _showError(error, operation) {
    const canPreserveRepository = Boolean(this._activeRepositoryId && this._status) &&
      operation !== 'refresh' && operation !== 'select' && operation !== 'status' &&
      operation !== 'history' && operation !== 'init' && operation !== 'clone';
    if (canPreserveRepository) {
      this._phase = LocalScmPhase.READY;
      this._error = this._errorState(classifyScmError(error, operation), error);
      this._error.partialPublish = operation === 'publish' && this._publishCommitted && errorCode(error) !== 'SCM_GIT_REFRESH_AFTER_SUCCESS';
      await this._emit();
      return this._commandFailure(this._error.kind, error);
    }
    return this._showNamedError(classifyScmError(error, operation), error);
  }

  _commandFailure(kind, error) {
    const content = this._errorContent(kind);
    return {
      ok: false,
      error: {
        code: errorCode(error) || 'SCM_GIT_OPERATION_FAILED',
        message: this._t(content[1])
      }
    };
  }

  _errorState(kind, error) {
    return { kind, code: errorCode(error) };
  }

  _errorContent(kind) {
    return kind === 'noWorkspace'
      ? ['state.noWorkspace.title', 'state.noWorkspace.message']
      : kind === 'gitUnavailable'
      ? ['state.gitUnavailable.title', 'state.gitUnavailable.message']
      : kind === 'remoteInvalid'
        ? ['state.remoteInvalid.title', 'state.remoteInvalid.message']
      : kind === 'remoteFailed'
          ? ['state.remoteFailed.title', 'state.remoteFailed.message']
      : kind === 'workspaceNotEmpty'
            ? ['state.workspaceNotEmpty.title', 'state.workspaceNotEmpty.message']
          : kind === 'identityRequired'
            ? ['state.identityRequired.title', 'state.identityRequired.message']
          : kind === 'nothingToCommit'
            ? ['state.nothingToCommit.title', 'state.nothingToCommit.message']
          : kind === 'authenticationRequired'
             ? ['state.authenticationRequired.title', 'state.authenticationRequired.message']
          : kind === 'conflict'
             ? ['state.conflict.title', 'state.conflict.message']
          : kind === 'branchCheckedOut'
             ? ['state.branchCheckedOut.title', 'state.branchCheckedOut.message']
          : kind === 'remoteUnavailable'
             ? ['state.remoteUnavailable.title', 'state.remoteUnavailable.message']
          : kind === 'outcomeUnknown'
             ? ['state.outcomeUnknown.title', 'state.outcomeUnknown.message']
          : kind === 'refreshAfterSuccess'
             ? ['state.refreshAfterSuccess.title', 'state.refreshAfterSuccess.message']
          : kind === 'upstreamMismatch'
             ? ['state.upstreamMismatch.title', 'state.upstreamMismatch.message']
          : ['state.operationFailed.title', 'state.operationFailed.message'];
  }

  async _publishDecorations() {
    if (!this._decorationsEnabled || !this._decorations || typeof this._decorations.set !== 'function') return;
    await this._decorations.set(Array.from(this._decorationEntries.values()));
  }

  async _clearDecorations() {
    if (!this._decorations || typeof this._decorations.clear !== 'function') return;
    try { await this._decorations.clear(); } catch (_) {}
  }

  _snapshot() {
    // The shape below is deliberately limited to the generic API 1.2
    // source-control state schema. No HTML, renderer callback, path root,
    // credentials, or arbitrary operation payload crosses the Worker boundary.
    this._itemTargets.clear();
    if (this._phase === LocalScmPhase.ERROR) {
      const content = this._errorContent(this._error && this._error.kind || 'operationFailed');
      return {
        phase: 'error',
        title: this._t(content[0]),
        message: this._t(content[1]),
        actions: [
          action('refresh', this._t('action.refresh'), this._commands.refresh, { kind: 'primary' })
        ]
      };
    }
    if (this._phase === LocalScmPhase.LOADING && !this._status) {
      return {
        phase: 'loading',
        title: this._t('activity.title'),
        message: this._t(this._operation ? 'operation.' + this._operation : 'state.loading'),
        actions: [
          action('refresh', this._t('action.refresh'), this._commands.refresh, { disabled: true })
        ]
      };
    }
    if (this._phase === LocalScmPhase.EMPTY) {
      if (this._emptyKind === 'workspace') {
        return {
          phase: 'empty',
          title: this._t('activity.title'),
          message: this._t('state.noWorkspace.empty'),
          actions: []
        };
      }
      return {
        phase: 'empty',
        title: this._t('state.empty.title'),
        message: this._t('state.empty.message'),
        actions: [
          action('refresh', this._t('action.refresh'), this._commands.refresh, { placement: 'toolbar', icon: 'refresh' }),
          action('publish', this._t('action.publish'), this._commands.publish, {
            kind: 'primary',
            form: form(this._t('form.publish.title'), this._t('action.publish'), [
              textField('remote', this._t('field.remote'), { required: true, maxLength: 2048 }),
              textField('branch', this._t('field.branch'), { required: true, value: 'main', maxLength: 120 }),
              textField('message', this._t('field.initialCommitMessage'), { type: 'textarea', required: true, value: this._t('field.initialCommitDefault'), maxLength: 4096 })
            ])
          }),
          action('initialize', this._t('action.initialize'), this._commands.initialize, { placement: 'menu', icon: 'stage-all' }),
          action('clone', this._t('action.clone'), this._commands.clone, {
            placement: 'menu',
            icon: 'remote',
            form: form(this._t('form.clone.title'), this._t('action.clone'), [
              textField('remote', this._t('field.remote'), { required: true, maxLength: 2048 })
            ])
          })
        ]
      };
    }

    const status = this._status || { branch: {}, changes: [] };
    const groups = groupStatusChanges(status.changes);
    const sections = [];
    const addTarget = (id, target) => {
      this._itemTargets.set(id, target);
      return id;
    };
    const repositories = this._repositories.slice(0, MAX_VISIBLE_SECTION_ITEMS).map((repository, index) => {
      const id = addTarget('repository-' + index, { kind: 'repository', repositoryId: repository.repositoryId });
      return {
        id,
        title: descriptorLabel(repository),
        description: repository.isWorkspaceRoot ? this._t('activity.title') : undefined,
        badge: repository.repositoryId === this._activeRepositoryId ? 'active' : undefined,
        command: this._commands.selectRepository,
        disabled: repository.repositoryId === this._activeRepositoryId
      };
    });
    if (repositories.length > 1) {
      sections.push({ id: 'repositories', title: this._t('section.repositories'), items: repositories });
    }

    const appendChanges = (sectionId, title, entries, command, showLoadMore) => {
      const items = entries.slice(0, MAX_VISIBLE_SECTION_ITEMS).map((entry, index) => {
        const id = addTarget(sectionId + '-' + index, { kind: 'change', path: entry.path, side: sectionId, fileKind: entry.kind });
        return {
          id,
          title: displayText(entry.path, 256, '-'),
          description: entry.originalPath ? displayText(entry.originalPath, 512, '-') : undefined,
          // The status badge remains host-owned; line totals are included only
          // when the local broker can establish them for this exact side.
          meta: entry.lineStats
            ? '+' + entry.lineStats.additions + ' -' + entry.lineStats.deletions
            : entry.code,
          badge: this._t('status.' + entry.status),
          command: this._enhancedView ? this._commands.viewDiff : command,
          ...(this._enhancedView ? { secondaryAction: { command, title: this._t(sectionId === 'staged' ? 'action.unstage' : 'action.stage'), icon: sectionId === 'staged' ? 'remove' : 'add' } } : {}),
          disabled: this._phase === LocalScmPhase.LOADING
        };
      });
      sections.push({
        id: sectionId,
        title,
        items,
        loadMore: showLoadMore ? { command: this._commands.loadMoreChanges, label: this._t('action.loadMore') } : undefined
      });
    };
    const count = (entries) => ' · ' + entries.length + (this._statusHasMore ? '+' : '');
    appendChanges('staged', this._t('group.staged') + count(groups.staged), groups.staged, this._commands.unstage, false);
    appendChanges('unstaged', this._t('group.unstaged') + count(groups.unstaged), groups.unstaged, this._commands.stage, false);
    appendChanges('untracked', this._t('group.untracked') + count(groups.untracked), groups.untracked, this._commands.stage, false);
    appendChanges('conflicted', this._t('group.conflicted') + count(groups.conflicted), groups.conflicted, this._commands.stage, this._canLoadMoreChanges());

    const localBranches = Array.isArray(this._branches && this._branches.local) ? this._branches.local : [];
    const branchItems = localBranches.filter((branch) => plainObject(branch) && typeof branch.name === 'string' && branch.name.trim())
      .slice(0, MAX_VISIBLE_SECTION_ITEMS).map((branch, index) => {
      const id = addTarget('branch-' + index, { kind: 'branch', name: branch.name });
      return {
        id,
        title: displayText(branch.name, 256, '-'),
        description: branch.upstream ? displayText(branch.upstream, 512, '-') : undefined,
        meta: branch.hash ? displayText(branch.hash, 160, '-') : undefined,
        badge: branch.name === (this._branches && this._branches.current) ? 'current' : undefined,
        command: this._commands.checkout,
        disabled: branch.name === (this._branches && this._branches.current)
      };
    });
    const remoteBranches = Array.isArray(this._branches && this._branches.remote) ? this._branches.remote : [];
    for (const branch of remoteBranches) {
      if (branchItems.length >= MAX_VISIBLE_SECTION_ITEMS) break;
      if (!plainObject(branch) || typeof branch.name !== 'string' || !branch.name.trim()) continue;
      branchItems.push({ id: 'remote-branch-' + branchItems.length, title: displayText(branch.name, 256), description: this._t('label.remoteBranch'), meta: branch.hash ? displayText(branch.hash, 160) : undefined });
    }
    sections.push({ id: 'branches', title: this._t('section.branches'), items: branchItems, collapsed: true });

    const remoteItems = (Array.isArray(this._remotes && this._remotes.remotes) ? this._remotes.remotes : []).slice(0, MAX_VISIBLE_SECTION_ITEMS).map((entry, index) => ({
      id: 'remote-' + index,
      title: displayText(entry.name, 256, '-'),
      description: displayText(entry.urls && entry.urls[0], 512, this._t('state.remoteUnavailable.title')),
      meta: entry.pushUrls && entry.pushUrls[0] && entry.pushUrls[0] !== (entry.urls && entry.urls[0]) ? displayText(entry.pushUrls[0], 160, '-') : undefined
    }));
    sections.push({ id: 'remotes', title: this._t('section.remotes'), items: remoteItems, emptyMessage: this._t('state.noRemote'), collapsed: true });

    const historyItems = this._history.slice(0, MAX_VISIBLE_SECTION_ITEMS).map((commit, index) => {
      const title = typeof commit.subject === 'string' && commit.subject.trim()
        ? displayText(commit.subject, 256, '-')
        : typeof commit.hash === 'string' && commit.hash
          ? displayText(commit.hash, 256, '-')
          : this._t('group.history');
      return {
        id: 'history-' + index,
        title,
        description: commit.author && typeof commit.author.name === 'string' && commit.author.name
          ? displayText(commit.author.name, 512, '-')
          : undefined,
        meta: typeof commit.hash === 'string' && commit.hash ? displayText(commit.hash, 160, '-').slice(0, 12) : undefined
      };
    });
    sections.push({
      id: 'history',
      title: this._t('group.history'),
      items: historyItems,
      collapsed: true,
      loadMore: this._canLoadMoreHistory()
        ? { command: this._commands.loadMoreHistory, label: this._t('action.loadMore') }
        : undefined
    });

    const branch = status.branch || {};
    const remote = Array.isArray(this._remotes && this._remotes.remotes) && this._remotes.remotes[0];
    const isUnborn = branch.oid === '(initial)';
    const publishAction = action('publish', this._t('action.publish'), this._commands.publish, {
      kind: 'primary',
      placement: isUnborn ? 'button' : 'menu',
      icon: 'publish',
      form: form(this._t('form.publish.title'), this._t('action.publish'), [
        textField('remote', this._t('field.remote'), { required: true, maxLength: 2048 }),
        textField('branch', this._t('field.branch'), { required: true, value: branch.head || 'main', maxLength: 120 }),
        textField('message', this._t('field.initialCommitMessage'), { type: 'textarea', required: true, value: this._t('field.initialCommitDefault'), maxLength: 4096 })
      ])
    });
    const commitAction = action('commit', this._t('action.commit'), this._commands.commit, {
      kind: 'primary', placement: this._enhancedView ? 'inline' : 'toolbar', icon: 'commit',
      form: form(this._t('form.commit.title'), this._t('action.commit'), [
        textField('message', this._t('field.commitMessage'), { type: 'textarea', required: true, maxLength: 4096 })
      ])
    });
    const readyActions = isUnborn
      ? [
        action('refresh', this._t('action.refresh'), this._commands.refresh, { placement: 'toolbar', icon: 'refresh' }),
        action('stageAll', this._t('action.stageAll'), this._commands.stageAll, { placement: 'toolbar', icon: 'stage-all' }),
        commitAction,
        publishAction,
        action('toggleDecorations', this._t(this._decorationsEnabled ? 'action.hideDecorations' : 'action.showDecorations'), this._commands.toggleDecorations, { placement: 'menu', icon: 'visibility' }),
        action('setRemote', this._t('action.setRemote'), this._commands.setRemote, { placement: 'menu', icon: 'remote', form: form(this._t('form.setRemote.title'), this._t('action.setRemote'), [textField('name', this._t('field.remoteName'), { required: true, value: 'origin', maxLength: 64 }), textField('url', this._t('field.remote'), { required: true, maxLength: 2048 })]) }),
        action('createBranch', this._t('action.createBranch'), this._commands.createBranch, {
          placement: 'menu', icon: 'branch',
          form: form(this._t('form.createBranch.title'), this._t('action.createBranch'), [
            textField('name', this._t('field.branch'), { required: true, maxLength: 120 }),
            checkboxField('checkout', this._t('field.checkoutAfterCreate'), true)
          ])
        })
      ]
      : [
        action('refresh', this._t('action.refresh'), this._commands.refresh, { placement: 'toolbar', icon: 'refresh' }),
        action('stageAll', this._t('action.stageAll'), this._commands.stageAll, { placement: 'toolbar', icon: 'stage-all' }),
        commitAction,
        action('push', this._t('action.push'), this._commands.push, {
          placement: 'toolbar', icon: 'push',
          form: form(this._t('form.push.title'), this._t('action.push'), [
            textField('remote', this._t('field.remoteName'), { maxLength: 64, placeholder: 'origin' }),
            textField('branch', this._t('field.localBranch'), { maxLength: 120 }),
            checkboxField('setUpstream', this._t('field.setUpstream'), !branch.upstream)
          ])
        }),
        action('pull', this._t('action.pull'), this._commands.pull, {
          placement: 'menu', icon: 'pull',
          form: form(this._t('form.pull.title'), this._t('action.pull'), [
            textField('remote', this._t('field.remoteName'), { maxLength: 64, placeholder: 'origin' }),
            textField('branch', this._t('field.remoteBranch'), { maxLength: 120 })
          ])
        }),
        action('toggleDecorations', this._t(this._decorationsEnabled ? 'action.hideDecorations' : 'action.showDecorations'), this._commands.toggleDecorations, { placement: 'menu', icon: 'visibility' }),
        action('setRemote', this._t('action.setRemote'), this._commands.setRemote, { placement: 'menu', icon: 'remote', form: form(this._t('form.setRemote.title'), this._t('action.setRemote'), [textField('name', this._t('field.remoteName'), { required: true, value: 'origin', maxLength: 64 }), textField('url', this._t('field.remote'), { required: true, maxLength: 2048 })]) }),
        action('fetch', this._t('action.fetch'), this._commands.fetch, { placement: 'menu', icon: 'pull', form: form(this._t('form.fetch.title'), this._t('action.fetch'), [textField('remote', this._t('field.remoteName'), { maxLength: 64, placeholder: 'origin' })]) }),
        action('checkout', this._t('action.checkout'), this._commands.checkout, { placement: 'menu', icon: 'branch', form: form(this._t('form.checkout.title'), this._t('action.checkout'), [textField('branch', this._t('field.branch'), { required: true, maxLength: 120 })]) }),
        action('createBranch', this._t('action.createBranch'), this._commands.createBranch, { placement: 'menu', icon: 'branch', form: form(this._t('form.createBranch.title'), this._t('action.createBranch'), [textField('name', this._t('field.branch'), { required: true, maxLength: 120 }), checkboxField('checkout', this._t('field.checkoutAfterCreate'), true)]) }),
        action('deleteBranch', this._t('action.deleteBranch'), this._commands.deleteBranch, {
          kind: 'danger',
          placement: 'menu',
          icon: 'branch',
          form: form(this._t('form.deleteBranch.title'), this._t('action.deleteBranch'), [
            textField('name', this._t('field.branch'), { required: true, maxLength: 120 })
          ])
        })
      ];
    return {
      phase: this._phase === LocalScmPhase.LOADING ? 'loading' : 'ready',
      title: this._t('activity.title'),
      message: this._phase === LocalScmPhase.LOADING
        ? this._t(this._operation ? 'operation.' + this._operation : 'state.loading')
        : this._error
        ? (this._error.partialPublish ? this._t('state.publishPartial') + ' ' : '') + this._t(this._errorContent(this._error.kind || 'operationFailed')[1])
        : this._notice
        ? this._t(this._notice)
        : isUnborn
        ? this._t('state.unborn.message')
        : undefined,
      ...(this._enhancedView && this._detail ? { detail: this._detail } : {}),
      ...(this._enhancedView && this._notice && this._phase === LocalScmPhase.READY ? {
        completedAction: ({ 'notice.committed': 'commit', 'notice.published': 'publish', 'notice.cloned': 'clone', 'notice.fetchComplete': 'fetch', 'notice.pullComplete': 'pull', 'notice.pushComplete': 'push', 'notice.pushUpToDate': 'push', 'notice.remoteSaved': 'setRemote' })[this._notice]
      } : {}),
      summary: {
        title: this._t('state.ready'),
        items: [
          { label: this._t('summary.branch'), value: displayText(branch.head, 256, '-') },
          { label: this._t('summary.remote'), value: displayText(remote && remote.urls && remote.urls[0], 256, '-') },
          { label: this._t('summary.upstream'), value: displayText(branch.upstream, 256, '-') },
          { label: this._t('summary.ahead'), value: branch.upstream ? String(Number.isInteger(branch.ahead) ? branch.ahead : 0) : '-' },
          { label: this._t('summary.behind'), value: branch.upstream ? String(Number.isInteger(branch.behind) ? branch.behind : 0) : '-' }
        ]
      },
      sections,
      actions: this._phase === LocalScmPhase.LOADING ? readyActions.map((item) => ({ ...item, disabled: true })) : readyActions
    };
  }

  async _emit() {
    if (this._disposed) return;
    await this._publish(jsonClone(this._snapshot()));
  }

  _enqueue(work) {
    const next = this._queue.then(work, work);
    this._queue = next.catch(() => {});
    return next;
  }
}

export function createTranslator(bundle, locale) {
  const dictionaries = plainObject(bundle) ? bundle : {};
  const dictionary = dictionaries[normalizedLocale(locale)] || dictionaries.en || {};
  return (key) => typeof dictionary[key] === 'string' ? dictionary[key] : key;
}
