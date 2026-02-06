import crypto from 'node:crypto';

const GITHUB_API_BASE = 'https://api.github.com';

export function requireGitHubToken() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('Missing GITHUB_TOKEN environment variable.');
  }
  return token;
}

export async function githubRequest(path, options = {}) {
  const token = requireGitHubToken();
  const headers = new Headers(options.headers ?? {});
  headers.set('Accept', 'application/vnd.github+json');
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('X-GitHub-Api-Version', '2022-11-28');

  return fetch(`${GITHUB_API_BASE}${path}`, {
    ...options,
    headers,
  });
}

export function randomSeatToken() {
  return crypto.randomBytes(24).toString('base64url');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
