export function sessionName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[<>\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 16)
    .trimEnd();
}
