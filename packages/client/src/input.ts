// Keyboard + mouse (pointer lock) and touch controls (virtual joystick, drag-to-look, buttons).
export class Input {
  moveX = 0;
  moveZ = 0;
  lookDX = 0;
  lookDY = 0;
  sprint = false;
  crouch = false;
  interactHeld = false;
  talkHeld = false;
  enabled = false;
  readonly touch: boolean;
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private joy = { id: -1, cx: 0, cy: 0, x: 0, y: 0 };
  private look = { id: -1, x: 0, y: 0 };
  private touchRoot: HTMLElement | null = null;
  private knob: HTMLElement | null = null;
  private crouchToggle = false;
  /** whether the current pointer lock delivers raw, unaccelerated mouse counts */
  private rawActive = false;
  /** running average of recent per-event motion, used to spot bogus jumps on non-raw locks */
  private typical = 0;
  private skipNext = false;
  /**
   * Set by the game every frame: true while the player is in the 3D view with no window open, i.e. whenever the
   * mouse ought to be captured. Drives automatic re-capture and the "click to capture" hint.
   */
  wantLock = false;
  /** called when the browser drops the lock on its own (Esc, alt-tab, focus loss), not when we release it */
  onLockLost: (() => void) | null = null;
  /** a lock request is in flight */
  private pending = 0;
  /** we asked for the coming unlock ourselves, so it must not count as the player leaving */
  private expectUnlock = false;
  /** when the browser last dropped the lock on its own */
  private lostAt = -1e9;
  /** the most recent user gesture (click or key) and the last gesture a lock request was spent on */
  private gesture = { id: 0, t: -1e9 };
  private usedGesture = -1;
  /** request raw (unaccelerated) mouse input on the next lock; saved. Off unless the player opts in. */
  rawInput = (() => { try { return localStorage.getItem('webmaze.raw') === '1'; } catch { return false; } })();

  constructor(private canvas: HTMLCanvasElement, private overlayRoot: HTMLElement) {
    this.touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    addEventListener('keydown', (e) => this.onKey(e, true));
    addEventListener('keyup', (e) => this.onKey(e, false));
    addEventListener('blur', () => { this.keys.clear(); this.lookDX = 0; this.lookDY = 0; this.interactHeld = false; this.talkHeld = false; });
    addEventListener('mousemove', (e) => this.onMouseMove(e));
    // Remember user gestures in the capture phase, so handlers that stop propagation (the chat box) can't hide them.
    // Browsers only grant pointer lock shortly after one; Escape never counts as one.
    addEventListener('keydown', (e) => { if (!e.repeat && e.code !== 'Escape') this.noteGesture(); }, true);
    addEventListener('pointerdown', () => this.noteGesture(), true);
    document.addEventListener('pointerlockchange', () => this.onLockChange());
    document.addEventListener('pointerlockerror', () => { this.pending = 0; });
    canvas.addEventListener('mousedown', () => {
      if (this.enabled && this.wantLock && !this.touch && !this.locked) this.lockPointer();
    });
    if (this.touch) this.buildTouch();
  }

  get locked(): boolean {
    return this.touch || document.pointerLockElement === this.canvas;
  }

  setRawInput(on: boolean): void {
    this.rawInput = on;
    try { localStorage.setItem('webmaze.raw', on ? '1' : '0'); } catch { /* ignore */ }
  }

  private noteGesture(): void {
    this.gesture.id++;
    this.gesture.t = performance.now();
  }

  private onLockChange(): void {
    this.lookDX = 0; this.lookDY = 0; this.typical = 0;
    this.pending = 0;
    if (document.pointerLockElement === this.canvas) {
      // the first event after locking can carry the jump from the old cursor position to the lock point
      this.skipNext = true;
      // a window opened while the request was in flight: give the cursor straight back
      if (!this.wantLock) this.releasePointer();
      return;
    }
    this.rawActive = false;
    const expected = this.expectUnlock;
    this.expectUnlock = false;
    if (!expected && !document.pointerLockElement) {
      this.lostAt = performance.now();
      this.onLockLost?.();
    }
  }

  /**
   * Called once per frame after the game has set `wantLock`. If the mouse should be captured but isn't, and the
   * player clicked or pressed a key moments ago (closing a window, clicking Resume, sending a chat line), capture it
   * again without making them click the view a second time. Each gesture is spent on at most one request, so a
   * refused request (e.g. Chrome's cool-down right after the player pressed Esc) is not retried in a loop; the HUD
   * hint then asks for a click.
   */
  maintainLock(): void {
    if (this.pending && performance.now() - this.pending > 2000) this.pending = 0; // request that never settled
    if (this.touch || !this.enabled || !this.wantLock || this.locked || this.pending) return;
    if (this.gesture.id !== this.usedGesture && performance.now() - this.gesture.t < 3000) this.lockPointer();
  }

  /** true when the mouse should be captured, isn't, and a click is needed */
  get needsClick(): boolean {
    return !this.touch && this.enabled && this.wantLock && !this.locked && !this.pending;
  }

  /**
   * Every movement event is applied exactly as reported: no per-frame clamp, no smoothing. Clamping or dropping
   * ordinary motion loses more in one direction than the other, which makes the view drift away from where the
   * hand put it. The only events dropped are the jump some browsers report right after locking, and (on plain
   * locks, which some browsers emulate by warping a hidden cursor) an isolated spike far above recent motion.
   */
  private onMouseMove(e: MouseEvent): void {
    if (document.pointerLockElement !== this.canvas || !this.enabled) return;
    const dx = e.movementX, dy = e.movementY;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    if (this.skipNext) { this.skipNext = false; if (Math.abs(dx) + Math.abs(dy) > 40) return; }
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    if (!this.rawActive && m > 200 && m > this.typical * 10 + 80) return; // isolated spike, not a real flick
    this.typical += (m - this.typical) * 0.25;
    this.lookDX += dx; this.lookDY += dy;
  }

  /**
   * Plain pointer lock by default, so turn speed follows the desktop pointer speed. Raw input (`unadjustedMovement`)
   * is opt-in from the pause menu: it skips OS acceleration but reports sensor counts, so turn speed then scales
   * with mouse DPI. Falls back to plain lock where raw input is not supported.
   */
  private lockPointer(): void {
    this.usedGesture = this.gesture.id;
    const c = this.canvas as HTMLCanvasElement & { requestPointerLock(o?: { unadjustedMovement?: boolean }): Promise<void> | void };
    const settle = (r: Promise<void> | void, onRefused?: (err: unknown) => void): void => {
      if (r && typeof r.then === 'function') r.then(() => { /* pointerlockchange does the rest */ }, (err: unknown) => { this.pending = 0; onRefused?.(err); });
    };
    const plain = (): void => {
      this.rawActive = false;
      this.pending = performance.now();
      try { settle(c.requestPointerLock()); } catch { this.pending = 0; }
    };
    if (!this.rawInput) { plain(); return; }
    this.pending = performance.now();
    try {
      const r = c.requestPointerLock({ unadjustedMovement: true });
      this.rawActive = !!r && typeof r.then === 'function'; // a browser that ignores the option returns nothing
      settle(r, (err) => { this.rawActive = false; if ((err as { name?: string })?.name === 'NotSupportedError') plain(); });
    } catch { plain(); }
  }

  releasePointer(): void {
    if (document.pointerLockElement) { this.expectUnlock = true; document.exitPointerLock(); }
  }

  consume(name: string): boolean {
    return this.pressed.delete(name);
  }

  clearPressed(): void {
    this.pressed.clear();
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const k = e.code;
    if (down && !e.repeat) {
      const map: Record<string, string> = {
        KeyF: 'flash', KeyQ: 'webcam', KeyR: 'scan', KeyM: 'map', Tab: 'book', KeyB: 'shop', Digit1: 'use0', Digit2: 'use1', Digit3: 'use2',
        Digit4: 'use3', KeyZ: 'rewind', KeyG: 'ping', Enter: 'chat', Escape: 'esc', KeyE: 'interact', Space: 'advance', KeyH: 'help', BracketLeft: 'sensDown', BracketRight: 'sensUp',
      };
      const n = map[k];
      // Esc while captured is the browser's own "release mouse" key: the lock-lost handler opens the pause menu, so
      // the key itself must not also toggle it (browsers differ on whether, and in which order, it reaches the page)
      const escUsedByBrowser = n === 'esc' && (document.pointerLockElement === this.canvas || performance.now() - this.lostAt < 500);
      if (n && !escUsedByBrowser) this.pressed.add(n);
    }
    if (k === 'Tab' || k === 'Space') { if (this.enabled) e.preventDefault(); }
    if (down) this.keys.add(k); else this.keys.delete(k);
    if (k === 'KeyE') this.interactHeld = down;
    if (k === 'KeyV') this.talkHeld = down;
    this.sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    this.crouch = this.keys.has('KeyC') || this.keys.has('ControlLeft') || this.crouchToggle;
  }

  /** Called once per frame. */
  poll(): void {
    if (this.touch) {
      this.moveX = this.joy.x; this.moveZ = -this.joy.y;
      return;
    }
    const k = this.keys;
    this.moveX = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    this.moveZ = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const l = Math.hypot(this.moveX, this.moveZ);
    if (l > 1) { this.moveX /= l; this.moveZ /= l; }
  }

  takeLook(): [number, number] {
    const r: [number, number] = [this.lookDX, this.lookDY];
    this.lookDX = 0; this.lookDY = 0;
    return r;
  }

  // ------------------------------------------------------------------ touch

  setTouchVisible(v: boolean): void {
    if (this.touchRoot) this.touchRoot.style.display = v ? 'block' : 'none';
  }

  private buildTouch(): void {
    const root = (this.touchRoot = document.createElement('div'));
    root.id = 'touch';
    root.innerHTML = `
      <div id="joy"><div id="knob"></div></div>
      <div id="tbtns"></div>`;
    this.overlayRoot.appendChild(root);
    root.style.display = 'none';
    this.knob = root.querySelector('#knob');
    const btns = root.querySelector('#tbtns') as HTMLElement;
    const defs: [string, string, string][] = [
      ['E', 'interact', 'hold'], ['💡', 'flash', ''], ['📹', 'webcam', ''], ['📡', 'scan', ''], ['🗺', 'map', ''], ['📖', 'book', ''],
      ['⬇', 'crouch', 'toggle'], ['🛒', 'shop', ''], ['1', 'use0', ''], ['2', 'use1', ''], ['3', 'use2', ''], ['4', 'use3', ''], ['🎤', 'talk', 'hold'], ['📍', 'ping', ''],
    ];
    for (const [label, name, mode] of defs) {
      const b = document.createElement('button');
      b.textContent = label; b.className = 'tb'; b.dataset.n = name;
      const down = (e: Event): void => {
        e.preventDefault(); e.stopPropagation();
        if (mode === 'hold') { if (name === 'interact') { this.interactHeld = true; this.pressed.add('interact'); } else this.talkHeld = true; }
        else if (mode === 'toggle') { this.crouchToggle = !this.crouchToggle; this.crouch = this.crouchToggle; b.classList.toggle('on', this.crouchToggle); }
        else this.pressed.add(name);
      };
      const up = (e: Event): void => {
        e.preventDefault();
        if (mode === 'hold') { if (name === 'interact') this.interactHeld = false; else this.talkHeld = false; }
      };
      b.addEventListener('touchstart', down, { passive: false });
      b.addEventListener('touchend', up, { passive: false });
      b.addEventListener('touchcancel', up, { passive: false });
      btns.appendChild(b);
    }
    const joy = root.querySelector('#joy') as HTMLElement;
    const onJoy = (e: TouchEvent): void => {
      for (const t of Array.from(e.changedTouches)) {
        if (e.type === 'touchstart' && this.joy.id < 0) {
          const r = joy.getBoundingClientRect();
          this.joy.id = t.identifier; this.joy.cx = r.left + r.width / 2; this.joy.cy = r.top + r.height / 2;
        }
        if (t.identifier !== this.joy.id) continue;
        if (e.type === 'touchend' || e.type === 'touchcancel') { this.joy.id = -1; this.joy.x = 0; this.joy.y = 0; this.sprint = false; if (this.knob) this.knob.style.transform = 'translate(-50%,-50%)'; continue; }
        let dx = (t.clientX - this.joy.cx) / 55, dy = (t.clientY - this.joy.cy) / 55;
        const l = Math.hypot(dx, dy);
        if (l > 1) { dx /= l; dy /= l; }
        this.joy.x = dx; this.joy.y = dy;
        this.sprint = l > 1.15;
        if (this.knob) this.knob.style.transform = `translate(calc(-50% + ${dx * 40}px), calc(-50% + ${dy * 40}px))`;
      }
      e.preventDefault();
    };
    for (const n of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) joy.addEventListener(n, onJoy as EventListener, { passive: false });

    // drag anywhere else on the canvas to look
    const area = this.canvas;
    area.addEventListener('touchstart', (e) => {
      for (const t of Array.from(e.changedTouches)) if (this.look.id < 0 && t.clientX > innerWidth * 0.3) { this.look.id = t.identifier; this.look.x = t.clientX; this.look.y = t.clientY; }
    }, { passive: true });
    area.addEventListener('touchmove', (e) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier !== this.look.id) continue;
        this.lookDX += (t.clientX - this.look.x) * 1.6; this.lookDY += (t.clientY - this.look.y) * 1.6;
        this.look.x = t.clientX; this.look.y = t.clientY;
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e: TouchEvent): void => { for (const t of Array.from(e.changedTouches)) if (t.identifier === this.look.id) this.look.id = -1; };
    area.addEventListener('touchend', end); area.addEventListener('touchcancel', end);
  }
}
