import { isImeComposing } from "./ime-keyboard";
import type { MentionNodeAttrs } from "@tiptap/extension-mention";
import type { SuggestionKeyDownProps, SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";
import type { MentionUser } from "./rich-text-types";

type MentionSuggestion = Omit<SuggestionOptions<MentionUser, MentionNodeAttrs>, "editor">;

/**
 * Lightweight mention popup. Tiptap's suggestion plugin owns positioning and
 * lifecycle (`props.mount`), so no tippy/React portal dependency is needed.
 */
export function createMentionSuggestion(getUsers: () => MentionUser[]): MentionSuggestion {
  return {
    char: "@",
    allowSpaces: false,
    placement: "bottom-start",
    offset: { mainAxis: 4, crossAxis: 0 },
    floatingUi: { strategy: "fixed" },
    items: ({ query }) => {
      const needle = query.trim().toLowerCase();
      return getUsers()
        .filter((user) => (needle === "" ? true : user.name.toLowerCase().includes(needle)))
        .slice(0, 8);
    },
    render: () => {
      let element: HTMLDivElement | null = null;
      let unmount: (() => void) | null = null;
      let props: SuggestionProps<MentionUser, MentionNodeAttrs> | null = null;
      let selected = 0;

      const draw = () => {
        if (!element || !props) return;
        element.replaceChildren();
        if (props.items.length === 0) {
          element.style.display = "none";
          return;
        }
        element.style.display = "block";
        selected = Math.max(0, Math.min(selected, props.items.length - 1));
        props.items.forEach((user, index) => {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = user.name;
          button.style.display = "block";
          button.style.width = "100%";
          button.style.border = "0";
          button.style.borderRadius = "6px";
          button.style.background = index === selected ? "#eef4ff" : "transparent";
          button.style.color = index === selected ? "#1d4f91" : "#333";
          button.style.fontSize = "12px";
          button.style.lineHeight = "20px";
          button.style.padding = "5px 8px";
          button.style.textAlign = "left";
          button.style.cursor = "pointer";
          let handled = false;
          const activate = (event: Event) => {
            event.preventDefault();
            if (handled) return;
            handled = true;
            props?.command({ id: String(user.id), label: user.name });
          };
          button.addEventListener("pointerdown", activate);
          button.addEventListener("mousedown", activate);
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
          element.setAttribute("data-atlas-mention-menu", "");
          element.style.position = "fixed";
          element.style.zIndex = "260";
          element.style.minWidth = "190px";
          element.style.maxWidth = "280px";
          element.style.maxHeight = "240px";
          element.style.overflowY = "auto";
          element.style.padding = "4px";
          element.style.border = "1px solid #e5e5e5";
          element.style.borderRadius = "8px";
          element.style.background = "#fff";
          element.style.boxShadow = "0 8px 24px rgba(0,0,0,0.14)";
          unmount = nextProps.mount(element);
          draw();
        },
        onUpdate(nextProps) {
          props = nextProps;
          draw();
        },
        onKeyDown({ event }: SuggestionKeyDownProps) {
          if (isImeComposing(event)) return false;
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
            const user = props.items[selected];
            if (user) {
              event.preventDefault();
              props.command({ id: String(user.id), label: user.name });
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
  };
}
