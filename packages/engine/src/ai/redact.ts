// Guards that keep secrets out of anything sent to the model. Three layers: a path
// denylist (files that are secrets by name/location), a binary-file skip (a raw
// key neither matches a text regex nor is caught by name), and a content scan
// (files that contain secret-looking values). All are deliberately conservative —
// a false "sensitive" just omits a file, which is always safe.
//
// This is best-effort, not a guarantee: it is a curated regex/denylist set, not a
// full scanner. It covers the common credential shapes and locations; an unusual
// secret can still slip through. When stronger assurance is needed, run gitleaks
// over the candidate set before packing.

/** Repo-relative paths that must never be read into AI context, by name/shape. */
const SENSITIVE_PATH = [
  /(^|\/)\.env($|\.|\/)/i, // .env, .env.local, .env.production, .env/...
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.netrc$/i,
  /(^|\/)\.pgpass$/i,
  /(^|\/)id_[a-z0-9]+(\.(pub|bak|old|orig))?$/i, // id_rsa, id_ed25519, id_rsa.bak
  /(^|\/)(credentials|secrets?)(\.[a-z0-9]+)?$/i,
  /(^|\/)kube_?config$/i, // kubeconfig / kube_config
  // Secret-bearing dotfolders: anything under .aws/.ssh/.kube/.gnupg/.docker.
  /(^|\/)\.(aws|ssh|kube|gnupg|gpg|docker)(\/|$)/i,
  // Key / certificate / credential-store extensions.
  /\.(pem|key|pfx|p12|keystore|jks|ppk|asc|gpg|crt|cer|der|p8|p7b|p7c|kdbx|ovpn)$/i,
];

/** True if a file should be excluded from AI context based on its path alone. */
export function isSensitivePath(relPath: string): boolean {
  const p = relPath.replace(/\\/g, "/");
  return SENSITIVE_PATH.some((re) => re.test(p));
}

/**
 * True if a file is (lossily decoded) binary. A NUL byte in the first 8 KB is a
 * strong binary signal — text files, even UTF-8 with a BOM, don't contain NUL —
 * and a raw binary secret would otherwise be regex-scanned as garbage and sent.
 */
export function looksBinary(contents: string): boolean {
  const limit = Math.min(contents.length, 8192);
  for (let i = 0; i < limit; i++) {
    if (contents.charCodeAt(i) === 0) return true; // NUL byte
  }
  return false;
}

// Secret-looking content. Matches common key shapes, provider tokens, inline
// credentials, and generic `key = "value"` assignments. Kept broad on purpose;
// the cost of a false positive is one skipped file, the cost of a miss is a
// leaked credential.
const SECRET_CONTENT = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /\bghp_[A-Za-z0-9]{36}\b/, // GitHub PAT
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, // Slack token
  /\bsk-[A-Za-z0-9]{20,}\b/, // OpenAI-style / sk- keys
  /\bsk-ant-[A-Za-z0-9-]{20,}\b/, // Anthropic key
  /\b[rs]k_(?:live|test)_[A-Za-z0-9]{10,}\b/, // Stripe secret/restricted keys
  /\bAIza[0-9A-Za-z_-]{35}\b/, // Google API key
  // JWT: three base64url segments. Often a bearer token in a config/fixture.
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  // Service-account / cloud credential JSON blobs.
  /"type"\s*:\s*"service_account"/,
  /"private_key"\s*:\s*"-----BEGIN/,
  /\bAccountKey=[A-Za-z0-9+/=]{20,}/i, // Azure storage connection string
  // Connection URL with an inline password: scheme://user:password@host.
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|rediss|amqps?|ftp|ssh):\/\/[^\s:@/]+:[^\s:@/]+@/i,
  // Generic secret assignment, quoted or unquoted. An unquoted value must end
  // there (a dot is fine: passwords and JWTs have them), so
  // `token = resolveToken(flags.token)` is code, not a credential. So is a
  // value that names another secret (`token: auth.token`) or a lone
  // identifier in an object literal (`token: explicit,`): it refers to a
  // secret rather than holding one.
  /(?:api[_-]?key|secret|token|password|passwd|client[_-]?secret)\s*[:=]\s*(?:['"][^'"\s]{8,}['"]|(?!(?:[A-Za-z_$][\w$]*\.)+[\w$]*(?:key|secret|token|passw(?:or)?d)(?=$|[\s,;'"`])|[A-Za-z_$]+,)[^\s'"()]{8,}(?=$|[\s,;'"]))/im,
];

/** True if a file's contents look like they contain a secret. */
export function looksLikeSecret(contents: string): boolean {
  return SECRET_CONTENT.some((re) => re.test(contents));
}
