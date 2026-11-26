import * as THREE from 'three';

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const TILE_W = 20; // 16 windows x 1.25 m
export const TILE_H = 24; // 16 floors x 1.5 m
const S = 1024;
const N = 16;
const C = S / N;

function cv(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, color: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 16;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildNormalCanvas(height: Float32Array, w: number, h: number, strength: number): HTMLCanvasElement {
  const [nc, nCtx] = cv(w, h);
  const img = nCtx.createImageData(w, h);
  const idx = (x: number, y: number) => ((y + h) % h) * w + ((x + w) % w);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = height[idx(x - 1, y - 1)];
      const t = height[idx(x, y - 1)];
      const tr = height[idx(x + 1, y - 1)];
      const l = height[idx(x - 1, y)];
      const r = height[idx(x + 1, y)];
      const bl = height[idx(x - 1, y + 1)];
      const b = height[idx(x, y + 1)];
      const br = height[idx(x + 1, y + 1)];

      const dx = (tr + 2 * r + br - (tl + 2 * l + bl)) * strength;
      const dy = (bl + 2 * b + br - (tl + 2 * t + tr)) * strength;
      const nz = 1.0;
      const invLen = 1.0 / Math.hypot(dx, dy, nz);

      const o = (y * w + x) * 4;
      img.data[o] = Math.round((-dx * invLen * 0.5 + 0.5) * 255);
      img.data[o + 1] = Math.round((-dy * invLen * 0.5 + 0.5) * 255);
      img.data[o + 2] = Math.round((nz * invLen * 0.5 + 0.5) * 255);
      img.data[o + 3] = 255;
    }
  }
  nCtx.putImageData(img, 0, 0);
  return nc;
}

export interface FacadeSet {
  map: THREE.Texture;
  emissive: THREE.Texture;
  rough: THREE.Texture;
  normal: THREE.Texture;
}

const WARM = ['#ffd69c', '#ffc67d', '#ffe4bd', '#ffb86e', '#ffdfb3'];
const COOL = ['#d8e9ff', '#bfe0ff', '#eef6ff'];

/**
 * Procedural PBR Environment Cubemap via PMREMGenerator so glass towers,
 * brushed steel gates, cars and wet asphalt reflect a rich twilight sky & city glow.
 */
export function createEnvironmentMap(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();
  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float y = d.y;
        vec3 zenith = vec3(0.06, 0.14, 0.28);
        vec3 mid = vec3(0.18, 0.30, 0.46);
        vec3 horizon = vec3(0.45, 0.34, 0.36);
        vec3 ground = vec3(0.05, 0.08, 0.12);

        vec3 col = y >= 0.0
          ? mix(horizon, mix(mid, zenith, smoothstep(0.15, 0.75, y)), smoothstep(0.0, 0.22, y))
          : mix(horizon * 0.45, ground, smoothstep(0.0, -0.35, y));

        // Warm sunset highlight & cool sky bounce
        float sunGlow = pow(max(dot(d, normalize(vec3(-0.6, 0.28, 0.72))), 0.0), 6.0);
        col += vec3(0.75, 0.48, 0.28) * sunGlow;

        // Subtle urban window bounce along horizon
        float cityRing = exp(-abs(y) * 9.0) * (0.5 + 0.5 * sin(d.x * 14.0 + d.z * 9.0));
        col += vec3(0.18, 0.14, 0.10) * cityRing;

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), domeMat));
  const rt = pmrem.fromScene(envScene, 0.035);
  domeMat.dispose();
  pmrem.dispose();
  return rt.texture;
}

/** style: 0 glass office, 1 residential, 2 classic brick, 3 modern panel */
export function makeFacade(style: number, seed: number): FacadeSet {
  const r = rng(seed);
  const [dc, d] = cv(S, S);
  const [ec, e] = cv(S, S);
  const [rc, g] = cv(S, S);
  const [, hCtx] = cv(S, S);
  e.fillStyle = '#000';
  e.fillRect(0, 0, S, S);
  hCtx.fillStyle = '#c8c8c8';
  hCtx.fillRect(0, 0, S, S);

  const wall = ['#17202c', '#746d66', '#5a3f33', '#9aa0a6'][style];
  d.fillStyle = wall;
  d.fillRect(0, 0, S, S);
  g.fillStyle = style === 0 ? '#555555' : '#cccccc';
  g.fillRect(0, 0, S, S);

  // Fine architectural stone/metal surface micro-variation
  for (let i = 0; i < 10000; i++) {
    d.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${0.025 + r() * 0.04})`;
    d.fillRect(r() * S, r() * S, 2 + r() * 6, 1 + r() * 3);
  }

  const litChance = [0.38, 0.32, 0.32, 0.36][style];
  const warmBias = [0.42, 0.86, 0.9, 0.58][style];

  const light = (x: number, y: number, w: number, h: number, rowBias: number) => {
    if (r() > litChance * rowBias) return;
    const col = r() < warmBias ? WARM[Math.floor(r() * WARM.length)] : COOL[Math.floor(r() * COOL.length)];
    const alpha = 0.48 + r() * 0.52;

    // Realistic interior ceiling-to-floor light gradient (room depth illusion!)
    const gr = e.createLinearGradient(x, y, x, y + h);
    gr.addColorStop(0, col);
    gr.addColorStop(0.55, col);
    gr.addColorStop(1, 'rgba(35, 24, 14, 0.35)');
    e.globalAlpha = alpha;
    e.fillStyle = gr;
    e.fillRect(x, y, w, h);

    // Subtle interior blinds / partition sill
    if (r() < 0.35) {
      e.fillStyle = 'rgba(0,0,0,0.45)';
      e.fillRect(x, y, w, h * (0.28 + r() * 0.25));
    }
    e.globalAlpha = 1;

    d.globalAlpha = 0.32;
    d.fillStyle = col;
    d.fillRect(x, y, w, h);
    d.globalAlpha = 1;
  };

  for (let row = 0; row < N; row++) {
    const rowBias = r() < 0.2 ? 1.85 : r() < 0.3 ? 0.35 : 1;
    for (let col = 0; col < N; col++) {
      const x = col * C;
      const y = row * C;
      if (style === 0) {
        d.fillStyle = '#0f1620';
        d.fillRect(x, y + C - 14, C, 14);
        const v = Math.floor(r() * 14);
        d.fillStyle = `rgb(${24 + v},${36 + v},${54 + v})`;
        d.fillRect(x + 3, y + 3, C - 6, C - 19);
        g.fillStyle = '#141414'; // Mirror-glossy glass pane for env reflections
        g.fillRect(x + 3, y + 3, C - 6, C - 19);
        hCtx.fillStyle = '#242424';
        hCtx.fillRect(x + 3, y + 3, C - 6, C - 19);
        hCtx.fillStyle = '#f0f0f0';
        hCtx.fillRect(x, y + C - 14, C, 14);
        hCtx.fillRect(x, y, 3, C);
        d.fillStyle = '#0b1017';
        d.fillRect(x, y, 3, C);
        light(x + 3, y + 3, C - 6, C - 19, rowBias);
      } else if (style === 1) {
        d.fillStyle = '#4c4741';
        d.fillRect(x, y + C - 9, C, 9);
        d.fillStyle = '#182028';
        d.fillRect(x + 14, y + 12, 36, 38);
        g.fillStyle = '#1e1e1e';
        g.fillRect(x + 14, y + 12, 36, 38);
        hCtx.fillStyle = '#282828';
        hCtx.fillRect(x + 14, y + 12, 36, 38);
        hCtx.fillStyle = '#f8f8f8';
        hCtx.fillRect(x + 12, y + 50, 40, 3);
        d.fillStyle = '#9a9288';
        d.fillRect(x + 12, y + 50, 40, 3);
        light(x + 14, y + 12, 36, 38, rowBias);
      } else if (style === 2) {
        d.fillStyle = '#a3957f';
        d.fillRect(x + 17, y + 6, 30, 5);
        d.fillRect(x + 18, y + 52, 28, 3);
        hCtx.fillStyle = '#f4f4f4';
        hCtx.fillRect(x + 17, y + 6, 30, 5);
        hCtx.fillRect(x + 18, y + 52, 28, 3);
        d.fillStyle = '#181d24';
        d.fillRect(x + 20, y + 11, 24, 41);
        g.fillStyle = '#202020';
        g.fillRect(x + 20, y + 11, 24, 41);
        hCtx.fillStyle = '#242424';
        hCtx.fillRect(x + 20, y + 11, 24, 41);
        light(x + 20, y + 11, 24, 41, rowBias);
      } else {
        d.fillStyle = '#19212c';
        d.fillRect(x, y + 14, C, 30);
        g.fillStyle = '#181818';
        g.fillRect(x, y + 14, C, 30);
        hCtx.fillStyle = '#2a2a2a';
        hCtx.fillRect(x, y + 14, C, 30);
        hCtx.fillStyle = '#ececec';
        hCtx.fillRect(x, y + 14, 4, 30);
        d.fillStyle = '#7e868d';
        d.fillRect(x, y + 14, 4, 30);
        light(x + 4, y + 14, C - 4, 30, rowBias);
      }
    }
  }
  const hRaw = hCtx.getImageData(0, 0, S, S).data;
  const hFloat = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) hFloat[i] = hRaw[i * 4] / 255;
  const nc = buildNormalCanvas(hFloat, S, S, 2.2);
  return { map: tex(dc, true), emissive: tex(ec, true), rough: tex(rc, false), normal: tex(nc, false) };
}

export function makeGlowTexture(): THREE.CanvasTexture {
  const [c, x] = cv(128, 128);
  const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr;
  x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeRoadPuddleTextures(): { map: THREE.CanvasTexture; rough: THREE.CanvasTexture } {
  const rand = rng(31337);
  const [dc, d] = cv(512, 512);
  const [rc, rCtx] = cv(512, 512);

  d.fillStyle = '#161b23';
  d.fillRect(0, 0, 512, 512);
  rCtx.fillStyle = '#8e8e8e';
  rCtx.fillRect(0, 0, 512, 512);

  // Asphalt aggregate speckle
  for (let i = 0; i < 8000; i++) {
    const shade = rand() < 0.5 ? '0,0,0' : '255,255,255';
    d.fillStyle = `rgba(${shade},${0.03 + rand() * 0.04})`;
    d.fillRect(rand() * 512, rand() * 512, 2, 2);
  }

  // Glossy wet rain puddles
  for (let i = 0; i < 42; i++) {
    const px = rand() * 512;
    const py = rand() * 512;
    const pr = 22 + rand() * 54;
    const gr = rCtx.createRadialGradient(px, py, pr * 0.15, px, py, pr);
    gr.addColorStop(0, 'rgba(22, 22, 22, 0.92)');
    gr.addColorStop(1, 'rgba(142, 142, 142, 0)');
    rCtx.fillStyle = gr;
    rCtx.beginPath();
    rCtx.ellipse(px, py, pr, pr * (0.55 + rand() * 0.4), rand() * Math.PI, 0, Math.PI * 2);
    rCtx.fill();
  }

  return { map: tex(dc, true), rough: tex(rc, false) };
}

export function makeSoilTexture(): THREE.CanvasTexture {
  const [c, x] = cv(256, 1024);
  const r = rng(77);
  const layers: [number, string][] = [
    [0, '#2c3a22'],
    [0.015, '#4a3626'],
    [0.12, '#5c4430'],
    [0.3, '#6b5a45'],
    [0.5, '#585450'],
    [0.72, '#4a4744'],
    [1, '#3a3836'],
  ];
  const gr = x.createLinearGradient(0, 0, 0, 1024);
  for (const [s, col] of layers) gr.addColorStop(s, col);
  x.fillStyle = gr;
  x.fillRect(0, 0, 256, 1024);
  for (let i = 0; i < 4000; i++) {
    x.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,240,220'},${0.05 + r() * 0.08})`;
    x.fillRect(r() * 256, r() * 1024, 2 + r() * 10, 1 + r() * 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface MaterialPBR {
  map: THREE.CanvasTexture;
  normal: THREE.CanvasTexture;
  rough: THREE.CanvasTexture;
}

export function makeConcretePBR(): MaterialPBR {
  const sz = 512;
  const r = rng(9101);
  const [dc, d] = cv(sz, sz);
  const [rc, rCtx] = cv(sz, sz);
  const hFloat = new Float32Array(sz * sz);

  d.fillStyle = '#5c6470';
  d.fillRect(0, 0, sz, sz);
  rCtx.fillStyle = '#c8c8c8';
  rCtx.fillRect(0, 0, sz, sz);

  // Subtle mineral concrete grain & weathering
  for (let i = 0; i < 14000; i++) {
    const shade = r() < 0.5 ? '0,0,0' : '255,255,255';
    const x = Math.floor(r() * sz);
    const y = Math.floor(r() * sz);
    d.fillStyle = `rgba(${shade},${0.03 + r() * 0.05})`;
    d.fillRect(x, y, 2, 2);
    rCtx.fillStyle = `rgba(${shade},${0.04 + r() * 0.06})`;
    rCtx.fillRect(x, y, 2, 2);
  }

  // Formwork panel seams & tie-rod pockets
  const step = 128;
  d.strokeStyle = 'rgba(20, 26, 34, 0.35)';
  d.lineWidth = 2;
  for (let p = 0; p <= sz; p += step) {
    d.beginPath();
    d.moveTo(p, 0);
    d.lineTo(p, sz);
    d.stroke();
    d.beginPath();
    d.moveTo(0, p);
    d.lineTo(sz, p);
    d.stroke();
  }
  for (let py = 0; py < sz; py += step) {
    for (let px = 0; px < sz; px += step) {
      for (const [ox, oy] of [
        [24, 24],
        [step - 24, 24],
        [24, step - 24],
        [step - 24, step - 24],
      ]) {
        d.fillStyle = 'rgba(25, 32, 40, 0.5)';
        d.beginPath();
        d.arc(px + ox, py + oy, 3.2, 0, Math.PI * 2);
        d.fill();
      }
    }
  }

  for (let y = 0; y < sz; y++) {
    for (let x = 0; x < sz; x++) {
      let h = 0.72 + (r() - 0.5) * 0.14;
      if (x % step < 2 || y % step < 2) h -= 0.42;
      hFloat[y * sz + x] = h;
    }
  }
  const nc = buildNormalCanvas(hFloat, sz, sz, 1.8);
  return { map: tex(dc, true), normal: tex(nc, false), rough: tex(rc, false) };
}

export function makeSteelPBR(): MaterialPBR {
  const sz = 512;
  const r = rng(4242);
  const [dc, d] = cv(sz, sz);
  const [rc, rCtx] = cv(sz, sz);
  const hFloat = new Float32Array(sz * sz);

  d.fillStyle = '#9aa6b4';
  d.fillRect(0, 0, sz, sz);
  rCtx.fillStyle = '#585858';
  rCtx.fillRect(0, 0, sz, sz);

  // Directional brushed steel grain
  for (let i = 0; i < 6000; i++) {
    const shade = r() < 0.5 ? '255,255,255' : '0,0,0';
    const x = r() * sz;
    const y = r() * sz;
    d.fillStyle = `rgba(${shade},${0.02 + r() * 0.04})`;
    d.fillRect(x, y, 10 + r() * 24, 1);
    rCtx.fillStyle = `rgba(${shade},${0.03 + r() * 0.05})`;
    rCtx.fillRect(x, y, 8 + r() * 18, 1);
  }

  // Marine plate panel seams & structural rivets
  const step = 128;
  d.strokeStyle = 'rgba(18, 25, 34, 0.48)';
  d.lineWidth = 2;
  for (let p = 0; p <= sz; p += step) {
    d.beginPath();
    d.moveTo(p, 0);
    d.lineTo(p, sz);
    d.stroke();
    d.beginPath();
    d.moveTo(0, p);
    d.lineTo(sz, p);
    d.stroke();
  }
  for (let py = 0; py < sz; py += step) {
    for (let px = 0; px < sz; px += step) {
      for (let k = 12; k <= step - 12; k += 20) {
        for (const [rx, ry] of [
          [px + k, py + 7],
          [px + k, py + step - 7],
        ]) {
          d.fillStyle = 'rgba(235, 242, 250, 0.45)';
          d.beginPath();
          d.arc(rx, ry, 2.2, 0, Math.PI * 2);
          d.fill();
        }
      }
    }
  }

  for (let y = 0; y < sz; y++) {
    for (let x = 0; x < sz; x++) {
      let h = 0.65 + (r() - 0.5) * 0.06;
      if (x % step < 2 || y % step < 2) h -= 0.45;
      else if (y % step < 9 && (x - 12) % 20 < 4) h += 0.25;
      hFloat[y * sz + x] = h;
    }
  }
  const nc = buildNormalCanvas(hFloat, sz, sz, 2.0);
  return { map: tex(dc, true), normal: tex(nc, false), rough: tex(rc, false) };
}
