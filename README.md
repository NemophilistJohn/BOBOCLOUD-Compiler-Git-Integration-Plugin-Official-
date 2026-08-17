# BOBOCloud Local Source Control

`bobocloud.local-scm` is the official source-control plugin for a BOBOCloud
**local workspace**. It uses the host-provided local Git broker and never
reads, writes, or synchronizes a cloud workspace.

## Install And Package

The versioned installable artifact is kept at:

`artifacts/bobocloud.local-scm-1.1.0.boboplugin`

Build and verify it from this directory:

```powershell
npm install
npm run package
```

`npm run package` builds the single Worker entry, copies the private locale
files, generates SHA-256 entries in `plugin/manifest.json`, runs the Node
tests, creates the `.boboplugin` archive, and verifies its central directory
against the integrity manifest. The unpacked `plugin/` directory is generated
and ignored; `artifacts/` contains the intentionally versioned installable
file.

Install the archive through BOBOCloud's Extensions view. BOBOCloud enables the
declared local source-control permissions by default; each permission remains
individually revocable from the extension detail tab.

## Requirements And Boundary

- Git must be installed and available on the desktop application's `PATH`.
- Clone writes only to an empty active local workspace.
- Repository discovery includes nested local repositories.
- There is no direct DOM, network, shell, child-process, rclone, or cloud-sync
  implementation in this package. All Git operations go through the bounded
  `context.scm.git` host broker.
- The plugin does not create hosted pull requests and does not expose a cloud
  pull-request API.

When Git is absent, the source-control view exposes only the localized error
state and Refresh. In Chinese this is: `当前无 Git 环境，请安装 Git 并配置 PATH 后刷新。`

## Supported Local Operations

- Detect and initialize repositories; clone HTTPS or SSH remotes into an empty
  local workspace.
- View staged, unstaged, untracked, and conflicted files, including bounded
  `+N -N` line statistics when the broker can safely provide them.
- Stage or unstage individual files, commit, fetch, pull, and push.
- Create, delete, and check out local branches.
- Load status and history through bounded `offset` / `nextOffset` pagination.
- Publish data-only static file decorations for local SCM state, with an
  immediate Show/Hide toggle in the source-control sidebar.

## Localization And Permissions

All runtime strings are private to this package under `locales/`:
`en.json`, `zh-CN.json`, and `ja.json`. The plugin uses the injected
`context.i18n` service and never changes BOBOCloud's core language packs.

The manifest requests only these host permissions:

- `commands.register`
- `sourceControl.register`
- `fileDecorations.scm`
- `scm.git.read`
- `scm.git.write`

The host uses these declarations as the package's capability ceiling, enables
them after verified installation, and lets the user revoke them later.
Repository IDs and file-operation targets remain in Worker-owned state; the
rendered host gets only bounded, data-only source-control state.
