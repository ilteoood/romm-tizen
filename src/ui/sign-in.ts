import { isValidToken, normalizeBaseUrl, saveCredentials } from "../storage/store";
import { RomMClient } from "../api/romm";
import { activateFocusList } from "./focus";

export function renderSignIn(root: HTMLElement, onSuccess: () => void): void {
  root.replaceChildren();
  const screen = document.createElement("section");
  screen.className = "screen sign-in";
  screen.innerHTML = `
    <h1>Sign in to RomM</h1>
    <form class="sign-in-form" novalidate>
      <label class="field">
        <span>RomM server URL</span>
        <input name="baseUrl" type="url" inputmode="url" autocomplete="url" placeholder="http://romm.lan:8080" required data-autofocus />
      </label>
      <label class="field">
        <span>Client API token</span>
        <input name="token" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="rmm_…" required />
      </label>
      <p class="error" data-error hidden></p>
      <div class="actions">
        <button type="submit">Test connection</button>
      </div>
    </form>
  `;
  root.appendChild(screen);

  const form = screen.querySelector<HTMLFormElement>("form")!;
  const errorEl = screen.querySelector<HTMLParagraphElement>("[data-error]")!;
  const submitButton = screen.querySelector<HTMLButtonElement>("button[type=submit]")!;
  const baseUrlInput = screen.querySelector<HTMLInputElement>("input[name=baseUrl]")!;
  const tokenInput = screen.querySelector<HTMLInputElement>("input[name=token]")!;

  const focusable = (): HTMLElement[] =>
    Array.from(screen.querySelectorAll<HTMLElement>("input, button"));

  const cleanupFocus = activateFocusList({
    items: focusable,
    onSelect: (item) => {
      if (item instanceof HTMLInputElement) item.focus();
    },
    onBack: () => {},
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const baseUrl = normalizeBaseUrl(baseUrlInput.value);
    const token = tokenInput.value.trim();
    if (!baseUrl) {
      showError("Please enter a server URL.");
      baseUrlInput.focus();
      return;
    }
    if (!isValidToken(token)) {
      showError("Token should look like rmm_ followed by 64 hex characters.");
      tokenInput.focus();
      return;
    }
    submitButton.disabled = true;
    showError("");
    try {
      const client = new RomMClient({ baseUrl, token });
      await client.heartbeat();
      saveCredentials({ baseUrl, token });
      cleanupFocus();
      onSuccess();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      showError(`Connection failed: ${message}`);
      submitButton.disabled = false;
    }
  });

  function showError(message: string): void {
    if (!message) {
      errorEl.hidden = true;
      errorEl.textContent = "";
    } else {
      errorEl.hidden = false;
      errorEl.textContent = message;
    }
  }
}
