import { loadCredentials } from "./storage/store";
import { renderSignIn } from "./ui/sign-in";
import { renderLibrary } from "./ui/library";

const root: HTMLElement = (() => {
  const el = document.querySelector<HTMLElement>("#app");
  if (!el) throw new Error("Missing #app root element.");
  return el;
})();

function boot(): void {
  if (loadCredentials()) {
    renderLibrary(root, signOut);
  } else {
    renderSignIn(root, signedIn);
  }
}

function signOut(): void {
  boot();
}

function signedIn(): void {
  boot();
}

boot();
