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

/** Markdown → sanitized HTML (no remote content; CSP-safe). */
export function renderMarkdown(md: string): string {
  const html = marked.parse(md, { async: false });
  return DOMPurify.sanitize(html);
}
