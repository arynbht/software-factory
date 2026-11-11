// Screenshots go to an orphan `evidence` branch through the Contents API
// (§9): no external hosts, no gists, and nothing in the change's own history.
// Paths are `<task>/<file>`, so each task's proof sits in one directory.
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

export const EVIDENCE_BRANCH = "evidence";

/** The few GitHub calls publishing needs (an Octokit fits; tests pass a fake). */
export interface EvidenceClient {
  rest: {
    repos: {
      getBranch(p: {
        owner: string;
        repo: string;
        branch: string;
      }): Promise<unknown>;
      getContent(p: {
        owner: string;
        repo: string;
        path: string;
        ref: string;
      }): Promise<{ data: unknown }>;
      createOrUpdateFileContents(p: {
        owner: string;
        repo: string;
        path: string;
        message: string;
        content: string;
        branch: string;
        sha?: string;
      }): Promise<unknown>;
    };
    git: {
      createTree(p: {
        owner: string;
        repo: string;
        tree: { path: string; mode: "100644"; type: "blob"; content: string }[];
      }): Promise<{ data: { sha: string } }>;
      createCommit(p: {
        owner: string;
        repo: string;
        message: string;
        tree: string;
        parents: string[];
      }): Promise<{ data: { sha: string } }>;
      createRef(p: {
        owner: string;
        repo: string;
        ref: string;
        sha: string;
      }): Promise<unknown>;
    };
  };
}

const status = (err: unknown) => (err as { status?: number }).status;

/** Create the orphan branch (one README commit, no parents) if it's missing. */
async function ensureBranch(
  gh: EvidenceClient,
  owner: string,
  repo: string,
): Promise<void> {
  try {
    await gh.rest.repos.getBranch({ owner, repo, branch: EVIDENCE_BRANCH });
    return;
  } catch (err) {
    if (status(err) !== 404) throw err;
  }
  const tree = await gh.rest.git.createTree({
    owner,
    repo,
    tree: [
      {
        path: "README.md",
        mode: "100644",
        type: "blob",
        content:
          "# Evidence\n\nProof the factory produced for its tasks, one directory per task. Written by `factory task prove`; nothing here is code.\n",
      },
    ],
  });
  const commit = await gh.rest.git.createCommit({
    owner,
    repo,
    message: "chore(factory): start the evidence branch",
    tree: tree.data.sha,
    parents: [],
  });
  await gh.rest.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${EVIDENCE_BRANCH}`,
    sha: commit.data.sha,
  });
}

/**
 * Upload `files` to `evidence/<task>/`. Returns, per file, the URL that shows
 * the image (for the PR body's Before/After table).
 */
export async function publishEvidence(options: {
  gh: EvidenceClient;
  owner: string;
  repo: string;
  task: string;
  files: readonly string[];
}): Promise<{ file: string; url: string }[]> {
  const { gh, owner, repo, task } = options;
  await ensureBranch(gh, owner, repo);
  const out: { file: string; url: string }[] = [];
  for (const file of options.files) {
    const path = `${task}/${basename(file)}`;
    let sha: string | undefined;
    try {
      const { data } = await gh.rest.repos.getContent({
        owner,
        repo,
        path,
        ref: EVIDENCE_BRANCH,
      });
      sha = (data as { sha?: string }).sha;
    } catch (err) {
      if (status(err) !== 404) throw err;
    }
    await gh.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message: `chore(factory): ${task} proof`,
      content: (await readFile(file)).toString("base64"),
      branch: EVIDENCE_BRANCH,
      ...(sha ? { sha } : {}),
    });
    out.push({
      file,
      url: `https://github.com/${owner}/${repo}/blob/${EVIDENCE_BRANCH}/${path}?raw=true`,
    });
  }
  return out;
}
