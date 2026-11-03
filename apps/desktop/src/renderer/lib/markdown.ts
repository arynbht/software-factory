import DOMPurify from "dompurify";
import { marked, type Tokens } from "marked";

// Render ```mermaid fences as <pre class="mermaid"> holding the diagram source,
// so the Docs screen can hand them to mermaid.run after the HTML is in the DOM.
// All other code uses marked's default rendering.
marked.use({
  renderer: {
    code(token: Tokens.Code): string | false {
      if (token.lang === "mermaid") {
        const escaped = token.text
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        return `<pre class="mermaid">${escaped}</pre>`;
      }
      return false;
    },
  },
});

// Force every surviving link to open safely: real anchors get noopener/noreferrer
// and (for anything targeting outside) _blank, so a doc link can't reach back into
// the renderer's window via `opener`. External navigation itself is still gated by
// the main process's will-navigate + openExternal allow-list.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.hasAttribute("href")) {
    node.setAttribute("rel", "noopener noreferrer");
    node.setAttribute("target", "_blank");
  }
});

/** Markdown → sanitized HTML (no remote content; CSP-safe). */
export function renderMarkdown(md: string): string {
  const html = marked.parse(md, { async: false });
  return DOMPurify.sanitize(html, {
    // Only http(s), mailto, and in-doc #anchor links survive — no
    // javascript:/data:/vbscript: URIs (tighter than DOMPurify's default).
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i,
  });
}
