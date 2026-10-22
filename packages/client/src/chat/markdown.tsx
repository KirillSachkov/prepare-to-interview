// Basic Markdown in Interviewer replies: paragraphs, headings, lists, fenced code, inline code,
// bold, italics, and http(s) links. It builds React elements only and never raw HTML, so text
// from the agent (which may echo web pages) cannot inject markup.
import type { ReactNode } from "react";

type Block =
  | { kind: "paragraph"; lines: string[] }
  | { kind: "heading"; level: number; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; text: string };

function blocks(text: string): Block[] {
  const out: Block[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^\s*```/.test(line)) {
      const code: string[] = [];
      // An unclosed fence (a reply still streaming) runs to the end.
      for (i++; i < lines.length && !/^\s*```/.test(lines[i] ?? ""); i++) code.push(lines[i] ?? "");
      out.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    if (!line.trim()) continue;
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      out.push({ kind: "heading", level: heading[1]?.length ?? 1, text: heading[2] ?? "" });
      continue;
    }
    const item = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (item) {
      const ordered = item[2] !== undefined;
      const last = out.at(-1);
      if (last?.kind === "list" && last.ordered === ordered) last.items.push(item[3] ?? "");
      else out.push({ kind: "list", ordered, items: [item[3] ?? ""] });
      continue;
    }
    const last = out.at(-1);
    // A line right after a list item continues it; otherwise it continues the paragraph.
    if (last?.kind === "list" && /^\s+\S/.test(line)) last.items.push(`${last.items.pop() ?? ""} ${line.trim()}`);
    else if (last?.kind === "paragraph" && lines[i - 1]?.trim()) last.lines.push(line);
    else out.push({ kind: "paragraph", lines: [line] });
  }
  return out;
}

const inlinePattern = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[[^\]]+\]\([^)\s]+\))/;

function inline(text: string, key = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;
  for (let match = inlinePattern.exec(rest); match; match = inlinePattern.exec(rest)) {
    if (match.index > 0) out.push(rest.slice(0, match.index));
    const [token] = match;
    const k = `${key}-${String(n++)}`;
    if (match[1]) {
      out.push(
        <code key={k} className="rounded bg-stone-200/70 px-1 font-mono text-[0.92em]">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (match[2]) {
      out.push(<strong key={k}>{inline(token.slice(2, -2), k)}</strong>);
    } else if (match[3]) {
      out.push(<em key={k}>{inline(token.slice(1, -1), k)}</em>);
    } else {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      const href = link?.[2] ?? "";
      // Only web links; any other scheme stays plain text.
      if (/^https?:\/\//i.test(href)) {
        out.push(
          <a key={k} href={href} target="_blank" rel="noreferrer noopener" className="text-indigo-700 underline">
            {inline(link?.[1] ?? "", k)}
          </a>,
        );
      } else {
        out.push(token);
      }
    }
    rest = rest.slice(match.index + token.length);
  }
  if (rest) out.push(rest);
  return out;
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-2 whitespace-normal">
      {blocks(text).map((block, i) => {
        const key = String(i);
        switch (block.kind) {
          case "heading":
            return (
              <p key={key} className="font-semibold">
                {inline(block.text, key)}
              </p>
            );
          case "code":
            return (
              <pre key={key} className="overflow-x-auto rounded bg-stone-200/70 p-2 font-mono text-[12px] whitespace-pre">
                {block.text}
              </pre>
            );
          case "list": {
            const items = block.items.map((item, j) => <li key={String(j)}>{inline(item, `${key}-${String(j)}`)}</li>);
            return block.ordered ? (
              <ol key={key} className="list-decimal space-y-0.5 pl-5">
                {items}
              </ol>
            ) : (
              <ul key={key} className="list-disc space-y-0.5 pl-5">
                {items}
              </ul>
            );
          }
          case "paragraph":
            return (
              <p key={key} className="whitespace-pre-wrap">
                {inline(block.lines.join("\n"), key)}
              </p>
            );
        }
      })}
    </div>
  );
}
