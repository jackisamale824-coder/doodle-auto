const search = document.querySelector("#search");
const buttons = document.querySelectorAll("[data-filter]");
const cards = document.querySelectorAll(".card");
let category = "all";

function filterGames() {
  const term = search.value.trim().toLowerCase();
  let visible = 0;
  for (const card of cards) {
    const matches = category === "all" || category === card.dataset.category;
    card.hidden = !matches || !card.textContent.toLowerCase().includes(term);
    if (!card.hidden) visible++;
  }
  document.querySelector("#count").textContent = visible + (visible === 1 ? " game" : " games");
  document.querySelector(".empty").hidden = visible > 0;
  for (const button of buttons) button.setAttribute("aria-pressed", String(button.dataset.filter === category));
}
document.querySelector(".search").hidden = false;
document.querySelector(".filters").hidden = false;
search.addEventListener("input", filterGames);
for (const button of buttons) button.addEventListener("click", () => {
  category = button.dataset.filter;
  filterGames();
});
document.querySelector("#clear").addEventListener("click", () => {
  category = "all";
  search.value = "";
  filterGames();
  search.focus();
});
filterGames();
