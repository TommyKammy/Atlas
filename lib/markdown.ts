// Minimal Markdown subset for descriptions/comments (no dependencies).
// Output is safe by construction: input is HTML-escaped before inline rules run.

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function inline(s: string): string {
  let out = esc(s);
  out = out.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  out = out.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  return out;
}

export function renderMarkdown(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length > 0) {
      blocks.push(`<ul>${list.map((li) => `<li>${inline(li)}</li>`).join("")}</ul>`);
      list = [];
    }
  };
  for (const line of lines) {
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flush();
      const level = heading[1].length;
      blocks.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    const m = line.match(/^\s*[-*] (.+)$/);
    if (m) list.push(m[1]);
    else {
      flush();
      if (line.trim() !== "") blocks.push(`<p>${inline(line)}</p>`);
    }
  }
  flush();
  return blocks.join("");
}
