import type { ReactNode } from "react";
import { markdownToDoc } from "@/lib/rich-text-markdown";
import type { MentionUser, RichTextDoc, RichTextMark, RichTextNode } from "@/lib/rich-text-types";
import { isSafeHref } from "@/lib/rich-text-url";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderText(
  text: string,
  marks: RichTextMark[] | undefined,
  mentionNames: string[],
  keyPrefix: string,
): ReactNode {
  let content: ReactNode = text;
  if (mentionNames.length > 0) {
    const pattern = new RegExp(
      `@(${mentionNames.map(escapeRegExp).join("|")})(?=$|[\\s.,!?、。:：;；()（）\\[\\]【】])`,
      "g",
    );
    const parts: ReactNode[] = [];
    let last = 0;
    let match: RegExpExecArray | null;
    let index = 0;
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > last) parts.push(text.slice(last, match.index));
      parts.push(
        <span
          key={`${keyPrefix}-mention-${index}`}
          data-comment-mention={match[1]}
          className="rounded bg-accent-soft px-1 font-medium text-accent-text"
        >
          {match[0]}
        </span>,
      );
      last = match.index + match[0].length;
      index += 1;
    }
    if (last < text.length) parts.push(text.slice(last));
    content = parts;
  }

  for (const mark of marks ?? []) {
    if (mark.type === "bold") content = <strong>{content}</strong>;
    else if (mark.type === "italic") content = <em>{content}</em>;
    else if (mark.type === "underline") content = <u>{content}</u>;
    else if (mark.type === "strike") content = <s>{content}</s>;
    else if (mark.type === "code") content = <code>{content}</code>;
    else if (mark.type === "highlight") content = <mark>{content}</mark>;
    else if (mark.type === "link" && isSafeHref(mark.attrs?.href)) {
      content = (
        <a href={mark.attrs.href} target="_blank" rel="noopener noreferrer">
          {content}
        </a>
      );
    }
  }
  return content;
}

function renderNode(
  node: RichTextNode,
  mentionNames: string[],
  key: string,
): ReactNode {
  const children = (node.content ?? []).map((child, index) => renderNode(child, mentionNames, `${key}-${index}`));
  switch (node.type) {
    case "doc":
      return children;
    case "paragraph":
      return <p key={key}>{children.length > 0 ? children : <br />}</p>;
    case "heading": {
      const level = Math.max(1, Math.min(3, Number(node.attrs?.level) || 1));
      if (level === 1) return <h1 key={key}>{children}</h1>;
      if (level === 2) return <h2 key={key}>{children}</h2>;
      return <h3 key={key}>{children}</h3>;
    }
    case "text":
      return (
        <span key={key}>{renderText(node.text ?? "", node.marks, mentionNames, key)}</span>
      );
    case "mention": {
      const label = String(node.attrs?.label ?? node.attrs?.id ?? "");
      return (
        <span
          key={key}
          data-comment-mention={label}
          className="rounded bg-accent-soft px-1 font-medium text-accent-text"
        >
          @{label}
        </span>
      );
    }
    case "hardBreak":
      return <br key={key} />;
    case "horizontalRule":
      return <hr key={key} />;
    case "bulletList":
      return <ul key={key}>{children}</ul>;
    case "orderedList":
      return <ol key={key}>{children}</ol>;
    case "listItem":
      return <li key={key}>{children}</li>;
    case "taskList":
      return (
        <ul key={key} data-type="taskList" className="atlas-task-list">
          {children}
        </ul>
      );
    case "taskItem": {
      const checked = node.attrs?.checked === true;
      return (
        <li key={key} data-checked={checked} className="atlas-task-item">
          <input type="checkbox" checked={checked} readOnly disabled aria-label={checked ? "完了" : "未完了"} />
          <div className="min-w-0 flex-1">{children}</div>
        </li>
      );
    }
    case "blockquote":
      return <blockquote key={key}>{children}</blockquote>;
    case "codeBlock":
      return (
        <pre key={key}>
          <code>{children}</code>
        </pre>
      );
    default:
      return children.length > 0 ? <span key={key}>{children}</span> : null;
  }
}

/** Safe read-only renderer for validated ProseMirror JSON. No HTML strings. */
export default function RichTextView({
  doc,
  legacy,
  mentionUsers = [],
  className = "",
  dataAttribute,
}: {
  doc: RichTextDoc | null | undefined;
  legacy?: string;
  mentionUsers?: MentionUser[];
  className?: string;
  dataAttribute?: Record<string, string>;
}) {
  const value = doc ?? markdownToDoc(legacy ?? "", mentionUsers);
  const mentionNames = mentionUsers.map((user) => user.name).filter((name) => name.trim() !== "");
  return (
    <div className={`atlas-rich-text ${className}`} {...dataAttribute}>
      {renderNode(value, mentionNames, "root")}
    </div>
  );
}
