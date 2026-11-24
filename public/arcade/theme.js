(() => {
  const key = "sully6.arcade.theme";
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  let preference;
  let control;
  try { preference = localStorage.getItem(key); } catch { /* Storage is optional. */ }

  function applyTheme() {
    const dark = preference === "dark" || (preference !== "light" && system.matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.querySelector('meta[name="theme-color"]').content = dark ? "#181628" : "#201e43";
    control?.setAttribute("aria-checked", String(dark));
  }

  applyTheme();
  system.addEventListener("change", applyTheme);
  window.addEventListener("storage", event => {
    if (event.key === key || event.key === null) {
      preference = event.newValue;
      applyTheme();
    }
  });
  document.addEventListener("DOMContentLoaded", () => {
    control = document.querySelector(".theme-switch");
    control.addEventListener("click", () => {
      preference = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      applyTheme();
      try { localStorage.setItem(key, preference); } catch { /* Keep this tab's choice. */ }
    });
    applyTheme();
    control.hidden = false;
  });
})();
