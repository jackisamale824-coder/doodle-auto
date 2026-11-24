// The public game hostname stays in the browser. The release on the apex
// owns the catalog, clients and same-origin HTTP/WebSocket routing.
export default {
  fetch(request) {
    const url = new URL(request.url);
    const match = /^([a-z0-9-]+)\.sully6\.com$/.exec(url.hostname);
    if (!match) return new Response("Unknown game host", { status: 404 });
    url.hostname = "sully6.com";
    url.pathname = "/play/" + match[1] + url.pathname;
    return fetch(new Request(url, request), { redirect: "manual" });
  },
};
