import type { Extensions } from "@tiptap/core";
import Highlight from "@tiptap/extension-highlight";
import Mention from "@tiptap/extension-mention";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import StarterKit from "@tiptap/starter-kit";
import { createMentionSuggestion } from "./rich-text-mention";
import type { MentionUser } from "./rich-text-types";

const LINK_ATTRIBUTES = {
  rel: "noopener noreferrer",
  target: "_blank",
};

/**
 * The shared schema for server validation and the client editor. Keep this
 * allowlist small: unknown nodes or HTML are rejected rather than rendered.
 */
export function richTextExtensions({
  placeholder = "",
  mentionUsers = [],
  withPlaceholder = true,
}: {
  placeholder?: string;
  mentionUsers?: MentionUser[];
  withPlaceholder?: boolean;
} = {}): Extensions {
  const extensions: Extensions = [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: {
        openOnClick: false,
        autolink: true,
        protocols: ["http", "https", "mailto"],
        HTMLAttributes: LINK_ATTRIBUTES,
      },
    }),
    Highlight.configure({ multicolor: false }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Mention.configure({
      HTMLAttributes: {
        class: "atlas-mention",
      },
      deleteTriggerWithBackspace: true,
      renderText: ({ node }) => `@${String(node.attrs.label ?? node.attrs.id ?? "")}`,
      renderHTML: ({ node }) => [
        "span",
        {
          "data-type": "mention",
          "data-id": String(node.attrs.id ?? ""),
          "data-label": String(node.attrs.label ?? ""),
          class: "atlas-mention",
        },
        `@${String(node.attrs.label ?? node.attrs.id ?? "")}`,
      ],
      suggestion: createMentionSuggestion(() =>
        mentionUsers.map((user) => ({ id: user.id, name: user.name, avatar_url: user.avatar_url })),
      ),
    }),
  ];

  if (withPlaceholder) {
    extensions.push(
      Placeholder.configure({
        placeholder,
        showOnlyWhenEditable: true,
      }),
    );
  }

  return extensions;
}

/** Schema-only extension set for server-side validation. */
export function richTextSchemaExtensions(): Extensions {
  return richTextExtensions({ withPlaceholder: false });
}
