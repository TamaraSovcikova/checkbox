// A deliberately tiny, dependency-free markdown renderer for task notes. It
// escapes HTML first, then applies a small, safe subset: headings, bold/italic,
// inline code, links (explicit + bare URLs), and - / * bullet lists. Anything
// fancier falls through as plain text with preserved line breaks.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, '<code class="rounded bg-surface-2 px-1 text-[0.85em]">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer" class="text-primary hover:underline">$1</a>'
    )
    .replace(
      /(^|[\s(])(https?:\/\/[^\s)]+)/g,
      '$1<a href="$2" target="_blank" rel="noreferrer" class="text-primary hover:underline">$2</a>'
    );
}

function toHtml(src: string): string {
  const lines = escapeHtml(src).split("\n");
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (bullet) {
      if (!inList) {
        out.push('<ul class="ml-4 list-disc space-y-0.5">');
        inList = true;
      }
      out.push(`<li>${inline(bullet[1])}</li>`);
    } else if (heading) {
      closeList();
      const level = heading[1].length;
      const cls = level === 1 ? "text-base font-semibold" : "text-sm font-semibold";
      out.push(`<div class="${cls} text-foreground">${inline(heading[2])}</div>`);
    } else if (line === "") {
      closeList();
      out.push('<div class="h-2"></div>');
    } else {
      closeList();
      out.push(`<div>${inline(line)}</div>`);
    }
  }
  closeList();
  return out.join("");
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: toHtml(text) }}
    />
  );
}
