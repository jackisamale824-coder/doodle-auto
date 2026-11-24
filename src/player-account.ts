import type { Profile, Totals } from "../server/player-store.ts";
import { loadGoogleIdentity } from "./google-sign-in.ts";
const element = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const time = (seconds: number) =>
  seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`;
const count = (n: number, singular: string, plural = singular + "s") =>
  `${n} ${n === 1 ? singular : plural}`;
const totals = (s: Totals) =>
  `${count(s.sessions, "session")} · ${count(s.kills, "kill")} · ${count(s.deaths, "death")} · ${time(s.seconds)} played`;

export function bindPlayerAccount() {
  const dialog = element<HTMLDialogElement>("player-dialog"),
    form = element<HTMLFormElement>("player-form"),
    password = element<HTMLInputElement>("player-password"),
    status = element("player-status"),
    menu = element("player-account"),
    submit = element<HTMLButtonElement>("player-submit"),
    toggle = element<HTMLButtonElement>("player-switch"),
    logout = element<HTMLButtonElement>("player-logout");
  let register = false,
    busy = false;
  let generation = 0;
  const link = element<HTMLButtonElement>("google-link");
  async function googleButton(intent: "login" | "link", current: number) {
    const target = element(
      intent === "login" ? "google-login" : "google-link-button",
    );
    try {
      const response = await fetch("/api/player/google/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent }),
      });
      if (!response.ok)
        throw Error("Reopen Player account to start Google sign-in.");
      const { clientId, nonce } = await response.json();
      const sdk = await loadGoogleIdentity();
      if (current !== generation || !dialog.open) return;
      target.hidden = false;
      sdk.initialize({
        client_id: clientId,
        nonce,
        auto_select: false,
        callback: ({ credential }) => {
          if (current === generation && dialog.open)
            void post("google", { credential, intent });
        },
      });
      sdk.renderButton(target, {
        type: "standard",
        theme: "outline",
        text: "continue_with",
      });
    } catch (e) {
      if (current === generation && dialog.open) {
        showError(e);
        if (intent === "link") link.hidden = false;
      }
    }
  }
  function setMode(create: boolean) {
    register = create;
    element("player-title").textContent = create
      ? "Create an account"
      : "Player login";
    submit.textContent = create ? "Create account" : "Log in";
    toggle.textContent = create
      ? "Use an existing account"
      : "Create an account";
    password.autocomplete = create ? "new-password" : "current-password";
    status.textContent = create
      ? "Choose a username and a password of at least 10 characters."
      : "Log in to track your multiplayer sessions.";
  }
  async function refresh() {
    const current = ++generation;
    for (const id of ["google-login", "google-link-button"]) {
      const target = element(id);
      target.hidden = true;
      target.replaceChildren();
    }
    const response = await fetch("/api/player/profile", { cache: "no-store" });
    if (!response.ok)
      throw Error(
        "Couldn’t load your profile. Reopen Player account to retry.",
      );
    const {
      profile,
      googleEnabled,
    }: { profile: Profile | null; googleEnabled: boolean } =
      await response.json();
    if (current !== generation || !dialog.open) return;
    link.hidden = !profile || !googleEnabled || profile.googleLinked;
    element("google-linked").hidden = !profile?.googleLinked;
    form.hidden = !!profile;
    element("player-stats").hidden = !profile;
    menu.textContent = profile ? "My stats" : "Player account";
    if (!profile) {
      setMode(false);
      if (googleEnabled) void googleButton("login", current);
      return;
    }
    element("player-title").textContent = profile.name;
    element("player-rating").textContent =
      `${profile.rating} Elo · ${count(profile.wins, "ranked win")} · ${count(profile.losses, "loss", "losses")}`;
    status.textContent =
      "Elo counts completed first-to-15 Duels between two signed-in players.";
    element("player-lifetime").textContent = totals(profile.lifetime);
    element("player-global").textContent = totals(profile.global);
    const history = element("player-history");
    history.replaceChildren();
    for (const s of profile.recent) {
      const li = document.createElement("li");
      const delta =
        s.delta === null ? "" : ` · ${s.delta >= 0 ? "+" : ""}${s.delta} Elo`;
      li.textContent = `${new Date(s.started).toLocaleString()} · ${s.mode} · ${s.map} · ${s.kills} K / ${s.deaths} D · ${time(Math.floor((s.seen - s.started) / 1000))}${delta}`;
      history.append(li);
    }
    if (!history.children.length)
      history.textContent = "Your first online session will appear here.";
  }
  function showError(e: unknown) {
    status.textContent =
      e instanceof Error ? e.message : "Connection failed. Try again.";
  }
  async function post(action: string, data: object = {}) {
    if (busy) return;
    busy = true;
    submit.disabled = toggle.disabled = logout.disabled = true;
    try {
      const response = await fetch("/api/player/" + action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok)
        throw Error((await response.json()).error || "Please try again.");
      password.value = "";
      await refresh();
    } catch (e) {
      showError(e);
    } finally {
      busy = false;
      submit.disabled = toggle.disabled = logout.disabled = false;
    }
  }
  menu.onclick = () => {
    form.hidden = element("player-stats").hidden = true;
    status.textContent = "Loading profile…";
    dialog.showModal();
    void refresh().catch(showError);
  };
  element("player-close").onclick = () => dialog.close();
  dialog.addEventListener("close", () => {
    generation++;
    password.value = "";
  });
  link.onclick = () => {
    link.hidden = true;
    void googleButton("link", generation);
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    void post(register ? "register" : "login", {
      name: element<HTMLInputElement>("player-name").value,
      password: password.value,
    });
  };
  toggle.onclick = () => setMode(!register);
  logout.onclick = () => void post("logout");
}
