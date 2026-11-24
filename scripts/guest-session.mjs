export async function enterGuest(page, name = "Playtester") {
  await page.getByLabel("Guest nickname").fill(name, { timeout: 90000 });
  await page.getByRole("button", { name: "Play as guest" }).click();
}
