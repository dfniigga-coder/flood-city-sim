import * as THREE from 'three';
import { MeshBuilder, mesh } from './meshBuilder';
import { CityAssets } from './assets';
import { makeConcretePBR, makeGlowTexture, makeSoilTexture, makeSteelPBR } from './textures';
import {
  BAR,
  COAST_Z,
  CUT,
  PARK_RES,
  PARK_W,
  riverX,
  terrainHeight,
  WALL_D,
} from './terrain';

export interface DefenseControlState {
  stormGates: boolean;
  floodWalls: boolean;
  spongeCity: boolean;
  collector: boolean;
  cutawayOpen: boolean;
}

export interface DefenseWorld {
  group: THREE.Group;
  gateProgress: number;
  wallProgress: number;
  spongeProgress: number;
  collectorProgress: number;
  cutawayProgress: number;
  update(dt: number, time: number, state: DefenseControlState, storm?: number): void;
}

export function createDefenseSystems(assets: CityAssets): DefenseWorld {
  const group = new THREE.Group();

  const concretePbr = makeConcretePBR();
  const steelPbr = makeSteelPBR();
  const concreteMat = new THREE.MeshStandardMaterial({
    map: concretePbr.map,
    normalMap: concretePbr.normal,
    normalScale: new THREE.Vector2(0.8, 0.8),
    roughnessMap: concretePbr.rough,
    color: '#8e99a8',
    roughness: 0.82,
    metalness: 0.14,
  });
  const steelWhiteMat = new THREE.MeshStandardMaterial({
    map: steelPbr.map,
    normalMap: steelPbr.normal,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughnessMap: steelPbr.rough,
    color: '#f1f5f9',
    roughness: 0.34,
    metalness: 0.72,
  });
  const gateHullMat = new THREE.MeshStandardMaterial({
    map: steelPbr.map,
    normalMap: steelPbr.normal,
    normalScale: new THREE.Vector2(0.8, 0.8),
    roughnessMap: steelPbr.rough,
    color: '#475569',
    roughness: 0.44,
    metalness: 0.65,
  });

  // =========================================================================
  // 1. Maeslant-style Twin Radial Storm-Surge Gates + GLB Control Station
  // =========================================================================
  const dockMb = new MeshBuilder();
  const gateBeacons: THREE.MeshStandardMaterial[] = [];
  for (const side of [-1, 1]) {
    const px = BAR.rc + side * BAR.poff;
    dockMb.box(px, -3.5, BAR.pz, 6.2, 6.8, 6.2);
    dockMb.box(px + side * 6.5, -2.5, BAR.pz + 11, 14, 4.5, 22, side * 0.25);

    const bMat = new THREE.MeshStandardMaterial({
      color: '#f59e0b',
      emissive: new THREE.Color('#f59e0b'),
      emissiveIntensity: 1.4,
    });
    gateBeacons.push(bMat);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.65, 10, 10), bMat);
    beacon.position.set(px, 5.4, BAR.pz);
    group.add(beacon);
  }
  group.add(mesh(dockMb, concreteMat));

  // Real GLB Barrier Control Station beside West dry-dock
  const ctrlStn = new THREE.Mesh(assets.industrial[1].geometry, assets.industrial[1].material);
  ctrlStn.position.set(BAR.rc - 26, terrainHeight(BAR.rc - 26, BAR.pz - 6), BAR.pz - 6);
  ctrlStn.scale.setScalar(0.85);
  ctrlStn.castShadow = true;
  ctrlStn.receiveShadow = true;
  group.add(ctrlStn);

  const buildGateArm = (side: -1 | 1): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.position.set(BAR.rc + side * BAR.poff, 0, BAR.pz);

    const hullMb = new MeshBuilder();
    const trussMb = new MeshBuilder();
    const segs = 14;
    const armAngleSpan = 0.72;

    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * armAngleSpan;
      const a1 = ((i + 1) / segs) * armAngleSpan;
      const p0 = new THREE.Vector3(-side * BAR.r * Math.sin(a0), 0, BAR.r * Math.cos(a0));
      const p1 = new THREE.Vector3(-side * BAR.r * Math.sin(a1), 0, BAR.r * Math.cos(a1));

      const mid = p0.clone().add(p1).multiplyScalar(0.5);
      const len = p0.distanceTo(p1) + 0.15;
      const rot = Math.atan2(p1.z - p0.z, p1.x - p0.x);
      if (i > 4) {
        hullMb.box(mid.x, -3.2, mid.z, len, 8.6, 1.9, -rot);
        trussMb.box(mid.x, 5.45, mid.z, len, 0.35, 2.3, -rot);
      }

      const pivTop = new THREE.Vector3(0, 3.8, 0);
      const pivLow = new THREE.Vector3(0, 0.8, 0);
      if (i % 2 === 0 && i >= 4) {
        trussMb.beam(pivTop, new THREE.Vector3(p0.x, 4.9, p0.z), 0.36);
        trussMb.beam(pivLow, new THREE.Vector3(p0.x, 1.4, p0.z), 0.36);
      }
      trussMb.beam(new THREE.Vector3(p0.x, 5.2, p0.z), new THREE.Vector3(p1.x, 5.2, p1.z), 0.42);
    }

    const ball = new THREE.Mesh(new THREE.SphereGeometry(2.3, 20, 16), steelWhiteMat);
    ball.position.y = 2.4;
    ball.castShadow = true;
    pivot.add(ball);

    pivot.add(mesh(hullMb, gateHullMat));
    pivot.add(mesh(trussMb, steelWhiteMat));
    group.add(pivot);
    return pivot;
  };

  const leftArm = buildGateArm(-1);
  const rightArm = buildGateArm(1);

  // Wave-Crash Sea Spray Plumes
  const sprayCount = 160;
  const sprayPos = new Float32Array(sprayCount * 3);
  const sprayVel: { vx: number; vy: number; vz: number; life: number; maxLife: number }[] = [];
  for (let i = 0; i < sprayCount; i++) {
    sprayPos[i * 3 + 1] = -99;
    sprayVel.push({ vx: 0, vy: 0, vz: 0, life: Math.random(), maxLife: 0.6 + Math.random() * 0.6 });
  }
  const sprayGeo = new THREE.BufferGeometry();
  sprayGeo.setAttribute('position', new THREE.BufferAttribute(sprayPos, 3));
  const sprayMat = new THREE.PointsMaterial({
    size: 4.5,
    map: makeGlowTexture(),
    color: '#e0f2fe',
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const sprayPts = new THREE.Points(sprayGeo, sprayMat);
  sprayPts.frustumCulled = false;
  group.add(sprayPts);

  // =========================================================================
  // 2. Hydraulic Coastal & Embankment Floodwalls (Glass + Steel + LED Crest + Pistons)
  // =========================================================================
  const wallPanelMat = new THREE.MeshPhysicalMaterial({
    color: '#7dd3fc',
    transparent: true,
    opacity: 0.58,
    roughness: 0.08,
    metalness: 0.15,
    clearcoat: 1.0,
  });
  const wallPostMat = new THREE.MeshStandardMaterial({
    map: steelPbr.map,
    normalMap: steelPbr.normal,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: steelPbr.rough,
    color: '#dbeafe',
    roughness: 0.3,
    metalness: 0.78,
  });
  const wallPistonMat = new THREE.MeshStandardMaterial({
    color: '#f59e0b',
    roughness: 0.32,
    metalness: 0.68,
  });
  const wallRailMat = new THREE.MeshStandardMaterial({
    color: '#bae6fd',
    emissive: new THREE.Color('#38bdf8'),
    emissiveIntensity: 1.5,
  });

  const hydroWallsGroup = new THREE.Group();
  const wallPanelMb = new MeshBuilder();
  const wallPostMb = new MeshBuilder();
  const wallPistonMb = new MeshBuilder();
  const wallRailMb = new MeshBuilder();

  for (let x = -168; x < 168; x += 6) {
    if (Math.abs(x - riverX(COAST_Z)) < WALL_D + 2.5) continue;
    wallPanelMb.box(x + 3, 0, COAST_Z - 0.6, 5.6, 3.4, 0.38);
    wallRailMb.box(x + 3, 3.42, COAST_Z - 0.6, 5.9, 0.16, 0.44);
    wallPostMb.box(x, -0.1, COAST_Z - 0.6, 0.45, 3.65, 0.7);
    wallPistonMb.box(x, -0.2, COAST_Z - 1.15, 0.34, 2.35, 0.34);
  }
  for (let z = -156; z < 34; z += 6) {
    const rc0 = riverX(z);
    const rc1 = riverX(z + 6);
    const ang = Math.atan2(rc1 - rc0, 6);
    const len = Math.hypot(rc1 - rc0, 6) - 0.3;
    const bankOff = Math.max(0, (COAST_Z - z) * 0.011);
    for (const side of [-1, 1]) {
      const mx = (rc0 + rc1) * 0.5 + side * WALL_D;
      wallPanelMb.box(mx, bankOff, z + 3, 0.36, 3.3, len, -ang);
      wallRailMb.box(mx, bankOff + 3.32, z + 3, 0.42, 0.16, len + 0.15, -ang);
      wallPostMb.box(rc0 + side * WALL_D, bankOff - 0.1, z, 0.62, 3.55, 0.55);
      wallPistonMb.box(rc0 + side * (WALL_D + 0.58), bankOff - 0.2, z, 0.34, 2.25, 0.34);
    }
  }
  const wallPanelMesh = mesh(wallPanelMb, wallPanelMat, false);
  wallPanelMesh.renderOrder = 3;
  hydroWallsGroup.add(wallPanelMesh);
  hydroWallsGroup.add(mesh(wallPostMb, wallPostMat));
  hydroWallsGroup.add(mesh(wallPistonMb, wallPistonMat));
  hydroWallsGroup.add(mesh(wallRailMb, wallRailMat, false));
  group.add(hydroWallsGroup);

  // =========================================================================
  // 3. Landmark Sponge-City Terraced Water Plaza, Bridges & Spillways (PARK_W)
  // =========================================================================
  const spongeGroup = new THREE.Group();
  const stepStoneMat = new THREE.MeshStandardMaterial({
    map: concretePbr.map,
    normalMap: concretePbr.normal,
    normalScale: new THREE.Vector2(0.65, 0.65),
    roughnessMap: concretePbr.rough,
    color: '#94a3b8',
    roughness: 0.82,
  });
  const cedarTimberMat = new THREE.MeshStandardMaterial({
    color: '#8b5a2b',
    roughness: 0.72,
    metalness: 0.06,
  });
  const darkSlateMat = new THREE.MeshStandardMaterial({
    color: '#1e293b',
    roughness: 0.85,
    metalness: 0.22,
  });

  const wCx = (PARK_W.x0 + PARK_W.x1) * 0.5;
  const wCz = (PARK_W.z0 + PARK_W.z1) * 0.5;
  const wGround = terrainHeight(wCx, wCz);

  const bw = 21;
  const bd = 38;
  const basinMb = new MeshBuilder();
  const timberMb = new MeshBuilder();
  const slateMb = new MeshBuilder();

  // Outer promenade coping rim framing the 21x38m terraced basin
  basinMb.box(wCx, wGround - 0.15, wCz - bd * 0.5 + 1.0, bw + 1.6, 0.6, 2.0);
  basinMb.box(wCx, wGround - 0.15, wCz + bd * 0.5 - 1.0, bw + 1.6, 0.6, 2.0);
  basinMb.box(wCx - bw * 0.5 + 1.0, wGround - 0.15, wCz, 2.0, 0.6, bd - 4.0);
  basinMb.box(wCx + bw * 0.5 - 1.0, wGround - 0.15, wCz, 2.0, 0.6, bd - 4.0);

  // Middle terraced seating step (-0.65m) topped with cedar bench decks
  basinMb.box(wCx, wGround - 0.85, wCz - 15.8, bw - 3.6, 0.8, 2.8);
  basinMb.box(wCx, wGround - 0.85, wCz + 15.8, bw - 3.6, 0.8, 2.8);
  basinMb.box(wCx - 8.2, wGround - 0.85, wCz, 2.6, 0.8, bd - 7.6);
  basinMb.box(wCx + 8.2, wGround - 0.85, wCz, 2.6, 0.8, bd - 7.6);

  timberMb.box(wCx, wGround - 0.02, wCz - 15.8, bw - 4.2, 0.14, 2.1);
  timberMb.box(wCx, wGround - 0.02, wCz + 15.8, bw - 4.2, 0.14, 2.1);
  timberMb.box(wCx - 8.2, wGround - 0.02, wCz, 2.0, 0.14, bd - 8.2);
  timberMb.box(wCx + 8.2, wGround - 0.02, wCz, 2.0, 0.14, bd - 8.2);

  // Lower retention floor (-1.75m) & wet slate drain grates
  basinMb.box(wCx, wGround - 2.0, wCz, bw - 2.4, 0.5, bd - 2.4);
  for (const gz of [wCz - 9, wCz, wCz + 9]) {
    slateMb.box(wCx, wGround - 1.72, gz, 9.0, 0.1, 2.4);
  }

  // Two elevated timber-and-steel pedestrian footbridges spanning east-west across the water plaza
  const bridgeSteelMb = new MeshBuilder();
  const bridgeGlowMb = new MeshBuilder();
  for (const fz of [wCz - 9, wCz + 9]) {
    bridgeSteelMb.box(wCx, wGround + 0.25, fz, bw + 0.6, 0.3, 2.6);
    timberMb.box(wCx, wGround + 0.43, fz, bw - 0.4, 0.12, 2.2);
    bridgeSteelMb.box(wCx, wGround + 0.8, fz - 1.15, bw, 0.72, 0.14);
    bridgeSteelMb.box(wCx, wGround + 0.8, fz + 1.15, bw, 0.72, 0.14);
    bridgeGlowMb.box(wCx, wGround + 1.18, fz - 1.15, bw * 0.96, 0.09, 0.1);
    bridgeGlowMb.box(wCx, wGround + 1.18, fz + 1.15, bw * 0.96, 0.09, 0.1);
  }

  // Four stormwater spillway chutes along the east street intake rim
  const spillwayZs = [wCz - 13, wCz - 4.5, wCz + 4.5, wCz + 13];
  for (const sz of spillwayZs) {
    basinMb.box(wCx + 9.4, wGround + 0.05, sz, 2.8, 0.55, 2.2);
  }

  spongeGroup.add(mesh(basinMb, stepStoneMat));
  spongeGroup.add(mesh(timberMb, cedarTimberMat));
  spongeGroup.add(mesh(slateMb, darkSlateMat, false));
  spongeGroup.add(mesh(bridgeSteelMb, steelWhiteMat));
  spongeGroup.add(mesh(bridgeGlowMb, wallRailMat, false));

  // Animated stormwater cascades pouring from the east street drains into the retention basin
  const spongeCascadeMat = new THREE.MeshStandardMaterial({
    color: '#38bdf8',
    emissive: new THREE.Color('#0284c7'),
    emissiveIntensity: 0.75,
    transparent: true,
    opacity: 0.78,
    roughness: 0.12,
  });
  const spongeCascades: THREE.Mesh[] = [];
  for (const sz of spillwayZs) {
    const chuteWater = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.35, 1.4), spongeCascadeMat);
    chuteWater.position.set(wCx + 8.3, wGround - 0.32, sz);
    chuteWater.rotation.z = 0.48;
    spongeGroup.add(chuteWater);
    spongeCascades.push(chuteWater);
  }

  // Eight warm architectural bollards illuminating the terraced plaza perimeter
  const bollardBodyMb = new MeshBuilder();
  const bollardLampMb = new MeshBuilder();
  const bollardLampMat = new THREE.MeshStandardMaterial({
    color: '#fef3c7',
    emissive: new THREE.Color('#fde68a'),
    emissiveIntensity: 2.0,
  });
  for (const bx of [wCx - 9.8, wCx + 9.8]) {
    for (const bz of [wCz - 17, wCz - 5.8, wCz + 5.8, wCz + 17]) {
      bollardBodyMb.box(bx, wGround + 0.45, bz, 0.28, 0.9, 0.28);
      bollardLampMb.box(bx, wGround + 0.96, bz, 0.32, 0.2, 0.32);
    }
  }
  spongeGroup.add(mesh(bollardBodyMb, darkSlateMat));
  spongeGroup.add(mesh(bollardLampMb, bollardLampMat, false));

  const spongePoolMat = new THREE.MeshPhysicalMaterial({
    color: '#06b6d4',
    emissive: new THREE.Color('#0e7490'),
    emissiveIntensity: 0.55,
    roughness: 0.06,
    metalness: 0.25,
    clearcoat: 1.0,
    transparent: true,
    opacity: 0.92,
  });
  const spongePool = new THREE.Mesh(new THREE.BoxGeometry(17.2, 1.3, 34.2), spongePoolMat);
  spongePool.position.set(wCx, wGround - 2.3, wCz);
  spongeGroup.add(spongePool);
  group.add(spongeGroup);

  // =========================================================================
  // 4. G-Cans Underground "Water Temple" Geological Cutaway (CUT)
  // =========================================================================
  const cutGroup = new THREE.Group();
  const soilTex = makeSoilTexture();
  const soilMat = new THREE.MeshStandardMaterial({ map: soilTex, roughness: 0.92, side: THREE.DoubleSide });
  const cavernMat = new THREE.MeshStandardMaterial({
    map: concretePbr.map,
    normalMap: concretePbr.normal,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughnessMap: concretePbr.rough,
    color: '#5d6b7d',
    roughness: 0.82,
    metalness: 0.18,
  });
  const cavernPillarMat = new THREE.MeshStandardMaterial({
    map: concretePbr.map,
    normalMap: concretePbr.normal,
    normalScale: new THREE.Vector2(0.95, 0.95),
    roughnessMap: concretePbr.rough,
    color: '#808e9e',
    roughness: 0.74,
  });

  const cw = CUT.x1 - CUT.x0;
  const cd = CUT.z1 - CUT.z0;
  const cx = (CUT.x0 + CUT.x1) * 0.5;
  const cz = (CUT.z0 + CUT.z1) * 0.5;
  const topY = terrainHeight(cx, cz);
  const cutH = topY - CUT.bottom;

  const soilWalls: [number, number, number, number, number][] = [
    [cx, CUT.z0 + 0.3, cw, 0.4, 0],
    [cx, CUT.z1 - 0.3, cw, 0.4, Math.PI],
    [CUT.x0 + 0.3, cz, cd, 0.4, Math.PI / 2],
    [CUT.x1 - 0.3, cz, cd, 0.4, -Math.PI / 2],
  ];
  for (const [sx, sz, sw, _sd, rot] of soilWalls) {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(sw, cutH), soilMat);
    plane.position.set(sx, CUT.bottom + cutH * 0.5, sz);
    plane.rotation.y = rot;
    cutGroup.add(plane);
  }

  const cavMb = new MeshBuilder();
  cavMb.box(cx, CUT.bottom - 0.8, cz, cw, 1.2, cd);
  cavMb.box(cx, topY - 0.15, CUT.z0 + 0.5, cw + 1, 0.6, 1.2);
  cavMb.box(cx, topY - 0.15, CUT.z1 - 0.5, cw + 1, 0.6, 1.2);
  cavMb.box(CUT.x0 + 0.5, topY - 0.15, cz, 1.2, 0.6, cd);
  cavMb.box(CUT.x1 - 0.5, topY - 0.15, cz, 1.2, 0.6, cd);
  for (let iz = 0; iz < 3; iz++) {
    const pz = CUT.z0 + 6 + iz * 13;
    cavMb.box(cx, -8.2, pz, cw - 1, 1.4, 2.4);
  }
  cutGroup.add(mesh(cavMb, cavernMat));

  const pilMb = new MeshBuilder();
  for (let ix = 0; ix < 5; ix++) {
    for (let iz = 0; iz < 3; iz++) {
      const px = CUT.x0 + 5 + ix * 7.5;
      const pz = CUT.z0 + 6 + iz * 13;
      pilMb.box(px, CUT.bottom, pz, 2.3, 21.8, 2.3);
      pilMb.box(px, -10.0, pz, 3.2, 1.6, 3.2);
    }
  }
  cutGroup.add(mesh(pilMb, cavernPillarMat));

  const shaftX = CUT.x0 + 7;
  const shaftZ = cz;
  const shaftRing = new THREE.Mesh(
    new THREE.CylinderGeometry(4.2, 4.2, cutH - 2, 24, 1, true),
    new THREE.MeshStandardMaterial({ color: '#64748b', roughness: 0.7, side: THREE.DoubleSide })
  );
  shaftRing.position.set(shaftX, CUT.bottom + (cutH - 2) * 0.5, shaftZ);
  cutGroup.add(shaftRing);

  const cascadeMat = new THREE.MeshStandardMaterial({
    color: '#38bdf8',
    emissive: new THREE.Color('#0284c7'),
    emissiveIntensity: 0.55,
    transparent: true,
    opacity: 0.68,
    roughness: 0.15,
  });
  const cascadeCol = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.2, cutH - 4, 16), cascadeMat);
  cascadeCol.position.set(shaftX, CUT.bottom + (cutH - 4) * 0.5, shaftZ);
  cutGroup.add(cascadeCol);

  const turbines: THREE.Group[] = [];
  for (const tz of [cz - 6, cz + 6]) {
    const tGroup = new THREE.Group();
    tGroup.position.set(CUT.x1 - 5.5, CUT.bottom + 4.5, tz);
    for (let b = 0; b < 4; b++) {
      const blade = new THREE.Mesh(
        new THREE.BoxGeometry(3.8, 0.35, 0.75),
        new THREE.MeshStandardMaterial({ color: '#f59e0b', roughness: 0.35, metalness: 0.7 })
      );
      blade.rotation.y = (b * Math.PI) / 4;
      tGroup.add(blade);
    }
    turbines.push(tGroup);
    cutGroup.add(tGroup);
  }

  const cavWater = new THREE.Mesh(
    new THREE.BoxGeometry(cw - 1.2, 6, cd - 1.2),
    new THREE.MeshStandardMaterial({
      color: '#0e4d64',
      roughness: 0.1,
      metalness: 0.35,
      transparent: true,
      opacity: 0.86,
    })
  );
  cavWater.position.set(cx, CUT.bottom + 2.2, cz);
  cutGroup.add(cavWater);

  const cavernLights: THREE.PointLight[] = [];
  for (const lx of [CUT.x0 + 9, cx, CUT.x1 - 7]) {
    const ptLight = new THREE.PointLight('#ffe8c2', 78, 56, 1.3);
    ptLight.position.set(lx, -16.5, cz);
    ptLight.visible = false;
    cavernLights.push(ptLight);
    cutGroup.add(ptLight);
  }

  // Sliding Green Surface Park Lid with Real GLB Oak & Pine Trees
  const lidGroup = new THREE.Group();
  const parkLid = new THREE.Mesh(
    new THREE.BoxGeometry(PARK_RES.x1 - PARK_RES.x0, 1.0, PARK_RES.z1 - PARK_RES.z0),
    new THREE.MeshStandardMaterial({ color: '#27422e', roughness: 0.85 })
  );
  parkLid.position.set((PARK_RES.x0 + PARK_RES.x1) * 0.5, topY - 0.4, (PARK_RES.z0 + PARK_RES.z1) * 0.5);
  parkLid.receiveShadow = true;
  lidGroup.add(parkLid);

  const lidTrees = new THREE.InstancedMesh(assets.trees[0].geometry, assets.trees[0].material, 16);
  const dObj = new THREE.Object3D();
  for (let i = 0; i < 16; i++) {
    const tx = PARK_RES.x0 + 6 + (i % 4) * 14;
    const tz = PARK_RES.z0 + 6 + Math.floor(i / 4) * 13;
    dObj.position.set(tx, topY + 0.1, tz);
    dObj.rotation.y = i * 1.1;
    dObj.scale.setScalar(1.1);
    dObj.updateMatrix();
    lidTrees.setMatrixAt(i, dObj.matrix);
  }
  lidTrees.instanceMatrix.needsUpdate = true;
  lidGroup.add(lidTrees);
  cutGroup.add(lidGroup);
  group.add(cutGroup);

  const world: DefenseWorld = {
    group,
    gateProgress: 0,
    wallProgress: 0,
    spongeProgress: 0,
    collectorProgress: 0,
    cutawayProgress: 0,
    update(dt: number, time: number, state: DefenseControlState, storm = 0.8) {
      const k = Math.min(1, dt * 2.2);
      this.gateProgress = THREE.MathUtils.lerp(this.gateProgress, state.stormGates ? 1 : 0, k);
      this.wallProgress = THREE.MathUtils.lerp(this.wallProgress, state.floodWalls ? 1 : 0, k);
      this.spongeProgress = THREE.MathUtils.lerp(this.spongeProgress, state.spongeCity ? 1 : 0, k);
      this.collectorProgress = THREE.MathUtils.lerp(this.collectorProgress, state.collector ? 1 : 0, k);
      this.cutawayProgress = THREE.MathUtils.lerp(this.cutawayProgress, state.cutawayOpen ? 1 : 0, k * 1.4);

      const openSwing = 0.74;
      leftArm.rotation.y = THREE.MathUtils.lerp(-openSwing, 0, this.gateProgress);
      rightArm.rotation.y = THREE.MathUtils.lerp(openSwing, 0, this.gateProgress);

      const bCol = this.gateProgress > 0.75 ? '#38bdf8' : '#f59e0b';
      for (const bm of gateBeacons) {
        bm.color.set(bCol);
        bm.emissive.set(bCol);
      }

      const sprayActive = this.gateProgress > 0.6 && storm > 0.35;
      sprayPts.visible = sprayActive;
      if (sprayActive) {
        for (let i = 0; i < sprayCount; i++) {
          const sv = sprayVel[i];
          sv.life += dt;
          if (sv.life >= sv.maxLife) {
            sv.life = 0;
            const ang = (Math.random() - 0.5) * 1.1;
            const px = BAR.rc + Math.sin(ang) * 15;
            const pz = 59 + Math.cos(ang) * 4;
            sprayPos[i * 3] = px;
            sprayPos[i * 3 + 1] = 4.6 + Math.random() * 1.2;
            sprayPos[i * 3 + 2] = pz;
            sv.vx = (Math.random() - 0.5) * 4.5;
            sv.vy = 4.5 + Math.random() * 6.5;
            sv.vz = -2.0 + Math.random() * 4.0;
          } else {
            sv.vy -= 12.0 * dt;
            sprayPos[i * 3] += sv.vx * dt;
            sprayPos[i * 3 + 1] += sv.vy * dt;
            sprayPos[i * 3 + 2] += sv.vz * dt;
          }
        }
        (sprayGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      }

      hydroWallsGroup.position.y = THREE.MathUtils.lerp(-1.9, 2.05, this.wallProgress);
      hydroWallsGroup.visible = this.wallProgress > 0.02;

      spongePool.position.y =
        THREE.MathUtils.lerp(wGround - 2.3, wGround - 0.85, this.spongeProgress) +
        Math.sin(time * 2.2) * 0.04 * this.spongeProgress;
      spongePool.visible = this.spongeProgress > 0.05;

      const cascadesActive = this.spongeProgress > 0.08;
      spongeCascadeMat.opacity = this.spongeProgress * (0.62 + 0.22 * Math.sin(time * 9.0));
      for (const cMesh of spongeCascades) cMesh.visible = cascadesActive;

      lidGroup.position.x = this.cutawayProgress * 56;
      lidGroup.visible = this.cutawayProgress < 0.95;

      const cavernActive = this.cutawayProgress > 0.05;
      for (const l of cavernLights) l.visible = cavernActive;

      const turbSpd = 0.8 + this.collectorProgress * 12.0;
      for (const t of turbines) t.rotation.y += dt * turbSpd;

      cascadeCol.visible = this.collectorProgress > 0.1;
      cascadeMat.opacity = this.collectorProgress * (0.55 + 0.15 * Math.sin(time * 8));
      cavWater.position.y =
        CUT.bottom + 1.5 + (1 - this.collectorProgress * 0.65) * 3.5 + Math.sin(time * 1.4) * 0.2;
    },
  };

  return world;
}
