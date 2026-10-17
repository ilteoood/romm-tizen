type FocusList = {
  items: () => HTMLElement[];
  onSelect: (item: HTMLElement) => void;
  onBack: () => void;
};

let activeList: FocusList | null = null;
let cleanup: (() => void) | null = null;

const NAVIGATION_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Enter",
  "Backspace",
  "Escape",
  "GoBack",
]);

function isFormField(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

function currentIndex(items: HTMLElement[]): number {
  const active = document.activeElement;
  if (active instanceof HTMLElement) {
    const index = items.indexOf(active);
    if (index >= 0) return index;
  }
  return -1;
}

function focusInitial(items: HTMLElement[]): void {
  if (items.length === 0) return;
  const autofocus = items.find((el) => el.hasAttribute("data-autofocus")) ?? items[0];
  autofocus?.focus();
}

function moveSpatial(items: HTMLElement[], current: HTMLElement, dx: number, dy: number): HTMLElement | null {
  const rect = current.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const item of items) {
    if (item === current || item.hidden) continue;
    const r = item.getBoundingClientRect();
    const ix = r.left + r.width / 2;
    const iy = r.top + r.height / 2;
    if (dx > 0 && ix <= cx) continue;
    if (dx < 0 && ix >= cx) continue;
    if (dy > 0 && iy <= cy) continue;
    if (dy < 0 && iy >= cy) continue;
    const alignX = dy !== 0 ? Math.abs(ix - cx) : 0;
    const alignY = dx !== 0 ? Math.abs(iy - cy) : 0;
    const dist = Math.hypot(ix - cx, iy - cy);
    const score = dist + alignX * 2 + alignY * 2;
    if (score < bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return best;
}

function handleKey(list: FocusList, event: KeyboardEvent): void {
  if (isFormField(event.target)) return;
  if (!NAVIGATION_KEYS.has(event.key)) return;
  const items = list.items();
  if (items.length === 0) return;
  switch (event.key) {
    case "ArrowUp": {
      const next = moveSpatial(items, event.target as HTMLElement, 0, -1) ?? items[currentIndex(items)] ?? null;
      const fallback = next ?? items[(currentIndex(items) + items.length - 1) % items.length];
      fallback?.focus();
      event.preventDefault();
      break;
    }
    case "ArrowDown": {
      const next = moveSpatial(items, event.target as HTMLElement, 0, +1) ?? items[currentIndex(items)] ?? null;
      const fallback = next ?? items[(currentIndex(items) + 1) % items.length];
      fallback?.focus();
      event.preventDefault();
      break;
    }
    case "ArrowLeft": {
      const next = moveSpatial(items, event.target as HTMLElement, -1, 0) ?? items[currentIndex(items)] ?? null;
      const fallback = next ?? items[(currentIndex(items) + items.length - 1) % items.length];
      fallback?.focus();
      event.preventDefault();
      break;
    }
    case "ArrowRight": {
      const next = moveSpatial(items, event.target as HTMLElement, +1, 0) ?? items[currentIndex(items)] ?? null;
      const fallback = next ?? items[(currentIndex(items) + 1) % items.length];
      fallback?.focus();
      event.preventDefault();
      break;
    }
    case "Enter": {
      const itemsAtKey = list.items();
      const current = itemsAtKey[currentIndex(itemsAtKey)];
      if (current) list.onSelect(current);
      event.preventDefault();
      break;
    }
    case "Backspace":
    case "Escape":
    case "GoBack":
      list.onBack();
      event.preventDefault();
      break;
  }
}

export function activateFocusList(list: FocusList): () => void {
  cleanup?.();
  activeList = list;
  focusInitial(list.items());
  const handler = (event: KeyboardEvent): void => {
    if (activeList) handleKey(activeList, event);
  };
  document.addEventListener("keydown", handler);
  cleanup = (): void => {
    document.removeEventListener("keydown", handler);
    if (activeList === list) activeList = null;
  };
  return cleanup;
}

export function deactivateFocusList(): void {
  cleanup?.();
  cleanup = null;
  activeList = null;
}
