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

  constructor(private canvas: HTMLCanvasElement, private overlayRoot: HTMLElement) {
    this.touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    addEventListener('keydown', (e) => this.onKey(e, true));
    addEventListener('keyup', (e) => this.onKey(e, false));
    addEventListener('blur', () => { this.keys.clear(); this.interactHeld = false; this.talkHeld = false; });
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === this.canvas && this.enabled) { this.lookDX += e.movementX; this.lookDY += e.movementY; }
    });
    canvas.addEventListener('mousedown', () => {
      if (this.enabled && !this.touch && document.pointerLockElement !== canvas) void canvas.requestPointerLock?.();
    });
    if (this.touch) this.buildTouch();
  }

  get locked(): boolean {
    return this.touch || document.pointerLockElement === this.canvas;
  }

  releasePointer(): void {
    if (document.pointerLockElement) document.exitPointerLock();
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
        Digit4: 'use3', KeyZ: 'rewind', KeyG: 'ping', Enter: 'chat', Escape: 'esc', KeyE: 'interact', Space: 'advance', KeyH: 'help',
      };
      const n = map[k];
      if (n) this.pressed.add(n);
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
