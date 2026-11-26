import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import { createEnvironmentMap } from './world/textures';
import { loadCityAssets } from './world/assets';
import { createCityWorld, CityWorld } from './world/buildings';
import { createDefenseSystems, DefenseControlState, DefenseWorld } from './world/defenses';
import { createWaterWorld } from './world/water';
import { createSkyAndMoonWorld } from './world/skyAndMoon';
import { CHAPTERS } from './story/chapters';
import { StoryUI } from './story/ui';
import { SoundEngine } from './audio/SoundEngine';

const canvas = document.getElementById('sim-canvas') as HTMLCanvasElement;
const storyRoot = document.getElementById('story-root') as HTMLElement;

// 1. Renderer, Environment Map & Maximum-Quality 4x MSAA HalfFloat HDR Composer
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.environment = createEnvironmentMap(renderer);
scene.environmentIntensity = 1.25;

const fog = new THREE.FogExp2('#16263d', 0.0024);
scene.fog = fog;

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.8, 1900);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.065;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 16;
controls.maxDistance = 420;
controls.enabled = false;

// Balanced Twilight / Golden-Dusk Lighting so real 3D models & roofs look crisp
const hemiLight = new THREE.HemisphereLight('#8cb0d9', '#1e2838', 1.15);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight('#ffe4c4', 2.2);
sunLight.position.set(-140, 125, 110);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.left = -165;
sunLight.shadow.camera.right = 165;
sunLight.shadow.camera.top = 165;
sunLight.shadow.camera.bottom = -165;
sunLight.shadow.camera.near = 20;
sunLight.shadow.camera.far = 500;
sunLight.shadow.bias = -0.00035;
sunLight.shadow.normalBias = 0.04;
scene.add(sunLight);

const msaaTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
  samples: 4,
  type: THREE.HalfFloatType,
});
const composer = new EffectComposer(renderer, msaaTarget);
composer.addPass(new RenderPass(scene, camera));

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.24,
  0.36,
  0.92
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// 2. Non-GLB Sky & Water immediately, then load GLB City & Defenses
const skyWorld = createSkyAndMoonWorld(renderer);
scene.add(skyWorld.group);

const waterWorld = createWaterWorld();
scene.add(waterWorld.group);

let cityWorld: CityWorld | null = null;
let defenseWorld: DefenseWorld | null = null;

const sound = new SoundEngine();
window.addEventListener('pointerdown', () => sound.unlock(), { once: true });
window.addEventListener('keydown', () => sound.unlock(), { once: true });

const defenses: DefenseControlState = { ...CHAPTERS[0].defenses };
let targetStorm = CHAPTERS[0].storm;
let targetSea = CHAPTERS[0].seaLevel;
let targetRiver = CHAPTERS[0].riverLevel;
let targetStreet = CHAPTERS[0].streetFlood;

let curStorm = targetStorm;
let curSea = targetSea;
let curRiver = targetRiver;
let curStreet = targetStreet;

let activeChapter = 0;
let inSandbox = false;
let sandboxStormActive = true;

let flyActive = false;
let flyT = 0;
const flyPos0 = new THREE.Vector3();
const flyTgt0 = new THREE.Vector3();
const flyPos1 = new THREE.Vector3();
const flyTgt1 = new THREE.Vector3();

let pointerX = 0;
let pointerY = 0;
window.addEventListener('pointermove', (e) => {
  pointerX = (e.clientX / window.innerWidth) * 2 - 1;
  pointerY = (e.clientY / window.innerHeight) * 2 - 1;
});

function flyCameraTo(pos: [number, number, number], target: [number, number, number]): void {
  flyPos0.copy(camera.position);
  flyTgt0.copy(controls.target);
  flyPos1.set(...pos);
  flyTgt1.set(...target);
  flyT = 0;
  flyActive = true;
}

function recomputeSandboxFlood(): void {
  if (!sandboxStormActive) {
    targetStorm = 0.08;
    targetSea = 0.45;
    targetRiver = 0.45;
    targetStreet = -2.0;
    ui.setStatus(false);
    return;
  }

  targetStorm = 0.88;
  targetSea = 4.8;
  targetRiver = defenses.stormGates ? 0.65 : 4.5;

  const riverContained = defenses.stormGates || defenses.floodWalls;
  const coastContained = defenses.floodWalls;
  const drainageMitigates = defenses.spongeCity && defenses.collector;

  if (riverContained && coastContained) {
    targetStreet = -2.0;
    ui.setStatus(false);
  } else if (drainageMitigates && defenses.stormGates) {
    targetStreet = 0.4;
    ui.setStatus(false);
  } else {
    targetStreet = 3.35;
    ui.setStatus(true);
  }
}

function applyChapterState(idx: number): void {
  const ch = CHAPTERS[idx];
  Object.assign(defenses, ch.defenses);
  ui.syncDefenses(defenses);
  if (idx < CHAPTERS.length - 1) {
    targetStorm = ch.storm;
    targetSea = ch.seaLevel;
    targetRiver = ch.riverLevel;
    targetStreet = ch.streetFlood;
  } else {
    sandboxStormActive = true;
    recomputeSandboxFlood();
  }
}

const ui = new StoryUI(storyRoot, defenses, {
  onSelectChapter: (idx) => {
    activeChapter = idx;
    applyChapterState(idx);
  },
  onToggleDefense: (key) => {
    defenses[key] = !defenses[key];
    ui.syncDefenses(defenses);
    if (inSandbox) recomputeSandboxFlood();
  },
  onApplyPreset: (mode) => {
    sandboxStormActive = true;
    if (mode === 'storm') {
      Object.assign(defenses, {
        stormGates: false,
        floodWalls: false,
        spongeCity: false,
        collector: false,
        cutawayOpen: false,
      });
    } else {
      Object.assign(defenses, {
        stormGates: true,
        floodWalls: true,
        spongeCity: true,
        collector: true,
        cutawayOpen: false,
      });
    }
    ui.syncDefenses(defenses);
    recomputeSandboxFlood();
  },
  onCameraFocus: (focus) => {
    if (focus === 'overview') flyCameraTo(CHAPTERS[6].camPos, CHAPTERS[6].camTarget);
    else if (focus === 'barrier') flyCameraTo(CHAPTERS[3].camPos, CHAPTERS[3].camTarget);
    else if (focus === 'cutaway') {
      defenses.cutawayOpen = true;
      ui.syncDefenses(defenses);
      flyCameraTo(CHAPTERS[5].camPos, CHAPTERS[5].camTarget);
    } else if (focus === 'moon') {
      flyCameraTo(CHAPTERS[0].camPos, CHAPTERS[0].camTarget);
    }
  },
  onToggleSound: () => {
    const next = !sound.enabled;
    sound.setEnabled(next);
    ui.setSoundEnabled(next);
  },
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'PageDown') {
    ui.scrollTo(Math.min(CHAPTERS.length - 1, activeChapter + 1));
  } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
    ui.scrollTo(Math.max(0, activeChapter - 1));
  }
});

camera.position.set(...CHAPTERS[0].camPos);
controls.target.set(...CHAPTERS[0].camTarget);
applyChapterState(0);

window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloomPass.setSize(w, h);
});

let smoothScroll = 0;
let lastTime = performance.now();
let simTime = 0;

function sampleStoryCamera(
  progress: number,
  tNow: number
): {
  pos: THREE.Vector3;
  tgt: THREE.Vector3;
  spaceFactor: number;
  fov: number;
} {
  const maxI = CHAPTERS.length - 1;
  const p = Math.max(0, Math.min(maxI, progress));
  const i0 = Math.min(maxI - 1, Math.floor(p));
  const i1 = i0 + 1;
  const t = p - i0;
  const ease = t * t * (3 - 2 * t);

  const p0 = new THREE.Vector3(...CHAPTERS[i0].camPos);
  const p1 = new THREE.Vector3(...CHAPTERS[i1].camPos);
  const t0 = new THREE.Vector3(...CHAPTERS[i0].camTarget);
  const t1 = new THREE.Vector3(...CHAPTERS[i1].camTarget);

  const pos = new THREE.Vector3().lerpVectors(p0, p1, ease);
  const tgt = new THREE.Vector3().lerpVectors(t0, t1, ease);

  pos.x += pointerX * 2.2 + Math.sin(tNow * 0.35) * 1.1;
  pos.y -= pointerY * 1.4 - Math.cos(tNow * 0.28) * 0.6;

  const spaceFactor = Math.max(0, Math.min(1, 1 - p * 1.35));
  const diveBoost = Math.sin(Math.min(1, p) * Math.PI) * 8.5;
  const fov = THREE.MathUtils.lerp(45, 42, spaceFactor) + diveBoost;

  return { pos, tgt, spaceFactor, fov };
}

function animate(now: number): void {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  simTime += dt;

  const targetScroll = ui.getScrollProgress();
  smoothScroll = THREE.MathUtils.lerp(smoothScroll, targetScroll, Math.min(1, dt * 6.0));
  ui.setScrollProgress(smoothScroll / (CHAPTERS.length - 1));

  const chapIdx = Math.round(smoothScroll);
  const nextSandbox = smoothScroll >= 5.78;

  if (chapIdx !== activeChapter) {
    activeChapter = chapIdx;
    applyChapterState(activeChapter);
  }
  if (nextSandbox !== inSandbox) {
    inSandbox = nextSandbox;
    controls.enabled = inSandbox;
    if (inSandbox) {
      controls.target.set(...CHAPTERS[6].camTarget);
      controls.update();
    }
  }
  ui.setActiveChapter(activeChapter, inSandbox);

  let spaceFactor = 0;
  if (!inSandbox) {
    const cam = sampleStoryCamera(smoothScroll, simTime);
    camera.position.copy(cam.pos);
    controls.target.copy(cam.tgt);
    camera.lookAt(cam.tgt);
    if (Math.abs(camera.fov - cam.fov) > 0.05) {
      camera.fov = cam.fov;
      camera.updateProjectionMatrix();
    }
    spaceFactor = cam.spaceFactor;
  } else {
    if (Math.abs(camera.fov - 46) > 0.05) {
      camera.fov = THREE.MathUtils.lerp(camera.fov, 46, Math.min(1, dt * 4));
      camera.updateProjectionMatrix();
    }
    if (flyActive) {
      flyT += dt / 1.2;
      const u = Math.min(1, flyT);
      const ease = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      camera.position.lerpVectors(flyPos0, flyPos1, ease);
      controls.target.lerpVectors(flyTgt0, flyTgt1, ease);
      if (u >= 1) flyActive = false;
    }
    controls.update();
    spaceFactor = THREE.MathUtils.smoothstep(camera.position.y, 180, 380);
  }

  const wRate = Math.min(1, dt * 1.8);
  curStorm = THREE.MathUtils.lerp(curStorm, targetStorm, wRate);
  curSea = THREE.MathUtils.lerp(curSea, targetSea, wRate);
  curRiver = THREE.MathUtils.lerp(curRiver, targetRiver, wRate);
  curStreet = THREE.MathUtils.lerp(curStreet, targetStreet, wRate);

  skyWorld.update(dt, simTime, camera.position, spaceFactor, curStorm);
  fog.color.copy(skyWorld.fogColor);
  fog.density = skyWorld.fogDensity;

  cityWorld?.update(dt, simTime, curSea, curRiver, curStreet, curStorm);
  defenseWorld?.update(dt, simTime, defenses, curStorm);
  waterWorld.update({
    time: simTime,
    seaLevel: curSea,
    riverLevel: curRiver,
    streetFlood: curStreet,
    storm: curStorm,
    gateClose: defenseWorld?.gateProgress ?? 0,
    cutOpen: defenseWorld?.cutawayProgress ?? 0,
    skyZenith: skyWorld.skyZenith,
    skyHorizon: skyWorld.skyHorizon,
    fogColor: skyWorld.fogColor,
    fogDensity: skyWorld.fogDensity,
  });

  sound.updateAmbience(
    curStorm * (1 - spaceFactor),
    curStreet > 0 ? 180 : curStorm * 60,
    Math.min(100, camera.position.y)
  );

  ui.updatePins(camera, CHAPTERS[activeChapter], inSandbox);
  composer.render();
}

// Load real CC0 .glb models asynchronously & precompile shaders for zero-stutter playback
loadCityAssets(Math.min(16, renderer.capabilities.getMaxAnisotropy())).then((assets) => {
  cityWorld = createCityWorld(assets);
  scene.add(cityWorld.group);
  defenseWorld = createDefenseSystems(assets);
  scene.add(defenseWorld.group);
  renderer.compile(scene, camera);
});

requestAnimationFrame(animate);
