// Post or update a sticky PR comment using the GitHub REST API. No deps.

'use strict';

const https = require('https');

const STICKY_MARKER = '<!-- codeflow-card:receipt -->';

function ghRequest(opts) {
  const { token, method, path, body } = opts;
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        method,
        hostname: 'api.github.com',
        path,
        headers: {
          'Authorization': 'Bearer ' + token,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'codeflow-card-action',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode >= 400) {
            reject(new Error('GitHub API ' + method + ' ' + path + ' returned ' + res.statusCode + ': ' + text));
            return;
          }
          try {
            resolve(text ? JSON.parse(text) : {});
          } catch {
            resolve({ raw: text });
          }
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function listIssueComments({ token, owner, repo, issueNumber }) {
  const out = [];
  let page = 1;
  while (true) {
    const items = await ghRequest({
      token,
      method: 'GET',
      path: '/repos/' + owner + '/' + repo + '/issues/' + issueNumber + '/comments?per_page=100&page=' + page,
    });
    if (!Array.isArray(items) || items.length === 0) break;
    out.push(...items);
    if (items.length < 100) break;
    page += 1;
  }
  return out;
}

async function upsertStickyComment(opts) {
  const { token, owner, repo, issueNumber, body } = opts;
  const finalBody = body.includes(STICKY_MARKER) ? body : STICKY_MARKER + '\n\n' + body;

  const existing = await listIssueComments({ token, owner, repo, issueNumber });
  const mine = existing.find((c) => c.body && c.body.includes(STICKY_MARKER));

  if (mine) {
    return ghRequest({
      token,
      method: 'PATCH',
      path: '/repos/' + owner + '/' + repo + '/issues/comments/' + mine.id,
      body: { body: finalBody },
    });
  }
  return ghRequest({
    token,
    method: 'POST',
    path: '/repos/' + owner + '/' + repo + '/issues/' + issueNumber + '/comments',
    body: { body: finalBody },
  });
}

module.exports = { upsertStickyComment, STICKY_MARKER };
