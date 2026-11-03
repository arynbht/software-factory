import mermaid from "mermaid";
import { FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { errorMessage } from "@/lib/errors";
import { renderMarkdown } from "@/lib/markdown";

import type { DocEntry } from "../../shared/ipc";

mermaid.initialize({
  startOnLoad: false,
  theme: "dark",
  securityLevel: "strict",
});

export function Docs({ repoPath }: { repoPath: string }) {
  const [docs, setDocs] = useState<DocEntry[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [html, setHtml] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDocs(null);
    setSelected(null);
    setHtml("");
    setError(null);
    window.factory.docs.list(repoPath).then(
      (list) => {
        setDocs(list);
        setSelected(list[0]?.path ?? null);
      },
      (err: unknown) => setError(errorMessage(err)),
    );
  }, [repoPath]);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    window.factory.docs.read(repoPath, selected).then(
      (doc) => active && setHtml(renderMarkdown(doc.markdown)),
      (err: unknown) => active && setError(errorMessage(err)),
    );
    return () => {
      active = false;
    };
  }, [repoPath, selected]);

  // Render any Mermaid diagrams once the HTML is in the DOM.
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const nodes = el.querySelectorAll<HTMLElement>("pre.mermaid");
    if (nodes.length === 0) return;
    void mermaid.run({ nodes: Array.from(nodes) }).catch(() => {
      // a malformed diagram shouldn't blank the doc; leave it as source text
    });
  }, [html]);

  if (error && !docs) {
    return (
      <p className="text-sm text-rose-400" role="alert">
        {error}
      </p>
    );
  }

  return (
    <div className="flex gap-4">
      <nav className="w-60 shrink-0 space-y-0.5 border-r border-border pr-2">
        {(docs ?? []).length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            No Markdown docs found under docs/ or .factory/.
          </p>
        ) : (
          (docs ?? []).map((doc) => (
            <button
              key={doc.path}
              type="button"
              onClick={() => setSelected(doc.path)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${
                doc.path === selected
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50"
              }`}
              title={doc.path}
            >
              <FileText className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{doc.name}</span>
            </button>
          ))
        )}
      </nav>
      <div className="min-w-0 flex-1">
        {error && (
          <p className="mb-2 text-sm text-rose-400" role="alert">
            {error}
          </p>
        )}
        <div
          ref={contentRef}
          className="doc-prose max-w-none"
          // Sanitized by DOMPurify in renderMarkdown.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}
