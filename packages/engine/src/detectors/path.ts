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

/**
 * Walk a dot/bracket path into a parsed document. Only own data properties count:
 * inherited/prototype keys (`toString`, `constructor`, `__proto__`) and array
 * members other than in-range numeric indices (`length`, `map`) are "not found",
 * so a control never passes on a key the file did not actually set.
 */
export function getByPath(root: unknown, path: string): PathLookup {
  let current: unknown = root;
  for (const token of tokenizePath(path)) {
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(token) || Number(token) >= current.length) {
        return { found: false, value: undefined };
      }
      current = current[Number(token)];
      continue;
    }
    if (current === null || typeof current !== "object") {
      return { found: false, value: undefined };
    }
    if (!Object.prototype.hasOwnProperty.call(current, token)) {
      return { found: false, value: undefined };
    }
    current = (current as Record<string, unknown>)[token];
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
