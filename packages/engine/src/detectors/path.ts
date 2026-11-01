// Navigating and comparing values inside parsed JSON/YAML documents.

/** Split a `a.b[0].c` path into tokens: ["a", "b", "0", "c"]. */
export function tokenizePath(path: string): string[] {
  return path
    .replace(/\[(\w+)\]/g, ".$1")
    .split(".")
    .map((token) => token.trim())
    .filter(Boolean);
}

export interface PathLookup {
  found: boolean;
  value: unknown;
}

/** Walk a dot/bracket path into a parsed document. */
export function getByPath(root: unknown, path: string): PathLookup {
  let current: unknown = root;
  for (const token of tokenizePath(path)) {
    if (current === null || typeof current !== "object") {
      return { found: false, value: undefined };
    }
    const container = current as Record<string, unknown>;
    if (!(token in container)) {
      return { found: false, value: undefined };
    }
    current = container[token];
  }
  return { found: true, value: current };
}

/** Structural deep equality for plain JSON/YAML data (objects, arrays, scalars). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== "object") return false;

  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr !== bArr) return false;

  if (aArr && bArr) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => key in bObj && deepEqual(aObj[key], bObj[key]));
}
