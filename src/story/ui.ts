import * as THREE from 'three';
import { CHAPTERS, ChapterDef } from './chapters';
import type { DefenseControlState } from '../world/defenses';

export interface StoryCallbacks {
  onSelectChapter(idx: number): void;
  onToggleDefense(key: keyof DefenseControlState): void;
  onApplyPreset(mode: 'storm' | 'protected'): void;
  onCameraFocus(focus: 'overview' | 'barrier' | 'cutaway' | 'moon'): void;
  onToggleSound(): void;
}

export class StoryUI {
  private scroller!: HTMLElement;
  private navLinks: HTMLButtonElement[] = [];
  private sections: HTMLElement[] = [];
  private pinsLayer!: HTMLElement;
  private pinEls: { el: HTMLElement; title: HTMLElement; sub: HTMLElement }[] = [];
  private soundBtn!: HTMLButtonElement;
  private sandboxDock!: HTMLElement;
  private statusText!: HTMLElement;
  private progressBar!: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    private defenses: DefenseControlState,
    private readonly cb: StoryCallbacks
  ) {
    this.render();
    this.bind();
  }

  private render(): void {
    this.root.innerHTML = `
      <!-- Clean Editorial Header -->
      <header class="top-header">
        <div class="brand" id="btn-brand">AQUASHIELD</div>
        <nav class="chapter-nav">
          ${CHAPTERS.map(
            (c, i) => `<button class="ch-link ${i === 0 ? 'active' : ''}" data-ch="${i}">${c.nav}</button>`
          ).join('')}
        </nav>
        <button class="sound-btn" id="btn-sound" title="Audio">🔊</button>
        <div class="header-progress" id="header-progress"></div>
      </header>

      <!-- 3D World-Anchored Callout Pins -->
      <div class="pins-layer" id="pins-layer"></div>

      <!-- Scrollable Editorial Chapters -->
      <div class="story-scroller" id="story-scroller">
        ${CHAPTERS.map((c, idx) => {
          if (idx === CHAPTERS.length - 1) {
            return `
              <section class="story-sec sandbox-sec" data-ch="${idx}">
                <div class="sandbox-intro">
                  <div class="eyebrow">${c.eyebrow}</div>
                  <h2>${c.title}</h2>
                  <p>${c.body}</p>
                </div>
              </section>
            `;
          }
          const nextIdx = idx + 1;
          return `
            <section class="story-sec ${idx === 0 ? 'active' : ''}" data-ch="${idx}">
              <article class="ed-block ${c.side}">
                <div class="eyebrow">${c.eyebrow}</div>
                <h1>${c.title}</h1>
                <p>${c.body}</p>
                ${
                  c.metric
                    ? `<div class="ed-metric"><b>${c.metric.value}</b><span>${c.metric.caption}</span></div>`
                    : ''
                }
                <button class="next-link" data-ch="${nextIdx}">Next: ${CHAPTERS[nextIdx].nav} →</button>
              </article>
            </section>
          `;
        }).join('')}
      </div>

      <!-- Minimal Sandbox Bottom Controls (only shown in Chapter 7) -->
      <div class="sandbox-dock hidden" id="sandbox-dock">
        <div class="sb-status" id="sb-status">City Protected</div>
        <div class="sb-row">
          <button class="sb-btn danger" id="btn-storm-mode">Unprotected Storm</button>
          <button class="sb-btn primary" id="btn-full-def">Enable All Defenses</button>
          <span class="sb-sep"></span>
          <button class="sb-chip" data-def="stormGates">Sea Barrier</button>
          <button class="sb-chip" data-def="floodWalls">Floodwalls</button>
          <button class="sb-chip" data-def="spongeCity">Sponge Park</button>
          <button class="sb-chip" data-def="collector">Water Temple</button>
          <button class="sb-chip" data-def="cutawayOpen">Cutaway View</button>
          <span class="sb-sep"></span>
          <button class="sb-cam" data-focus="overview">Overview</button>
          <button class="sb-cam" data-focus="barrier">Barrier</button>
          <button class="sb-cam" data-focus="cutaway">Underground</button>
          <button class="sb-cam" data-focus="moon">Moon</button>
        </div>
      </div>
    `;

    this.scroller = this.root.querySelector('#story-scroller')!;
    this.navLinks = Array.from(this.root.querySelectorAll('.ch-link'));
    this.sections = Array.from(this.root.querySelectorAll('.story-sec'));
    this.pinsLayer = this.root.querySelector('#pins-layer')!;
    this.soundBtn = this.root.querySelector('#btn-sound')!;
    this.sandboxDock = this.root.querySelector('#sandbox-dock')!;
    this.statusText = this.root.querySelector('#sb-status')!;
    this.progressBar = this.root.querySelector('#header-progress')!;

    // Pre-create 4 reusable 3D pin elements
    for (let i = 0; i < 4; i++) {
      const el = document.createElement('div');
      el.className = 'world-pin hidden';
      el.innerHTML = `<span class="pin-dot"></span><span class="pin-line"></span><div class="pin-box"><strong class="pin-title"></strong><span class="pin-sub"></span></div>`;
      this.pinsLayer.appendChild(el);
      this.pinEls.push({
        el,
        title: el.querySelector('.pin-title')!,
        sub: el.querySelector('.pin-sub')!,
      });
    }
  }

  private bind(): void {
    this.root.querySelector('#btn-brand')!.addEventListener('click', () => {
      this.scrollTo(0);
      this.cb.onSelectChapter(0);
    });

    this.root.querySelectorAll<HTMLButtonElement>('[data-ch]').forEach((b) => {
      b.addEventListener('click', () => {
        const idx = Number(b.dataset.ch);
        this.scrollTo(idx);
        this.cb.onSelectChapter(idx);
      });
    });

    this.root.querySelector('#btn-sound')!.addEventListener('click', () => {
      this.cb.onToggleSound();
    });

    this.root.querySelector('#btn-storm-mode')!.addEventListener('click', () => this.cb.onApplyPreset('storm'));
    this.root.querySelector('#btn-full-def')!.addEventListener('click', () => this.cb.onApplyPreset('protected'));

    this.root.querySelectorAll<HTMLButtonElement>('[data-def]').forEach((b) => {
      b.addEventListener('click', () => {
        this.cb.onToggleDefense(b.dataset.def as keyof DefenseControlState);
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>('[data-focus]').forEach((b) => {
      b.addEventListener('click', () => {
        this.cb.onCameraFocus(b.dataset.focus as 'overview' | 'barrier' | 'cutaway' | 'moon');
      });
    });

    this.syncDefenses(this.defenses);
  }

  public getScrollProgress(): number {
    const h = this.scroller.clientHeight || window.innerHeight;
    return Math.max(0, Math.min(CHAPTERS.length - 1, this.scroller.scrollTop / h));
  }

  public setScrollProgress(fraction: number): void {
    this.progressBar.style.transform = `scaleX(${Math.max(0, Math.min(1, fraction)).toFixed(4)})`;
  }

  public scrollTo(idx: number): void {
    const h = this.scroller.clientHeight || window.innerHeight;
    this.scroller.scrollTo({ top: idx * h, behavior: 'smooth' });
  }

  public setActiveChapter(idx: number, inSandbox: boolean): void {
    this.navLinks.forEach((b, i) => b.classList.toggle('active', i === idx));
    this.sections.forEach((s, i) => s.classList.toggle('active', i === idx));
    this.scroller.classList.toggle('sandbox-mode', inSandbox);
    this.sandboxDock.classList.toggle('hidden', !inSandbox);
  }

  public syncDefenses(d: DefenseControlState): void {
    this.defenses = { ...d };
    this.root.querySelectorAll<HTMLButtonElement>('[data-def]').forEach((b) => {
      const k = b.dataset.def as keyof DefenseControlState;
      b.classList.toggle('active', Boolean(d[k]));
    });
  }

  public setStatus(flooded: boolean): void {
    this.statusText.textContent = flooded
      ? 'Streets Flooding (+4.8 m)'
      : 'City Protected from Flood';
    this.statusText.classList.toggle('danger', flooded);
  }

  public setSoundEnabled(on: boolean): void {
    this.soundBtn.textContent = on ? '🔊' : '🔇';
  }

  public updatePins(camera: THREE.Camera, chap: ChapterDef, inSandbox: boolean): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const v = new THREE.Vector3();

    for (let i = 0; i < this.pinEls.length; i++) {
      const slot = this.pinEls[i];
      if (inSandbox || i >= chap.pins.length) {
        slot.el.classList.add('hidden');
        continue;
      }
      const p = chap.pins[i];
      v.set(p.pos[0], p.pos[1], p.pos[2]).project(camera);

      // Hide if behind camera or too close to edges / text card zone
      if (v.z > 1 || v.x < -0.82 || v.x > 0.78 || v.y < -0.88 || v.y > 0.85) {
        slot.el.classList.add('hidden');
        continue;
      }

      const sx = (v.x * 0.5 + 0.5) * w;
      const sy = (-v.y * 0.5 + 0.5) * h;
      slot.el.classList.remove('hidden');
      slot.el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0)`;
      slot.title.textContent = p.label;
      slot.sub.textContent = p.detail;
    }
  }
}
