interface GoogleIdentity {
  initialize(options: {
    client_id: string;
    nonce: string;
    callback: (response: { credential: string }) => void;
    auto_select: boolean;
  }): void;
  renderButton(
    parent: HTMLElement,
    options: { type: "standard"; theme: "outline"; text: "continue_with" },
  ): void;
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdentity } };
  }
}
let loading: Promise<GoogleIdentity> | undefined;
export function loadGoogleIdentity() {
  if (!loading)
    loading = new Promise<GoogleIdentity>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      const fail = () => {
        script.remove();
        loading = undefined;
        reject(
          Error(
            "Couldn’t load Google sign-in. Reopen Player account to retry.",
          ),
        );
      };
      script.onload = () =>
        window.google?.accounts.id
          ? resolve(window.google.accounts.id)
          : fail();
      script.onerror = fail;
      document.head.append(script);
    });
  return loading;
}
