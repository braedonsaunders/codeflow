// POST /api/analyze-repo -- MOO-67 Commit 6.
//
// The GitHub-backed counterpart to Commit 5's local-path /api/analyze:
// validate inputs -> check the repository allowlist -> fetch from GitHub
// using the server-held token -> analyze -> respond. Every one of those
// steps happens in that order, before any source is retrieved, per the
// checklist's "disallowed repository requests fail before source
// retrieval or analysis."
import { validateRepoRequest, ValidationError } from '../lib/validate-repo-request.js';
import { isRepoAllowed } from '../lib/allowlist.js';
import { analyzeGithubRepo, GithubFetchError } from '../lib/github-analyzer-bridge.js';
import { createRequestLogger } from '../lib/logger.js';
import { readJsonBody, BodyTooLargeError } from '../lib/http-body.js';

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

/** @param {{config: object}} deps */
export function createAnalyzeRepoHandler({ config }) {
  return async function handleAnalyzeRepo(req, res, requestId) {
    const log = createRequestLogger(requestId);

    let body;
    try {
      body = await readJsonBody(req, config.maxRequestBodyBytes);
    } catch (err) {
      if (err instanceof BodyTooLargeError) {
        return sendJson(res, 413, { error: 'Request body too large' });
      }
      return sendJson(res, 400, { error: 'Request body must be valid JSON' });
    }

    let request;
    try {
      request = validateRepoRequest(body);
    } catch (err) {
      if (err instanceof ValidationError) {
        log.warn('rejected analyze-repo request: invalid input', { message: err.message });
        return sendJson(res, 400, { error: err.message });
      }
      throw err;
    }

    if (!isRepoAllowed(request.owner, request.repo, config)) {
      log.warn('rejected analyze-repo request: repository not allowlisted', {
        owner: request.owner,
        repo: request.repo,
      });
      return sendJson(res, 403, { error: 'This repository is not on the allowlist' });
    }

    log.info('analyze-repo request accepted', { owner: request.owner, repo: request.repo, ref: request.ref, pr: request.pr });

    try {
      const { result, resolvedRef, fileCount, skippedOversizedFiles } = await analyzeGithubRepo(request, config);
      log.info('github analysis complete', {
        resolvedRef,
        fileCount,
        functions: result.stats.functions,
        skippedOversizedFiles,
      });
      sendJson(res, 200, { ...result, resolvedRef, skippedOversizedFiles });
    } catch (err) {
      if (err instanceof GithubFetchError) {
        log.warn('github fetch failed', { message: err.message });
        return sendJson(res, 502, { error: err.message });
      }
      log.error('analysis failed', { message: err && err.message });
      sendJson(res, 500, { error: 'Analysis failed', requestId });
    }
  };
}
