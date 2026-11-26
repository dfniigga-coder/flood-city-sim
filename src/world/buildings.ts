import * as THREE from 'three';
import { MeshBuilder, mesh } from './meshBuilder';
import { CityAssets, ModelProto } from './assets';
import { makeConcretePBR, makeFacade, makeRoadPuddleTextures, rng } from './textures';
import {
  BANK_BASE,
  BARRIER_ZONE,
  BRIDGES_Z,
  COAST_Z,
  CUT,
  inRect,
  PARK_RES,
  PARK_W,
  PORT,
  riverX,
  ROAD_HALF,
  terrainHeight,
  WALL_D,
  XS,
  ZS,
} from './terrain';

interface CarState {
  modelIdx: number;
  axis: 'x' | 'z';
  coord: number;
  dir: 1 | -1;
  pos: number;
  min: number;
  max: number;
  speed: number;
}

interface Placement {
  x: number;
  y: number;
  z: number;
  rotY: number;
  sx: number;
  sy: number;
  sz: number;
}

export interface CityWorld {
  group: THREE.Group;
  update(dt: number, time: number, seaLevel: number, riverLevel: number, streetFlood: number, storm: number): void;
}

function isRoadCell(x: number, z: number): boolean {
  if (z > COAST_Z - 1.5 || z < -165 || Math.abs(x) > 165) return false;
  if (inRect(PARK_W, x, z, 1)) return false;
  if (Math.abs(x - riverX(z)) < WALL_D + 0.5) {
    return BRIDGES_Z.some((bz) => Math.abs(z - bz) < ROAD_HALF + 0.4);
  }
  for (const ax of XS) {
    if (Math.abs(x - ax) <= ROAD_HALF) return true;
  }
  for (const ez of ZS) {
    if (Math.abs(z - ez) <= ROAD_HALF) return true;
  }
  return false;
}

function buildInstancedGroup(
  proto: ModelProto,
  items: Placement[],
  castShadow: boolean,
  receiveShadow = true
): THREE.InstancedMesh | null {
  if (items.length === 0) return null;
  const inst = new THREE.InstancedMesh(proto.geometry, proto.material, items.length);
  inst.castShadow = castShadow;
  inst.receiveShadow = receiveShadow;
  const d = new THREE.Object3D();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    d.position.set(it.x, it.y, it.z);
    d.rotation.set(0, it.rotY, 0);
    d.scale.set(it.sx, it.sy, it.sz);
    d.updateMatrix();
    inst.setMatrixAt(i, d.matrix);
  }
  inst.instanceMatrix.needsUpdate = true;
  return inst;
}

export function createCityWorld(assets: CityAssets): CityWorld {
  const group = new THREE.Group();
  const rand = rng(202611);

  // 1. High-resolution Terrain Mesh (560x560, skipping underground CUT pit)
  const size = 560;
  const segs = 240;
  const tGeo = new THREE.PlaneGeometry(size, size, segs, segs);
  tGeo.rotateX(-Math.PI / 2);

  const pos = tGeo.attributes.position as THREE.BufferAttribute;
  const cols = new Float32Array(pos.count * 3);
  const c = new THREE.Color();

  const cRoad = new THREE.Color('#161b24');
  const cSidewalk = new THREE.Color('#303845');
  const cPark = new THREE.Color('#243d2b');
  const cSand = new THREE.Color('#312e29');
  const cHill = new THREE.Color('#1d2b22');
  const cSeabed = new THREE.Color('#0c1520');

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);

    if (x > CUT.x0 + 0.8 && x < CUT.x1 - 0.8 && z > CUT.z0 + 0.8 && z < CUT.z1 - 0.8) {
      pos.setY(i, CUT.bottom - 1.5);
      cols[i * 3] = 0.05;
      cols[i * 3 + 1] = 0.07;
      cols[i * 3 + 2] = 0.1;
      continue;
    }

    const y = terrainHeight(x, z);
    const inSpongePit =
      x > PARK_W.x0 + 3.2 &&
      x < PARK_W.x1 - 3.2 &&
      z > PARK_W.z0 + 5.2 &&
      z < PARK_W.z1 - 5.2;
    if (inSpongePit) {
      pos.setY(i, y - 2.3);
      c.set('#1e293b');
      cols[i * 3] = c.r;
      cols[i * 3 + 1] = c.g;
      cols[i * 3 + 2] = c.b;
      continue;
    }
    pos.setY(i, y);

    const distRiv = Math.abs(x - riverX(z));
    if (y < 0.1 || z > COAST_Z + 0.5) {
      c.copy(cSeabed);
    } else if (isRoadCell(x, z)) {
      c.copy(cRoad);
    } else if (inRect(PARK_W, x, z) || inRect(PARK_RES, x, z)) {
      c.copy(cPark);
    } else if (distRiv < WALL_D + 1.8 && z <= COAST_Z) {
      c.copy(cSidewalk);
    } else if (Math.abs(x) > 165 || z < -165) {
      c.copy(cHill);
    } else if (z > COAST_Z - 3.5) {
      c.copy(cSand);
    } else {
      c.copy(cSidewalk);
    }

    cols[i * 3] = c.r;
    cols[i * 3 + 1] = c.g;
    cols[i * 3 + 2] = c.b;
  }

  tGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  tGeo.computeVertexNormals();
  const terrainMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.72,
    metalness: 0.08,
  });
  const terrainMesh = new THREE.Mesh(tGeo, terrainMat);
  terrainMesh.receiveShadow = true;
  group.add(terrainMesh);

  // Wet Rain-Puddle Road Overlays along main avenues
  const roadTex = makeRoadPuddleTextures();
  roadTex.map.repeat.set(1, 24);
  roadTex.rough.repeat.set(1, 24);
  const roadWetMat = new THREE.MeshStandardMaterial({
    map: roadTex.map,
    roughnessMap: roadTex.rough,
    roughness: 0.35,
    metalness: 0.25,
  });
  for (const ax of XS) {
    if (ax === 80) continue;
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2, 224), roadWetMat);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(ax, terrainHeight(ax, -45) - 0.15, -45);
    strip.receiveShadow = true;
    group.add(strip);
  }

  // 2. Granite River Embankments & Coastal Promenade Wall (full PBR concrete formwork)
  const concretePbr = makeConcretePBR();
  const graniteMat = new THREE.MeshStandardMaterial({
    map: concretePbr.map,
    normalMap: concretePbr.normal,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughnessMap: concretePbr.rough,
    color: '#9aa4b2',
    roughness: 0.85,
    metalness: 0.14,
  });
  const wallMb = new MeshBuilder();
  for (let z = -170; z < COAST_Z; z += 4) {
    if (z > 24 && z < 50) continue;
    const rc0 = riverX(z);
    const rc1 = riverX(z + 4);
    for (const side of [-1, 1]) {
      const x0 = rc0 + side * WALL_D;
      const x1 = rc1 + side * WALL_D;
      const mx = (x0 + x1) * 0.5;
      const mz = z + 2;
      const ang = Math.atan2(x1 - x0, 4);
      const len = Math.hypot(x1 - x0, 4) + 0.15;
      wallMb.box(mx, -3.2, mz, 1.35, 3.2 + BANK_BASE + 0.55, len, -ang, 6);
    }
  }
  for (let x = -175; x < 175; x += 8) {
    if (Math.abs(x - riverX(COAST_Z)) < WALL_D + 2.5) continue;
    wallMb.box(x + 4, -2.5, COAST_Z - 0.6, 8.1, 4.4, 1.6, 0, 6);
  }
  group.add(mesh(wallMb, graniteMat));

  // Road markings & crosswalks
  const markMb = new MeshBuilder();
  const markMat = new THREE.MeshStandardMaterial({ color: '#d4a64a', roughness: 0.5 });
  const whitePaintMat = new THREE.MeshStandardMaterial({ color: '#cbd5e1', roughness: 0.55 });
  const crossMb = new MeshBuilder();

  for (const ax of XS) {
    for (let z = -160; z < COAST_Z - 4; z += 6) {
      if (Math.abs(ax - riverX(z)) < WALL_D + 2) continue;
      if (inRect(CUT, ax, z, 2)) continue;
      markMb.box(ax, terrainHeight(ax, z) + 0.05, z, 0.22, 0.04, 2.8);
    }
  }
  for (const ez of ZS) {
    for (let x = -160; x < 160; x += 6) {
      if (Math.abs(x - riverX(ez)) < WALL_D + 1 && !BRIDGES_Z.includes(ez)) continue;
      if (inRect(CUT, x, ez, 2) || inRect(PARK_W, x, ez, 2)) continue;
      markMb.box(x, terrainHeight(x, ez) + 0.05, ez, 2.8, 0.04, 0.22);
    }
  }
  for (const ax of [-80, -48, 48, 80]) {
    for (const ez of [-60, -30, 0, 30]) {
      if (inRect(CUT, ax, ez, 4)) continue;
      const y = terrainHeight(ax, ez) + 0.05;
      for (let s = -2.4; s <= 2.4; s += 1.2) {
        crossMb.box(ax + s, y, ez + 5.2, 0.55, 0.04, 2.2);
        crossMb.box(ax + s, y, ez - 5.2, 0.55, 0.04, 2.2);
      }
    }
  }
  group.add(mesh(markMb, markMat, false));
  group.add(mesh(crossMb, whitePaintMat, false));

  // 3. Three River Bridges + Real GLB Bridge Piers
  const deckMat = new THREE.MeshStandardMaterial({ color: '#242d3a', roughness: 0.5, metalness: 0.28 });
  const whiteSteelMat = new THREE.MeshStandardMaterial({ color: '#e2e8f0', roughness: 0.3, metalness: 0.65 });
  const crownGlowMat = new THREE.MeshStandardMaterial({
    color: '#93c5fd',
    emissive: new THREE.Color('#60a5fa'),
    emissiveIntensity: 0.9,
  });
  const deckMb = new MeshBuilder();
  const steelMb = new MeshBuilder();
  const bridgeGlowMb = new MeshBuilder();
  const pierPlacements: Placement[] = [];

  for (const bz of BRIDGES_Z) {
    const rc = riverX(bz);
    const span = WALL_D * 2 + 12;
    const deckY = bz === 0 ? 6.6 : 5.6;
    deckMb.box(rc, deckY - 0.65, bz, span, 0.85, 9.2);
    deckMb.box(rc - span * 0.5 - 3, deckY - 1.7, bz, 7, 1.0, 9.2);
    deckMb.box(rc + span * 0.5 + 3, deckY - 1.7, bz, 7, 1.0, 9.2);
    steelMb.box(rc, deckY + 0.2, bz - 4.4, span, 0.75, 0.25);
    steelMb.box(rc, deckY + 0.2, bz + 4.4, span, 0.75, 0.25);

    // Real GLB bridge piers seated into riverbed
    for (const pxOff of [-9.5, 9.5]) {
      pierPlacements.push({ x: rc + pxOff, y: -3.5, z: bz, rotY: Math.PI / 2, sx: 2.2, sy: 1.0, sz: 2.6 });
    }

    if (bz === 0) {
      bridgeGlowMb.box(rc, deckY + 0.62, bz - 4.4, span * 0.96, 0.14, 0.14);
      bridgeGlowMb.box(rc, deckY + 0.62, bz + 4.4, span * 0.96, 0.14, 0.14);

      for (const pxOff of [-9.5, 9.5]) {
        const px = rc + pxOff;
        const top = new THREE.Vector3(px, 37, bz);
        steelMb.beam(new THREE.Vector3(px, -2, bz - 4.8), top, 1.3);
        steelMb.beam(new THREE.Vector3(px, -2, bz + 4.8), top, 1.3);
        steelMb.box(px, 23, bz, 1.1, 1.1, 4.2);

        for (let k = 1; k <= 6; k++) {
          for (const dir of [-1, 1]) {
            const ax = px + dir * k * 2.8;
            if (Math.abs(ax - rc) > span * 0.48) continue;
            for (const sz of [-4.2, 4.2]) {
              steelMb.beam(
                new THREE.Vector3(px, 36 - k * 1.35, bz + sz * 0.15),
                new THREE.Vector3(ax, deckY + 0.3, bz + sz),
                0.1
              );
            }
          }
        }
      }
    } else {
      for (const sz of [-4.4, 4.4]) {
        for (let s = 0; s < 10; s++) {
          const t0 = s / 10;
          const t1 = (s + 1) / 10;
          const x0 = rc - 16 + t0 * 32;
          const x1 = rc - 16 + t1 * 32;
          const y0 = deckY + Math.sin(t0 * Math.PI) * 5.2;
          const y1 = deckY + Math.sin(t1 * Math.PI) * 5.2;
          steelMb.beam(new THREE.Vector3(x0, y0, bz + sz), new THREE.Vector3(x1, y1, bz + sz), 0.45);
        }
      }
    }
  }
  group.add(mesh(deckMb, deckMat));
  group.add(mesh(steelMb, whiteSteelMat));
  group.add(mesh(bridgeGlowMb, crownGlowMat, false));
  const pierInst = buildInstancedGroup(assets.bridgePillar, pierPlacements, true);
  if (pierInst) group.add(pierInst);

  // 4. Real GLB Cityscape (Skyscrapers, Commercial Blocks, Suburban Houses + Granite Sidewalks)
  const skyBuckets: Placement[][] = assets.skyscrapers.map(() => []);
  const commBuckets: Placement[][] = assets.commercial.map(() => []);
  const subBuckets: Placement[][] = assets.suburban.map(() => []);
  const indBuckets: Placement[][] = assets.industrial.map(() => []);
  const sidewalkMb = new MeshBuilder();
  const trimStoneMat = new THREE.MeshStandardMaterial({
    map: concretePbr.map,
    normalMap: concretePbr.normal,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: concretePbr.rough,
    color: '#9ca3af',
    roughness: 0.78,
    metalness: 0.16,
  });

  // Architectural hero glass & modern panel skyscrapers for the downtown skyline
  const heroGlassMb = new MeshBuilder();
  const heroModernMb = new MeshBuilder();
  const heroTrimMb = new MeshBuilder();
  const heroGlowMb = new MeshBuilder();
  const heroFacade = makeFacade(0, 777);
  const heroGlassMat = new THREE.MeshStandardMaterial({
    map: heroFacade.map,
    normalMap: heroFacade.normal,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughnessMap: heroFacade.rough,
    emissiveMap: heroFacade.emissive,
    emissive: new THREE.Color('#ffffff'),
    emissiveIntensity: 1.35,
    roughness: 0.55,
    metalness: 0.48,
  });
  const heroModernFacade = makeFacade(3, 888);
  const heroModernMat = new THREE.MeshStandardMaterial({
    map: heroModernFacade.map,
    normalMap: heroModernFacade.normal,
    normalScale: new THREE.Vector2(0.75, 0.75),
    roughnessMap: heroModernFacade.rough,
    emissiveMap: heroModernFacade.emissive,
    emissive: new THREE.Color('#ffffff'),
    emissiveIntensity: 1.05,
    roughness: 0.62,
    metalness: 0.35,
  });
  const heroDarkMetalMat = new THREE.MeshStandardMaterial({
    color: '#1e293b',
    roughness: 0.34,
    metalness: 0.75,
  });
  const heroCrownMat = new THREE.MeshStandardMaterial({
    color: '#e0f2fe',
    emissive: new THREE.Color('#7dd3fc'),
    emissiveIntensity: 1.8,
  });
  let heroCount = 0;

  const xIntervals: [number, number][] = [];
  for (let i = 0; i < XS.length - 1; i++) {
    const a = XS[i] + ROAD_HALF + 1.5;
    const b = XS[i + 1] - ROAD_HALF - 1.5;
    if (b - a > 12) xIntervals.push([a, b]);
  }
  xIntervals.push([-48 + ROAD_HALF + 1.5, -26]);
  xIntervals.push([26, 48 - ROAD_HALF - 1.5]);

  const zIntervals: [number, number][] = [];
  for (let i = 0; i < ZS.length - 1; i++) {
    const a = ZS[i] + ROAD_HALF + 1.5;
    const b = ZS[i + 1] - ROAD_HALF - 1.5;
    if (b - a > 12) zIntervals.push([a, b]);
  }

  const rots = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

  for (const [x0, x1] of xIntervals) {
    for (const [z0, z1] of zIntervals) {
      const mx = (x0 + x1) * 0.5;
      const mz = (z0 + z1) * 0.5;

      if (Math.abs(mx - riverX(mz)) < WALL_D + 7) continue;
      if (inRect(PARK_RES, mx, mz, 3)) continue;
      if (inRect(PARK_W, mx, mz, 3)) continue;
      if (inRect(BARRIER_ZONE, mx, mz, 2)) continue;
      if (inRect(PORT, mx, mz, 2)) continue;

      const padY = terrainHeight(mx, mz);
      sidewalkMb.box(mx, padY - 0.1, mz, x1 - x0 + 0.6, 0.34, z1 - z0 + 0.6);

      const bw = x1 - x0;
      const bd = z1 - z0;
      const cols = bw > 22 ? 2 : 1;
      const rows = bd > 20 ? 2 : 1;
      const cw = bw / cols;
      const cd = bd / rows;

      for (let sc = 0; sc < cols; sc++) {
        for (let sr = 0; sr < rows; sr++) {
          if (rand() < 0.08) continue;
          const cx = x0 + (sc + 0.5) * cw + (rand() - 0.5) * 1.1;
          const cz = z0 + (sr + 0.5) * cd + (rand() - 0.5) * 1.1;
          if (Math.abs(cx - riverX(cz)) < WALL_D + 5) continue;

          const baseY = terrainHeight(cx, cz) + 0.24;
          const rotY = rots[Math.floor(rand() * 4)];
          const core = Math.exp(-((cx * cx) / (86 * 86) + ((cz + 22) * (cz + 22)) / (60 * 60)));

          if (core > 0.5 && heroCount < 12 && rand() < 0.48) {
            // Signature Stepped Curtain-Wall & Modern Panel Hero Skyscrapers with Penthouse & Twin Spires
            const targetMb = heroCount % 2 === 0 ? heroGlassMb : heroModernMb;
            const h1 = 44 + core * 28 + rand() * 14;
            const w1 = 10.5 + rand() * 2.5;
            const d1 = 10.5 + rand() * 2.5;
            targetMb.box(cx, baseY, cz, w1, h1, d1, rotY, 18);
            const h2 = 12 + rand() * 8;
            targetMb.box(cx, baseY + h1, cz, w1 * 0.74, h2, d1 * 0.74, rotY, 16);
            heroTrimMb.box(cx, baseY + h1 - 0.35, cz, w1 + 0.5, 0.7, d1 + 0.5, rotY, 8);
            heroTrimMb.box(cx, baseY + h1 + h2, cz, w1 * 0.52, 3.2, d1 * 0.52, rotY, 8);
            heroGlowMb.box(cx, baseY + h1 + h2 + 3.25, cz, w1 * 0.54, 0.35, d1 * 0.54, rotY, 8);
            heroTrimMb.box(cx - 1.2, baseY + h1 + h2 + 3.4, cz, 0.32, 11.5, 0.32, rotY, 4);
            heroTrimMb.box(cx + 1.2, baseY + h1 + h2 + 3.4, cz, 0.32, 9.0, 0.32, rotY, 4);
            heroCount++;
          } else if (core > 0.42 && rand() < 0.72) {
            // Financial Downtown Skyscraper (.glb)
            const idx = Math.floor(rand() * assets.skyscrapers.length);
            const hScale = 0.82 + core * 0.48 + rand() * 0.3;
            const xzScale = 0.72 + rand() * 0.14;
            skyBuckets[idx].push({ x: cx, y: baseY, z: cz, rotY, sx: xzScale, sy: hScale, sz: xzScale });
          } else if (Math.abs(cx) > 116 || cz < -126) {
            // Outer Residential Suburban Neighborhood (.glb)
            const idx = Math.floor(rand() * assets.suburban.length);
            const s = 0.95 + rand() * 0.35;
            subBuckets[idx].push({ x: cx, y: baseY, z: cz, rotY, sx: s, sy: s, sz: s });
          } else {
            // Midtown Commercial & Waterfront Office Blocks (.glb)
            const idx = Math.floor(rand() * assets.commercial.length);
            const xz = 0.92 + rand() * 0.32;
            const hScale = 0.95 + rand() * 0.65 + core * 0.45;
            commBuckets[idx].push({ x: cx, y: baseY, z: cz, rotY, sx: xz, sy: hScale, sz: xz });
          }
        }
      }
    }
  }
  group.add(mesh(sidewalkMb, trimStoneMat));
  if (heroCount > 0) {
    if (heroGlassMb.pos.length > 0) group.add(mesh(heroGlassMb, heroGlassMat));
    if (heroModernMb.pos.length > 0) group.add(mesh(heroModernMb, heroModernMat));
    group.add(mesh(heroTrimMb, heroDarkMetalMat));
    group.add(mesh(heroGlowMb, heroCrownMat, false));
  }

  // 5. Industrial Port (Real GLB Warehouses, Tanks, Chimneys, Containers, Cranes & Ships!)
  for (const px of [72, 98, 128]) {
    const pz = 42;
    const py = terrainHeight(px, pz);
    indBuckets[0].push({ x: px, y: py, z: pz, rotY: 0, sx: 1.0, sy: 1.0, sz: 1.0 });
  }
  indBuckets[3].push({ x: 144, y: terrainHeight(144, 48), z: 48, rotY: 0, sx: 1.2, sy: 1.2, sz: 1.2 });
  indBuckets[4].push({ x: 144, y: terrainHeight(144, 38), z: 38, rotY: 0, sx: 1.3, sy: 1.3, sz: 1.3 });

  for (let i = 0; i < skyBuckets.length; i++) {
    const inst = buildInstancedGroup(assets.skyscrapers[i], skyBuckets[i], true);
    if (inst) group.add(inst);
  }
  for (let i = 0; i < commBuckets.length; i++) {
    const inst = buildInstancedGroup(assets.commercial[i], commBuckets[i], true);
    if (inst) group.add(inst);
  }
  for (let i = 0; i < subBuckets.length; i++) {
    const inst = buildInstancedGroup(assets.suburban[i], subBuckets[i], true);
    if (inst) group.add(inst);
  }
  for (let i = 0; i < indBuckets.length; i++) {
    const inst = buildInstancedGroup(assets.industrial[i], indBuckets[i], true);
    if (inst) group.add(inst);
  }

  // Port Gantry Cranes
  const portCraneMat = new THREE.MeshStandardMaterial({ color: '#c2410c', roughness: 0.45, metalness: 0.5 });
  const craneMb = new MeshBuilder();
  for (const cx of [74, 102, 130]) {
    const cz = 63;
    const py = terrainHeight(cx, cz);
    craneMb.box(cx - 2.2, py, cz, 0.9, 18, 0.9);
    craneMb.box(cx + 2.2, py, cz, 0.9, 18, 0.9);
    craneMb.box(cx, py + 17.5, cz + 4, 5.4, 1.1, 22);
    craneMb.beam(new THREE.Vector3(cx, py + 23, cz - 2), new THREE.Vector3(cx, py + 18, cz + 14), 0.35);
  }
  group.add(mesh(craneMb, portCraneMat));

  // Real GLB Shipping Containers stacked in Port
  const contBuckets: Placement[][] = assets.containers.map(() => []);
  for (let i = 0; i < 24; i++) {
    const gx = 68 + (i % 6) * 10.5;
    const gz = 51 + Math.floor(i / 6) * 3.4;
    const py = terrainHeight(gx, gz);
    const tier = i % 2;
    const cIdx = i % assets.containers.length;
    contBuckets[cIdx].push({
      x: gx,
      y: py + tier * 2.45,
      z: gz,
      rotY: Math.PI / 2,
      sx: 1,
      sy: 1,
      sz: 1,
    });
  }
  for (let i = 0; i < contBuckets.length; i++) {
    const inst = buildInstancedGroup(assets.containers[i], contBuckets[i], true);
    if (inst) group.add(inst);
  }

  // Real GLB Ocean Cargo Ships & Cruise Liner moored outside harbor (bobbing with seaLevel)
  const mooredShips: { mesh: THREE.Mesh; x: number; z: number; rotY: number; phase: number }[] = [
    {
      mesh: new THREE.Mesh(assets.ships[0].geometry, assets.ships[0].material),
      x: 112,
      z: 82,
      rotY: Math.PI / 2,
      phase: 0.4,
    },
    {
      mesh: new THREE.Mesh(assets.ships[1].geometry, assets.ships[1].material),
      x: 74,
      z: 96,
      rotY: Math.PI * 0.45,
      phase: 2.1,
    },
    {
      mesh: new THREE.Mesh(assets.ships[2].geometry, assets.ships[2].material),
      x: -76,
      z: 92,
      rotY: -Math.PI * 0.35,
      phase: 3.8,
    },
  ];
  for (const s of mooredShips) {
    s.mesh.position.set(s.x, 0.3, s.z);
    s.mesh.rotation.y = s.rotY;
    s.mesh.castShadow = true;
    s.mesh.receiveShadow = true;
    group.add(s.mesh);
  }

  // Real GLB River Tugboats cruising along the river channel
  const tugBoats = [
    { mesh: new THREE.Mesh(assets.tugs[0].geometry, assets.tugs[0].material), z: -90, dir: 1 },
    { mesh: new THREE.Mesh(assets.tugs[1].geometry, assets.tugs[1].material), z: 12, dir: -1 },
  ];
  for (const tb of tugBoats) {
    tb.mesh.castShadow = false;
    group.add(tb.mesh);
  }

  // 6. Real GLB Trees across parks & riverside boulevards (keeping waterfront Sponge Plaza sightline clear)
  const treeBuckets: Placement[][] = assets.trees.map(() => []);
  for (let x = PARK_W.x0 + 2.5; x <= PARK_W.x1 - 2.5; x += 4.8) {
    for (let z = PARK_W.z0 + 2.5; z <= PARK_W.z1 - 2.5; z += 4.8) {
      const inNorthRim = z < PARK_W.z0 + 4.8;
      const inEastRim = x > PARK_W.x1 - 4.8;
      if (!inNorthRim && !inEastRim) continue;
      const tidx = Math.floor(rand() * assets.trees.length);
      const s = 0.85 + rand() * 0.55;
      treeBuckets[tidx].push({ x, y: terrainHeight(x, z), z, rotY: rand() * Math.PI * 2, sx: s, sy: s, sz: s });
    }
  }
  for (let z = -150; z < 60; z += 14) {
    for (const side of [-1, 1]) {
      if (side === 1 && z >= PARK_W.z0 - 4 && z <= PARK_W.z1 + 4) continue;
      const tx = riverX(z) + side * (WALL_D + 3.2);
      if (inRect(BARRIER_ZONE, tx, z, 2)) continue;
      const tidx = Math.floor(rand() * assets.trees.length);
      const s = 0.85 + rand() * 0.4;
      treeBuckets[tidx].push({ x: tx, y: terrainHeight(tx, z), z, rotY: rand() * Math.PI * 2, sx: s, sy: s, sz: s });
    }
  }
  for (let i = 0; i < treeBuckets.length; i++) {
    const inst = buildInstancedGroup(assets.trees[i], treeBuckets[i], true);
    if (inst) group.add(inst);
  }

  // 7. Real GLB Streetlights + Warm Glowing LED Luminaires along avenues
  const lampSingle: Placement[] = [];
  for (const ax of [-48, 48]) {
    for (let z = -140; z <= 50; z += 20) {
      if (inRect(CUT, ax, z, 2)) continue;
      lampSingle.push({ x: ax - 4.4, y: terrainHeight(ax - 4.4, z), z, rotY: Math.PI / 2, sx: 1, sy: 1, sz: 1 });
      lampSingle.push({ x: ax + 4.4, y: terrainHeight(ax + 4.4, z), z, rotY: -Math.PI / 2, sx: 1, sy: 1, sz: 1 });
    }
  }
  const lampInst = buildInstancedGroup(assets.lamps[0], lampSingle, false, false);
  if (lampInst) group.add(lampInst);

  if (lampSingle.length > 0) {
    const bulbGeo = new THREE.SphereGeometry(0.24, 8, 8);
    const bulbMat = new THREE.MeshStandardMaterial({
      color: '#fff3d6',
      emissive: new THREE.Color('#ffd599'),
      emissiveIntensity: 2.2,
    });
    const bulbInst = new THREE.InstancedMesh(bulbGeo, bulbMat, lampSingle.length);
    const bObj = new THREE.Object3D();
    for (let i = 0; i < lampSingle.length; i++) {
      const lp = lampSingle[i];
      bObj.position.set(lp.x + Math.sin(lp.rotY) * 1.15, lp.y + 5.15, lp.z + Math.cos(lp.rotY) * 1.15);
      bObj.scale.set(1, 0.6, 1);
      bObj.updateMatrix();
      bulbInst.setMatrixAt(i, bObj.matrix);
    }
    bulbInst.instanceMatrix.needsUpdate = true;
    group.add(bulbInst);
  }

  // 8. 75 Moving Real GLB Vehicles across 10 Classes (sedans, SUVs, taxis, trucks, police, ambulance, firetruck)
  const cars: CarState[] = [];
  for (const ax of [-112, -80, -48, 48, 112]) {
    for (let k = 0; k < 7; k++) {
      cars.push({
        modelIdx: (cars.length * 3) % assets.vehicles.length,
        axis: 'z',
        coord: ax + (k % 2 === 0 ? -1.9 : 1.9),
        dir: k % 2 === 0 ? 1 : -1,
        pos: -145 + rand() * 200,
        min: -155,
        max: 62,
        speed: 7.5 + rand() * 5.0,
      });
    }
  }
  for (const ez of [-120, -60, 0, 30]) {
    for (let k = 0; k < 10; k++) {
      cars.push({
        modelIdx: (cars.length * 7) % assets.vehicles.length,
        axis: 'x',
        coord: ez + (k % 2 === 0 ? 1.9 : -1.9),
        dir: k % 2 === 0 ? 1 : -1,
        pos: -140 + rand() * 280,
        min: -150,
        max: 150,
        speed: 8.0 + rand() * 5.0,
      });
    }
  }

  const carsByModel: CarState[][] = assets.vehicles.map(() => []);
  cars.forEach((cItem) => carsByModel[cItem.modelIdx].push(cItem));
  const carInsts = assets.vehicles.map((proto, mIdx) => {
    const count = Math.max(1, carsByModel[mIdx].length);
    const inst = new THREE.InstancedMesh(proto.geometry, proto.material, count);
    inst.castShadow = true;
    inst.receiveShadow = true;
    group.add(inst);
    return inst;
  });

  // Instanced Warm Headlights & Red Taillights synced with Moving Traffic
  const lightBulbGeo = new THREE.BoxGeometry(0.26, 0.16, 0.16);
  const headLightMat = new THREE.MeshStandardMaterial({
    color: '#fffbeb',
    emissive: new THREE.Color('#fef3c7'),
    emissiveIntensity: 2.3,
  });
  const tailLightMat = new THREE.MeshStandardMaterial({
    color: '#fecaca',
    emissive: new THREE.Color('#ef4444'),
    emissiveIntensity: 2.0,
  });
  const headLightInst = new THREE.InstancedMesh(lightBulbGeo, headLightMat, cars.length * 2);
  const tailLightInst = new THREE.InstancedMesh(lightBulbGeo, tailLightMat, cars.length * 2);
  headLightInst.frustumCulled = false;
  tailLightInst.frustumCulled = false;
  group.add(headLightInst, tailLightInst);

  // 9. Sculpted Rescue Helicopter during Storm Chapters
  const heli = new THREE.Group();
  const hBodyMat = new THREE.MeshPhysicalMaterial({
    color: '#ea580c',
    roughness: 0.25,
    metalness: 0.45,
    clearcoat: 0.9,
  });
  const hDarkGlass = new THREE.MeshPhysicalMaterial({
    color: '#0f172a',
    roughness: 0.08,
    metalness: 0.2,
    clearcoat: 1.0,
  });
  const hHull = new THREE.Mesh(new THREE.SphereGeometry(1.15, 16, 12), hBodyMat);
  hHull.scale.set(0.88, 0.85, 2.15);
  const hCanopy = new THREE.Mesh(new THREE.SphereGeometry(0.92, 14, 10), hDarkGlass);
  hCanopy.scale.set(0.9, 0.72, 1.35);
  hCanopy.position.set(0, 0.22, 0.85);
  const hTail = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.34, 4.4, 10), whiteSteelMat);
  hTail.rotation.x = Math.PI / 2;
  hTail.position.set(0, 0.18, -3.4);
  const hFin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.25, 0.85), hBodyMat);
  hFin.position.set(0, 0.65, -5.3);
  hFin.rotation.x = -0.25;
  const hMast = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.7, 10), heroDarkMetalMat);
  hMast.position.set(0, 1.05, -0.1);
  const hRotor = new THREE.Group();
  hRotor.position.set(0, 1.4, -0.1);
  const bladeMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.4, metalness: 0.6 });
  for (let b = 0; b < 2; b++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.05, 0.32), bladeMat);
    blade.rotation.y = (b * Math.PI) / 2;
    hRotor.add(blade);
  }
  const hTailRotor = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.45, 0.16), bladeMat);
  hTailRotor.position.set(0.2, 0.9, -5.45);
  const skidL = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.8, 8), heroDarkMetalMat);
  skidL.rotation.x = Math.PI / 2;
  skidL.position.set(-0.92, -1.05, 0.1);
  const skidR = skidL.clone();
  skidR.position.x = 0.92;
  const strobeRed = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 8, 8),
    new THREE.MeshBasicMaterial({ color: '#ef4444' })
  );
  strobeRed.position.set(-1.1, 0.0, 0.4);
  const strobeGreen = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 8, 8),
    new THREE.MeshBasicMaterial({ color: '#22c55e' })
  );
  strobeGreen.position.set(1.1, 0.0, 0.4);

  const hConeGeo = new THREE.ConeGeometry(10, 44, 16, 1, true);
  hConeGeo.translate(0, -22, 0);
  const hCone = new THREE.Mesh(
    hConeGeo,
    new THREE.MeshBasicMaterial({
      color: '#dbeafe',
      transparent: true,
      opacity: 0.09,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  hCone.position.set(0, -0.7, 1.1);
  hCone.rotation.x = -0.32;
  heli.add(hHull, hCanopy, hTail, hFin, hMast, hRotor, hTailRotor, skidL, skidR, strobeRed, strobeGreen, hCone);
  group.add(heli);

  const ld = new THREE.Object3D();

  return {
    group,
    update(dt: number, time: number, seaLevel: number, riverLevel: number, streetFlood: number, storm: number) {
      terrainMat.roughness = THREE.MathUtils.lerp(0.76, 0.25, storm);
      roadWetMat.roughness = THREE.MathUtils.lerp(0.55, 0.16, storm);

      // Ships bobbing in outer storm sea
      for (const s of mooredShips) {
        s.mesh.position.y = seaLevel - 1.1 + Math.sin(time * 1.4 + s.phase) * (0.2 + storm * 0.35);
        s.mesh.rotation.z = Math.sin(time * 1.1 + s.phase) * (0.02 + storm * 0.05);
      }

      // River tugboats cruising along channel
      for (const tb of tugBoats) {
        if (riverLevel < 2.5) {
          tb.z += tb.dir * 3.2 * dt;
          if (tb.z > 28) tb.z = -148;
          if (tb.z < -148) tb.z = 28;
        }
        const rx = riverX(tb.z);
        const nextRx = riverX(tb.z + tb.dir * 2);
        tb.mesh.position.set(rx + tb.dir * 3.5, riverLevel - 0.55 + Math.sin(time * 2 + tb.z) * 0.08, tb.z);
        tb.mesh.rotation.y = Math.atan2(nextRx - rx, tb.dir * 2);
      }

      heli.visible = storm > 0.35;
      if (heli.visible) {
        const ang = time * 0.25;
        const hx = Math.cos(ang) * 44;
        const hz = -10 + Math.sin(ang) * 44;
        const hy = 52 + Math.sin(time * 1.2) * 2.0;
        heli.position.set(hx, hy, hz);
        heli.lookAt(-Math.sin(ang) * 44, hy - 1.5, Math.cos(ang) * 44);
        hRotor.rotation.y += dt * 28;
        hTailRotor.rotation.x += dt * 38;
      }

      // Update 10 instanced vehicle classes & synced headlights / taillights
      let hlIdx = 0;
      for (let mIdx = 0; mIdx < carsByModel.length; mIdx++) {
        const list = carsByModel[mIdx];
        const inst = carInsts[mIdx];
        for (let i = 0; i < list.length; i++) {
          const car = list[i];
          const x = car.axis === 'x' ? car.pos : car.coord;
          const z = car.axis === 'z' ? car.pos : car.coord;
          const groundY = terrainHeight(x, z);
          const flooded = streetFlood - groundY > 0.35;

          if (!flooded) {
            car.pos += car.speed * car.dir * dt;
            if (car.pos > car.max) car.pos = car.min;
            if (car.pos < car.min) car.pos = car.max;
          }

          const cx = car.axis === 'x' ? car.pos : car.coord;
          const cz = car.axis === 'z' ? car.pos : car.coord;
          let cy = terrainHeight(cx, cz) + 0.05;
          if (car.axis === 'x' && BRIDGES_Z.includes(Math.round(car.coord / 30) * 30)) {
            if (Math.abs(cx - riverX(cz)) < WALL_D + 5) {
              cy = Math.abs(cz) < 10 ? 6.6 : 5.6;
            }
          }
          if (flooded) cy = Math.max(cy, streetFlood - 0.35);

          const yaw =
            car.axis === 'z'
              ? car.dir > 0
                ? 0
                : Math.PI
              : car.dir > 0
                ? Math.PI / 2
                : -Math.PI / 2;

          ld.position.set(cx, cy, cz);
          ld.rotation.set(flooded ? Math.sin(time * 2 + i) * 0.08 : 0, yaw, 0);
          ld.scale.setScalar(1);
          ld.updateMatrix();
          inst.setMatrixAt(i, ld.matrix);

          // Headlights (+Z in model local space) and taillights (-Z in model local space)
          const sinY = Math.sin(yaw);
          const cosY = Math.cos(yaw);
          const fwdZ = 1.85;
          const rearZ = -1.85;
          for (const sideX of [-0.52, 0.52]) {
            ld.position.set(cx + sideX * cosY + fwdZ * sinY, cy + 0.45, cz - sideX * sinY + fwdZ * cosY);
            ld.rotation.set(0, yaw, 0);
            ld.scale.setScalar(1);
            ld.updateMatrix();
            headLightInst.setMatrixAt(hlIdx, ld.matrix);

            ld.position.set(cx + sideX * cosY + rearZ * sinY, cy + 0.48, cz - sideX * sinY + rearZ * cosY);
            ld.updateMatrix();
            tailLightInst.setMatrixAt(hlIdx, ld.matrix);
            hlIdx++;
          }
        }
        inst.instanceMatrix.needsUpdate = true;
      }
      headLightInst.instanceMatrix.needsUpdate = true;
      tailLightInst.instanceMatrix.needsUpdate = true;
    },
  };
}
