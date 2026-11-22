declare const __RELEASE_ID__: string;
export const RELEASE_ID =
  typeof __RELEASE_ID__ === "string" ? __RELEASE_ID__ : "dev";
export const PROTOCOL_VERSION = 1;
export function assetUrl(relative: string): string {
  return `${RELEASE_ID === "dev" ? "/" : `/releases/${RELEASE_ID}/`}${relative.replace(/^\/+/, "")}`;
}
