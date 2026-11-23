import { useEffect, useRef } from "react";

/** The id of the web client of Google. Without it, the page uses the button of the app and the Firebase popup. */
export const GOOGLE_CLIENT_ID: string | undefined = import.meta.env.VITE_GOOGLE_CLIENT_ID || undefined;

interface Google {
  accounts: {
    id: {
      initialize(options: { client_id: string; callback: (response: { credential: string }) => void; use_fedcm_for_prompt?: boolean }): void;
      renderButton(element: HTMLElement, options: Record<string, string | number>): void;
    };
  };
}

declare global {
  interface Window {
    google?: Google;
  }
}

let script: Promise<void> | undefined;

/** Load the script of Google Identity Services one time. */
function loadScript(): Promise<void> {
  script ??= new Promise((resolve, reject) => {
    const tag = document.createElement("script");
    tag.src = "https://accounts.google.com/gsi/client";
    tag.async = true;
    tag.onload = () => resolve();
    tag.onerror = () => {
      script = undefined;
      reject(new Error("Google script failed"));
    };
    document.head.append(tag);
  });
  return script;
}

/**
 * The button of Google itself. It shows the name and the photo of the account that is open in the browser.
 * `onCredential` gets the ID token of the account, and `onError` runs if the script does not load.
 */
export function GoogleButton({ clientId, onCredential, onError }: { clientId: string; onCredential: (idToken: string) => void; onError: () => void }) {
  const holder = useRef<HTMLDivElement>(null);
  // The callbacks can change at each render, but Google must get only the first ones.
  const callbacks = useRef({ onCredential, onError });
  callbacks.current = { onCredential, onError };

  useEffect(() => {
    let active = true;
    loadScript()
      .then(() => {
        if (!active || !holder.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => callbacks.current.onCredential(response.credential),
        });
        window.google.accounts.id.renderButton(holder.current, {
          type: "standard",
          theme: "filled_black",
          size: "large",
          shape: "pill",
          text: "continue_with",
          locale: "pt-BR",
          width: 280,
        });
      })
      .catch(() => active && callbacks.current.onError());
    return () => {
      active = false;
    };
  }, [clientId]);

  return <div ref={holder} className="google-button" />;
}
