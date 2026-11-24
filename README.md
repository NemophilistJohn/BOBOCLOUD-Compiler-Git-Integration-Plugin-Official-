# BOBOCloud Local Source Control 3.0

`bobocloud.local-scm` provides Git source control for the active **local**
workspace. It uses the host's structured Git broker and does not operate on
cloud workspaces. Version 3.0 requires Plugin API 1.12.0 or newer within 1.x.

The sidebar keeps remote cards and page tabs visible above the working area.
Cards can be added, edited or removed; their labels, platform and multi-select
state are stored in the local repository's Git configuration. The local changes
page offers staging, a local commit and commit-and-push to selected remotes.
The commit happens once, followed by separate pushes and per-remote results.
The broker checks the expected commit and push destination immediately before
each push. An unknown outcome is not automatically retried.

The commits and branches page uses one selected remote and draws a vertical
graph of commits reachable from its fetched remote branches. Its contents
are based on the last fetched references; use Fetch to update them. Removing a
card removes its Git remote and local remote-tracking references, not the hosted
repository or local source files. Git must be available on PATH; authentication
uses the local Git credential helper or SSH agent.

The installable artifact is `artifacts/bobocloud.local-scm-3.0.0.boboplugin`.
Run `npm install` followed by `npm run package` to build it, run its tests and
verify archive integrity. The host renders all UI from bounded data; the Worker
has no DOM, shell, arbitrary network, or direct filesystem access. Localized
strings are provided in English, Simplified Chinese and Japanese.
