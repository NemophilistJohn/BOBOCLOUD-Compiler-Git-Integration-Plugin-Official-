// Builds a bounded topological lane layout from Git's commit and parent ids.
// Every row carries only numeric drawing instructions; the trusted host owns SVG.
export function buildCommitGraph(commits) {
  const lanes = [];
  return (Array.isArray(commits) ? commits : []).map((commit) => {
    const hash = typeof commit.hash === 'string' ? commit.hash : '';
    let column = lanes.indexOf(hash);
    const incoming = column >= 0;
    if (column < 0) { column = lanes.length; lanes.push(hash); }
    const before = lanes.slice();
    lanes.splice(column, 1);
    const parents = Array.isArray(commit.parents) ? [...new Set(commit.parents.filter((value) => typeof value === 'string' && value))] : [];
    parents.forEach((parent, index) => {
      if (!lanes.includes(parent)) lanes.splice(index === 0 ? Math.min(column, lanes.length) : lanes.length, 0, parent);
    });
    const links = [];
    before.forEach((value, from) => {
      if (from === column) return;
      const to = lanes.indexOf(value);
      if (to >= 0 && from < 12 && to < 12) links.push({ from, to, viaNode: false });
    });
    parents.forEach((parent) => {
      const to = lanes.indexOf(parent);
      if (column < 12 && to >= 0 && to < 12) links.push({ from: column, to, viaNode: true });
    });
    return { width: Math.max(1, Math.min(12, Math.max(before.length, lanes.length))), node: Math.min(column, 11), incoming, links: links.slice(0, 24) };
  });
}

export function remotePresentation(remote) {
  const address = Array.isArray(remote.urls) && typeof remote.urls[0] === 'string' ? remote.urls[0] : '';
  const source = address.replace(/[?#].*$/, '').replace(/\/+$/, '');
  const name = source.split(/[/:]/).pop().replace(/\.git$/i, '');
  const platform = typeof remote.platform === 'string' && remote.platform.trim() ? remote.platform.trim()
    : /github\.com/i.test(address) ? 'GitHub'
    : /gitlab/i.test(address) ? 'GitLab'
    : /gitee\.com/i.test(address) ? 'Gitee' : 'Git';
  return { title: typeof remote.label === 'string' && remote.label.trim() ? remote.label.trim() : remote.name, platform, name: name || remote.name };
}
