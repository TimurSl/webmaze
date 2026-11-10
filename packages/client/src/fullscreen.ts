// Fullscreen helper. Standard API plus the WebKit-prefixed one (older iPadOS); iPhone Safari has neither.
type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitFullscreenEnabled?: boolean; webkitExitFullscreen?: () => Promise<void> | void };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

/** launched from the home screen, so the browser chrome is already gone */
export function isStandalone(): boolean {
  return matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function fullscreenSupported(): boolean {
  const d = document as FsDoc;
  return !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
}

export function isFullscreen(): boolean {
  const d = document as FsDoc;
  return !!(d.fullscreenElement || d.webkitFullscreenElement);
}

/** Toggle fullscreen. Must be called from a user gesture. Resolves false when the browser refused or has no support. */
export async function toggleFullscreen(): Promise<boolean> {
  const d = document as FsDoc;
  try {
    if (isFullscreen()) {
      try { screen.orientation?.unlock?.(); } catch { /* ignore */ }
      if (d.exitFullscreen) await d.exitFullscreen(); else await d.webkitExitFullscreen?.();
      return true;
    }
    const el = document.documentElement as FsEl;
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    else return false;
    // the game is played in landscape; only Android browsers allow the lock, and only in fullscreen
    try { await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'); } catch { /* ignore */ }
    return true;
  } catch {
    return false;
  }
}

export function onFullscreenChange(cb: () => void): void {
  document.addEventListener('fullscreenchange', cb);
  document.addEventListener('webkitfullscreenchange', cb);
}
