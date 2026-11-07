import { Extension, type Editor } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";

export type SlashItem = {
  title: string;
  description: string;
  keywords: string[];
  icon: string;
  run: (editor: Editor) => void;
};

const SLASH_PLUGIN_KEY = new PluginKey("atlasSlashCommand");

function items(): SlashItem[] {
  return [
    {
      title: "テキスト",
      description: "通常の段落",
      keywords: ["text", "paragraph", "本文", "段落"],
      icon: "T",
      run: (editor) => editor.chain().focus().setParagraph().run(),
    },
    {
      title: "見出し1",
      description: "大きなセクション見出し",
      keywords: ["h1", "heading", "見出し"],
      icon: "H1",
      run: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      title: "見出し2",
      description: "中くらいのセクション見出し",
      keywords: ["h2", "heading", "見出し"],
      icon: "H2",
      run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      title: "見出し3",
      description: "小さなセクション見出し",
      keywords: ["h3", "heading", "見出し"],
      icon: "H3",
      run: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      title: "箇条書き",
      description: "シンプルな箇条書きリスト",
      keywords: ["bullet", "list", "箇条書き", "リスト"],
      icon: "•",
      run: (editor) => editor.chain().focus().toggleBulletList().run(),
    },
    {
      title: "番号付きリスト",
      description: "順序のあるリスト",
      keywords: ["ordered", "numbered", "list", "番号", "リスト"],
      icon: "1.",
      run: (editor) => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      title: "チェックリスト",
      description: "完了状態を切り替えられるリスト",
      keywords: ["task", "todo", "check", "チェック", "タスク"],
      icon: "☑",
      run: (editor) => editor.chain().focus().toggleTaskList().run(),
    },
    {
      title: "引用",
      description: "引用ブロック",
      keywords: ["quote", "blockquote", "引用"],
      icon: "❝",
      run: (editor) => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      title: "コードブロック",
      description: "等幅フォントのコード領域",
      keywords: ["code", "pre", "コード"],
      icon: "{ }",
      run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      title: "区切り線",
      description: "水平の区切り線",
      keywords: ["divider", "rule", "区切り", "線"],
      icon: "—",
      run: (editor) => editor.chain().focus().setHorizontalRule().run(),
    },
  ];
}

function renderItem(item: SlashItem, selected: boolean): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.style.display = "flex";
  button.style.width = "100%";
  button.style.alignItems = "center";
  button.style.gap = "9px";
  button.style.border = "0";
  button.style.borderRadius = "7px";
  button.style.background = selected ? "#eef4ff" : "transparent";
  button.style.color = selected ? "#1d4f91" : "#333";
  button.style.padding = "7px 8px";
  button.style.textAlign = "left";
  button.style.cursor = "pointer";

  const icon = document.createElement("span");
  icon.textContent = item.icon;
  icon.style.display = "flex";
  icon.style.alignItems = "center";
  icon.style.justifyContent = "center";
  icon.style.width = "26px";
  icon.style.height = "26px";
  icon.style.flex = "0 0 26px";
  icon.style.border = "1px solid #e5e5e5";
  icon.style.borderRadius = "6px";
  icon.style.background = "#fff";
  icon.style.fontSize = "11px";
  icon.style.fontWeight = "600";
  icon.style.color = "#555";

  const copy = document.createElement("span");
  copy.style.display = "flex";
  copy.style.flexDirection = "column";
  copy.style.minWidth = "0";
  const title = document.createElement("span");
  title.textContent = item.title;
  title.style.fontSize = "12px";
  title.style.fontWeight = "600";
  title.style.lineHeight = "16px";
  const description = document.createElement("span");
  description.textContent = item.description;
  description.style.fontSize = "10px";
  description.style.lineHeight = "14px";
  description.style.color = selected ? "#416da8" : "#888";
  description.style.whiteSpace = "nowrap";
  description.style.overflow = "hidden";
  description.style.textOverflow = "ellipsis";
  copy.append(title, description);
  button.append(icon, copy);
  return button;
}

/** Slash command menu backed by Tiptap's suggestion plugin + floating mount. */
export const SlashCommand = Extension.create({
  name: "atlasSlashCommand",

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        char: "/",
        pluginKey: SLASH_PLUGIN_KEY,
        allowSpaces: false,
        startOfLine: false,
        allowedPrefixes: [" ", "\n"],
        decorationClass: "atlas-slash-command",
        floatingUi: { strategy: "fixed" },
        items: ({ query }) => {
          const needle = query.trim().toLowerCase();
          return items()
            .filter(
              (item) =>
                needle === "" ||
                item.title.toLowerCase().includes(needle) ||
                item.keywords.some((keyword) => keyword.toLowerCase().includes(needle)),
            )
            .slice(0, 10);
        },
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).run();
          props.run(editor);
        },
        render: () => {
          let element: HTMLDivElement | null = null;
          let unmount: (() => void) | null = null;
          let props: SuggestionProps<SlashItem, SlashItem> | null = null;
          let selected = 0;

          const draw = () => {
            if (!element || !props) return;
            element.replaceChildren();
            const header = document.createElement("div");
            header.textContent = "ブロック";
            header.style.padding = "4px 8px 5px";
            header.style.fontSize = "10px";
            header.style.fontWeight = "600";
            header.style.color = "#999";
            element.appendChild(header);

            if (props.items.length === 0) {
              const empty = document.createElement("div");
              empty.textContent = "該当するコマンドがありません";
              empty.style.padding = "8px";
              empty.style.fontSize = "11px";
              empty.style.color = "#999";
              element.appendChild(empty);
              return;
            }

            selected = Math.max(0, Math.min(selected, props.items.length - 1));
            props.items.forEach((item, index) => {
              const button = renderItem(item, index === selected);
              button.addEventListener("mousedown", (event) => {
                event.preventDefault();
                props?.command(item);
              });
              button.addEventListener("mouseenter", () => {
                selected = index;
                draw();
              });
              element?.appendChild(button);
            });
          };

          return {
            onStart(nextProps) {
              props = nextProps;
              selected = 0;
              element = document.createElement("div");
              element.setAttribute("data-atlas-slash-menu", "");
              element.style.position = "fixed";
              element.style.zIndex = "270";
              element.style.width = "290px";
              element.style.maxHeight = "340px";
              element.style.overflowY = "auto";
              element.style.padding = "4px";
              element.style.border = "1px solid #e5e5e5";
              element.style.borderRadius = "10px";
              element.style.background = "#fff";
              element.style.boxShadow = "0 10px 30px rgba(0,0,0,0.16)";
              unmount = nextProps.mount(element);
              draw();
            },
            onUpdate(nextProps) {
              props = nextProps;
              draw();
            },
            onKeyDown({ event }: SuggestionKeyDownProps) {
              if (!props) return false;
              if (event.key === "ArrowDown") {
                selected = Math.min(selected + 1, props.items.length - 1);
                draw();
                return true;
              }
              if (event.key === "ArrowUp") {
                selected = Math.max(selected - 1, 0);
                draw();
                return true;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                const item = props.items[selected];
                if (item) {
                  event.preventDefault();
                  props.command(item);
                  return true;
                }
              }
              if (event.key === "Escape") {
                unmount?.();
                unmount = null;
                element = null;
                return true;
              }
              return false;
            },
            onExit() {
              unmount?.();
              unmount = null;
              element = null;
              props = null;
            },
          };
        },
      }),
    ];
  },
});
