import type { Profile, Totals } from "../server/player-store.ts";
const element = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const time = (seconds: number) =>
  seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`;
const totals = (s: Totals) =>
  `${s.sessions} sessions · ${s.kills} kills · ${s.deaths} deaths · ${time(s.seconds)} played`;

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
    const response = await fetch("/api/player/profile", { cache: "no-store" });
    if (!response.ok)
      throw Error(
        "Couldn’t load your profile. Reopen Player account to retry.",
      );
    const { profile }: { profile: Profile | null } = await response.json();
    form.hidden = !!profile;
    element("player-stats").hidden = !profile;
    menu.textContent = profile ? "My stats" : "Player account";
    if (!profile) {
      setMode(false);
      return;
    }
    element("player-title").textContent = profile.name;
    element("player-rating").textContent =
      `${profile.rating} Elo · ${profile.wins} ranked wins · ${profile.losses} losses`;
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
    password.value = "";
  });
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
