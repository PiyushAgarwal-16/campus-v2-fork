'use client';

import { useEffect, useRef } from 'react';
import { clientEnv } from '../lib/env';

/**
 * Google Identity Services sign-in button (AUTH_SYSTEM.md §3).
 * Loads the official GIS script and renders Google's button, handing the
 * returned credential (an ID token) to the parent for server-side verification.
 * No secrets are handled here — only the public client ID.
 */

interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleIdentityServices {
  accounts: {
    id: {
      initialize: (config: {
        client_id: string;
        callback: (response: GoogleCredentialResponse) => void;
      }) => void;
      renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentityServices;
  }
}

const GIS_SRC = 'https://accounts.google.com/gsi/client';

function loadGisScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      resolve();
      return;
    }
    if (window.google) {
      resolve();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load Google sign-in')));
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google sign-in'));
    document.head.appendChild(script);
  });
}

export function GoogleSignInButton({
  onCredential,
}: {
  onCredential: (credential: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void loadGisScript().then(() => {
      if (cancelled || !window.google || !containerRef.current) return;
      window.google.accounts.id.initialize({
        client_id: clientEnv.googleClientId,
        callback: (response) => onCredential(response.credential),
      });
      window.google.accounts.id.renderButton(containerRef.current, {
        theme: 'outline',
        size: 'large',
        shape: 'pill',
        text: 'continue_with',
        width: 280,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [onCredential]);

  return <div ref={containerRef} aria-label="Sign in with Google" />;
}
