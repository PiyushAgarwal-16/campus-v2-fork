'use client';

import { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { Button } from './ui/Button';

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [platform, setPlatform] = useState<'android' | 'ios' | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Check if already running in standalone mode (installed)
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;

    if (isStandalone) return;

    // Check if user dismissed it recently
    const dismissed = localStorage.getItem('anonymousu:install_dismissed') === 'true';
    if (dismissed) return;

    // Detect platform
    const ua = window.navigator.userAgent.toLowerCase();
    const isIos = /iphone|ipad|ipod/.test(ua);
    const isAndroid = /android/.test(ua);

    if (isIos) {
      setPlatform('ios');
      // Show iOS recommendation after a 3 second delay
      const timer = setTimeout(() => setIsVisible(true), 3000);
      return () => clearTimeout(timer);
    } else if (isAndroid || !isIos) {
      setPlatform('android');

      const handleBeforeInstallPrompt = (e: Event) => {
        // Prevent Chrome 67 and earlier from automatically showing the prompt
        e.preventDefault();
        // Stash the event so it can be triggered later.
        setDeferredPrompt(e);
        // Show the banner
        setIsVisible(true);
      };

      window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

      return () => {
        window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      };
    }
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    // Show the native prompt
    deferredPrompt.prompt();
    // Wait for the user to respond to the prompt
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsVisible(false);
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setIsVisible(false);
    // Don't show again for 14 days
    localStorage.setItem('anonymousu:install_dismissed', 'true');
  };

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-24 md:bottom-6 right-4 left-4 md:left-auto md:w-96 bg-card/90 dark:bg-[#121212]/95 border border-border/80 rounded-2xl shadow-xl p-4 z-[100] backdrop-blur-md animate-in slide-in-from-bottom-5 duration-300">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/10 text-brand shrink-0">
            <Download className="h-5 w-5" />
          </div>
          <div className="flex flex-col">
            <span className="text-body font-semibold text-foreground">Add to Home Screen</span>
            <span className="text-caption text-muted-foreground">
              Install AnonymousU as an app for a better experience.
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-full hover:bg-muted/40"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        {platform === 'ios' ? (
          <div className="flex items-center gap-2 text-caption text-foreground/80 bg-muted/40 px-3 py-2 rounded-xl w-full">
            <Share className="h-4 w-4 text-brand shrink-0" />
            <span>
              Tap <span className="font-semibold">Share</span> then{' '}
              <span className="font-semibold">Add to Home Screen</span>.
            </span>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={handleDismiss}
              className="px-3 py-1.5 text-caption font-medium hover:bg-muted/40 rounded-xl transition-colors text-muted-foreground"
            >
              Later
            </button>
            <Button
              type="button"
              onClick={handleInstallClick}
              size="sm"
              className="rounded-xl px-4 py-1.5 text-caption"
            >
              Install
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
