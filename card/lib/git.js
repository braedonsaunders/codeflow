// Commit the SVG and JSON state file back to the repo. Uses git CLI directly.

'use strict';

const { execFileSync } = require('child_process');

function git(args, cwd) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

function gitSafe(args, cwd) {
  try {
    return git(args, cwd);
  } catch (e) {
    return null;
  }
}

function configureIdentity(cwd, name, email) {
  git(['config', 'user.name', name], cwd);
  git(['config', 'user.email', email], cwd);
}

function commitAndPush(opts) {
  const cwd = opts.cwd;
  const paths = opts.paths || [];
  if (paths.length === 0) return { committed: false, reason: 'no paths' };

  configureIdentity(cwd, opts.authorName, opts.authorEmail);

  for (const p of paths) {
    gitSafe(['add', p], cwd);
  }

  const status = git(['status', '--porcelain', '--', ...paths], cwd);
  if (!status) return { committed: false, reason: 'no changes' };

  git(['commit', '-m', opts.message], cwd);

  if (opts.push) {
    const branch = opts.branch || gitSafe(['rev-parse', '--abbrev-ref', 'HEAD'], cwd) || 'HEAD';
    if (branch && branch !== 'HEAD') {
      git(['push', 'origin', branch], cwd);
    }
  }
  return { committed: true };
}

module.exports = { git, gitSafe, commitAndPush };
