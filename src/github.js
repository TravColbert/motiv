import { resolveCredential } from "./config.js";

const GITHUB_API_URL = "https://api.github.com";

/**
 * Make an authenticated request to the GitHub API.
 */
async function githubFetch(endpoint, options = {}) {
  const token = resolveCredential("GITHUB_TOKEN");

  const response = await fetch(`${GITHUB_API_URL}${endpoint}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GitHub API error (${response.status}): ${error}`);
  }

  return response.json();
}

/**
 * Parse owner and repo name from a git remote URL.
 * Supports both SSH and HTTPS formats:
 *   git@github.com:owner/repo.git
 *   https://github.com/owner/repo.git
 */
export function parseRepoUrl(repoUrl) {
  // SSH format
  let match = repoUrl.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/);
  if (match) {
    return { owner: match[1], repo: match[2] };
  }
  throw new Error(`Cannot parse GitHub repo URL: ${repoUrl}`);
}

/**
 * Create a pull request. Draft by default.
 * Returns the PR object with html_url.
 */
export async function createPR({
  repoUrl,
  branch,
  baseBranch,
  title,
  body,
  draft = true,
}) {
  const { owner, repo } = parseRepoUrl(repoUrl);

  const pr = await githubFetch(`/repos/${owner}/${repo}/pulls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      body,
      head: branch,
      base: baseBranch || "main",
      draft,
    }),
  });

  return pr;
}

/** @deprecated Use createPR instead */
export const createDraftPR = createPR;

/**
 * Enable auto-merge on a pull request (squash strategy).
 * Best-effort — logs a warning if the repo doesn't support auto-merge.
 */
export async function enableAutoMerge(repoUrl, prNumber) {
  const { owner, repo } = parseRepoUrl(repoUrl);

  try {
    await githubFetch(`/repos/${owner}/${repo}/pulls/${prNumber}/merge`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merge_method: "squash",
      }),
    });
  } catch (err) {
    console.warn(`  Warning: Could not enable auto-merge: ${err.message}`);
  }
}
