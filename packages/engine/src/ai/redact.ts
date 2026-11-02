// Guards that keep secrets out of anything sent to the model. Two layers: a path
// denylist (files that are secrets by name) and a content scan (files that contain
// secret-looking values). Both are deliberately conservative — a false "sensitive"
// just omits a file, which is always safe.

/** Repo-relative paths that must never be read into AI context, by name/shape. */
const SENSITIVE_PATH = [
  /(^|\/)\.env($|\.|\/)/i, // .env, .env.local, .env.production, .env/...
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.netrc$/i,
  /(^|\/)\.pgpass$/i,
  /(^|\/)id_[a-z0-9]+$/i, // id_rsa, id_ed25519, ...
  /(^|\/)(credentials|secrets?)(\.[a-z0-9]+)?$/i,
  /\.(pem|key|pfx|p12|keystore|jks|ppk|asc|gpg)$/i,
];

/** True if a file should be excluded from AI context based on its path alone. */
export function isSensitivePath(relPath: string): boolean {
  const p = relPath.replace(/\\/g, "/");
  return SENSITIVE_PATH.some((re) => re.test(p));
}

// Secret-looking content. Matches common key shapes and generic `key = "value"`
// assignments. Kept broad on purpose; the cost of a false positive is one skipped
// file, the cost of a miss is a leaked credential.
const SECRET_CONTENT = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /\bghp_[A-Za-z0-9]{36}\b/, // GitHub PAT
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, // Slack token
  /\bsk-[A-Za-z0-9]{20,}\b/, // OpenAI-style / sk- keys
  /\bsk-ant-[A-Za-z0-9-]{20,}\b/, // Anthropic key
  /\bAIza[0-9A-Za-z_-]{35}\b/, // Google API key
  /(?:api[_-]?key|secret|token|password|passwd|client[_-]?secret)\s*[:=]\s*['"][^'"\s]{8,}['"]/i,
];

/** True if a file's contents look like they contain a secret. */
export function looksLikeSecret(contents: string): boolean {
  return SECRET_CONTENT.some((re) => re.test(contents));
}
