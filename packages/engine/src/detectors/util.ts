/** Split a `a|b|c` detector path into individual glob patterns. */
export function splitGlobs(path: string): string[] {
  return path
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Compile a control's regex pattern. Control patterns are authored in a
 * Go/PCRE-ish dialect and may begin with an inline flag group like `(?i)`,
 * which JavaScript's RegExp does not accept inline — so we lift it to a flag.
 */
export function compileRegex(pattern: string): RegExp {
  let flags = "";
  let source = pattern;
  const inline = /^\(\?([ims]+)\)/.exec(source);
  if (inline) {
    flags = inline[1] ?? "";
    source = source.slice(inline[0].length);
  }
  return new RegExp(source, flags);
}
