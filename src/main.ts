import { loadCredentials } from "./storage/store";
import { renderSignIn } from "./ui/sign-in";
import { renderLibrary } from "./ui/library";
import { renderGameDetail } from "./ui/game-detail";

type Screen =
  | { kind: "sign-in" }
  | { kind: "library" }
  | { kind: "detail"; romId: number };

const root: HTMLElement = (() => {
  const el = document.querySelector<HTMLElement>("#app");
  if (!el) throw new Error("Missing #app root element.");
  return el;
})();

let stack: Screen[] = [];

function initialStack(): Screen[] {
  return loadCredentials() ? [{ kind: "library" }] : [{ kind: "sign-in" }];
}

function render(): void {
  const screen = stack[stack.length - 1] ?? { kind: "sign-in" as const };
  switch (screen.kind) {
    case "sign-in":
      renderSignIn(root, () => replace({ kind: "library" }));
      break;
    case "library":
      renderLibrary(root, () => replace({ kind: "sign-in" }), (romId) => push({ kind: "detail", romId }));
      break;
    case "detail":
      renderGameDetail(root, screen.romId, () => pop());
      break;
  }
}

function push(screen: Screen): void {
  stack = [...stack, screen];
  render();
}

function pop(): void {
  if (stack.length > 1) {
    stack = stack.slice(0, -1);
    render();
  }
}

function replace(screen: Screen): void {
  stack = [screen];
  render();
}

stack = initialStack();
render();
