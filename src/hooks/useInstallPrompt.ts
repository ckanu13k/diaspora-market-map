// "Install the app" support: Chrome/Edge/Android fire beforeinstallprompt; iOS Safari needs instructions.
import { useEffect, useState } from 'react';

interface BIPEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
const DISMISS_KEY = 'dmm.install.dismissed';

export function useInstallPrompt() {
  const [evt, setEvt] = useState<BIPEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => { try { return !!localStorage.getItem(DISMISS_KEY); } catch { return false; } });
  const standalone = typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
  const ios = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setEvt(e as BIPEvent); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const dismiss = () => { setDismissed(true); try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ } };
  const install = async () => {
    if (!evt) return;
    await evt.prompt();
    await evt.userChoice;
    setEvt(null);
  };

  const show = !standalone && !dismissed && (!!evt || ios);
  return { show, canPrompt: !!evt, ios, install, dismiss };
}
