import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface ModelProto {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  size: THREE.Vector3;
}

export interface CityAssets {
  skyscrapers: ModelProto[];
  commercial: ModelProto[];
  suburban: ModelProto[];
  industrial: ModelProto[];
  vehicles: ModelProto[];
  ships: ModelProto[];
  tugs: ModelProto[];
  containers: ModelProto[];
  lamps: ModelProto[];
  bridgePillar: ModelProto;
  trees: ModelProto[];
}

function getSourceMaterial(gltf: GLTF): THREE.MeshStandardMaterial {
  let found: THREE.MeshStandardMaterial | null = null;
  gltf.scene.traverse((obj) => {
    if (!found && (obj as THREE.Mesh).isMesh) {
      const mat = (obj as THREE.Mesh).material;
      const m = Array.isArray(mat) ? mat[0] : mat;
      if (m && (m as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
        found = m as THREE.MeshStandardMaterial;
      }
    }
  });
  return found ?? new THREE.MeshStandardMaterial({ color: '#cbd5e1', roughness: 0.7 });
}

/**
 * Upscales a Kenney colormap texture by 4x (to 1024x1024) and synthesizes full PBR maps
 * (re-graded architectural stone/brick albedo, deep reflective glass curtain walls with aluminum
 * mullions, Sobel surface normals, metallic mask, roughness mask, and warm/cool evening windows).
 */
function enhanceBuildingMaterial(baseMat: THREE.MeshStandardMaterial, maxAnisotropy: number): THREE.MeshStandardMaterial {
  const cloned = baseMat.clone();
  cloned.roughness = 0.78;
  cloned.metalness = 1.0;

  const map = cloned.map;
  if (!map || !map.image) return cloned;

  const img = map.image as HTMLImageElement | HTMLCanvasElement;
  const srcW = img.width || 256;
  const srcH = img.height || 256;
  const scaleUp = Math.max(1, Math.min(4, Math.floor(1024 / Math.max(srcW, srcH))));
  const w = srcW * scaleUp;
  const h = srcH * scaleUp;

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = w;
  srcCanvas.height = h;
  const sCtx = srcCanvas.getContext('2d')!;
  sCtx.imageSmoothingEnabled = false;
  sCtx.drawImage(img, 0, 0, w, h);

  const srcData = sCtx.getImageData(0, 0, w, h);
  const cCanvas = document.createElement('canvas');
  cCanvas.width = w;
  cCanvas.height = h;
  const cCtx = cCanvas.getContext('2d')!;
  const cData = cCtx.createImageData(w, h);

  const rCanvas = document.createElement('canvas');
  rCanvas.width = w;
  rCanvas.height = h;
  const rCtx = rCanvas.getContext('2d')!;
  const rData = rCtx.createImageData(w, h);

  const mCanvas = document.createElement('canvas');
  mCanvas.width = w;
  mCanvas.height = h;
  const mCtx = mCanvas.getContext('2d')!;
  const mData = mCtx.createImageData(w, h);

  const eCanvas = document.createElement('canvas');
  eCanvas.width = w;
  eCanvas.height = h;
  const eCtx = eCanvas.getContext('2d')!;
  const eData = eCtx.createImageData(w, h);

  const hFloat = new Float32Array(w * h);

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i = (py * w + px) * 4;
      const r = srcData.data[i];
      const g = srcData.data[i + 1];
      const b = srcData.data[i + 2];
      const a = srcData.data[i + 3];

      const grain =
        (Math.sin(px * 1.73 + py * 3.11) * Math.cos(px * 2.41 - py * 1.37)) * 7.0;

      // Detect strictly cool blue/cyan window glass palette swatches
      const isBlueGlass = b > r + 24 && b > 120 && g > r + 8;

      if (isBlueGlass) {
        const mullion = px % 16 === 0 || py % 16 === 0;
        if (mullion) {
          cData.data[i] = 44;
          cData.data[i + 1] = 54;
          cData.data[i + 2] = 68;
          cData.data[i + 3] = a;
          rData.data[i] = rData.data[i + 1] = rData.data[i + 2] = 110;
          rData.data[i + 3] = 255;
          mData.data[i] = mData.data[i + 1] = mData.data[i + 2] = 140;
          mData.data[i + 3] = 255;
          hFloat[py * w + px] = 0.85;
        } else {
          // Reflective steel-blue architectural glass catching PMREM sky reflections
          cData.data[i] = 34;
          cData.data[i + 1] = 58;
          cData.data[i + 2] = 88;
          cData.data[i + 3] = a;
          rData.data[i] = rData.data[i + 1] = rData.data[i + 2] = 36;
          rData.data[i + 3] = 255;
          mData.data[i] = mData.data[i + 1] = mData.data[i + 2] = 115;
          mData.data[i + 3] = 255;
          hFloat[py * w + px] = 0.25;

          // Subtle muted dusk interior glow across ~40% of window cells
          const cellHash =
            Math.sin(Math.floor(px / 16) * 12.9898 + Math.floor(py / 16) * 78.233) * 43758.5453;
          const lit = cellHash - Math.floor(cellHash);
          if (lit > 0.6) {
            const warm = lit > 0.78;
            eData.data[i] = Math.round((warm ? 255 : 207) * 0.45);
            eData.data[i + 1] = Math.round((warm ? 226 : 232) * 0.45);
            eData.data[i + 2] = Math.round((warm ? 184 : 255) * 0.45);
            eData.data[i + 3] = 255;
          } else {
            eData.data[i] = eData.data[i + 1] = eData.data[i + 2] = 0;
            eData.data[i + 3] = 255;
          }
        }
      } else {
        // Balanced concrete / limestone / brick facade tones with fine stone micro-grain
        cData.data[i] = Math.max(0, Math.min(255, Math.round(r * 0.9 + grain * 0.55)));
        cData.data[i + 1] = Math.max(0, Math.min(255, Math.round(g * 0.9 + grain * 0.55)));
        cData.data[i + 2] = Math.max(0, Math.min(255, Math.round(b * 0.9 + grain * 0.55)));
        cData.data[i + 3] = a;

        rData.data[i] = rData.data[i + 1] = rData.data[i + 2] = 200;
        rData.data[i + 3] = 255;
        mData.data[i] = mData.data[i + 1] = mData.data[i + 2] = 22;
        mData.data[i + 3] = 255;
        eData.data[i] = eData.data[i + 1] = eData.data[i + 2] = 0;
        eData.data[i + 3] = 255;
        hFloat[py * w + px] = 0.72 + grain * 0.008;
      }
    }
  }

  cCtx.putImageData(cData, 0, 0);
  rCtx.putImageData(rData, 0, 0);
  mCtx.putImageData(mData, 0, 0);
  eCtx.putImageData(eData, 0, 0);

  // Sobel normal map from architectural height field
  const nCanvas = document.createElement('canvas');
  nCanvas.width = w;
  nCanvas.height = h;
  const nCtx = nCanvas.getContext('2d')!;
  const nData = nCtx.createImageData(w, h);
  const hIdx = (x: number, y: number) => ((y + h) % h) * w + ((x + w) % w);
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const dx = (hFloat[hIdx(px + 1, py)] - hFloat[hIdx(px - 1, py)]) * 2.1;
      const dy = (hFloat[hIdx(px, py + 1)] - hFloat[hIdx(px, py - 1)]) * 2.1;
      const inv = 1 / Math.hypot(dx, dy, 1.0);
      const o = (py * w + px) * 4;
      nData.data[o] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
      nData.data[o + 1] = Math.round((-dy * inv * 0.5 + 0.5) * 255);
      nData.data[o + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      nData.data[o + 3] = 255;
    }
  }
  nCtx.putImageData(nData, 0, 0);

  const mkTex = (cv: HTMLCanvasElement, isSRGB: boolean) => {
    const t = new THREE.CanvasTexture(cv);
    t.flipY = map.flipY;
    t.wrapS = map.wrapS;
    t.wrapT = map.wrapT;
    t.anisotropy = maxAnisotropy;
    if (isSRGB) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };

  cloned.map = mkTex(cCanvas, true);
  cloned.roughnessMap = mkTex(rCanvas, false);
  cloned.metalnessMap = mkTex(mCanvas, false);
  cloned.normalMap = mkTex(nCanvas, false);
  cloned.normalScale = new THREE.Vector2(0.45, 0.45);
  cloned.emissiveMap = mkTex(eCanvas, true);
  cloned.emissive = new THREE.Color('#ffffff');
  cloned.emissiveIntensity = 0.45;
  return cloned;
}

/**
 * Merges all meshes inside a loaded GLTF scene into a single centered BufferGeometry
 * (min.y = 0, X/Z centered) scaled cleanly for GPU InstancedMesh rendering.
 */
function mergeGltf(
  gltf: GLTF,
  targetLengthOrHeight: number,
  fitBy: 'height' | 'maxHoriz' | 'uniformScale',
  bakeVertexColors = false
): THREE.BufferGeometry {
  gltf.scene.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];

  gltf.scene.traverse((obj) => {
    if (!(obj as THREE.Mesh).isMesh) return;
    const m = obj as THREE.Mesh;
    let g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    if (g.index) g = g.toNonIndexed();
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) {
      const cnt = g.attributes.position.count;
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(cnt * 2), 2));
    }
    // Strip tangent or extra attributes so all primitives match cleanly
    for (const key of Object.keys(g.attributes)) {
      if (key !== 'position' && key !== 'normal' && key !== 'uv') {
        g.deleteAttribute(key);
      }
    }

    if (bakeVertexColors) {
      const mat = Array.isArray(m.material) ? m.material[0] : m.material;
      const srcCol =
        mat && (mat as THREE.MeshStandardMaterial).color
          ? (mat as THREE.MeshStandardMaterial).color.clone()
          : new THREE.Color('#27542d');

      // Re-grade bright mint-cyan stylized tree foliage into natural deep forest greens
      const isTrunk = srcCol.r >= srcCol.g * 0.88 && srcCol.r > 0.18;
      const baseCol = isTrunk
        ? new THREE.Color('#3b281c')
        : new THREE.Color('#1f4926').lerp(new THREE.Color('#2f5d32'), Math.min(1, srcCol.g));

      const posAttr = g.attributes.position as THREE.BufferAttribute;
      const cnt = posAttr.count;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < cnt; i++) {
        const py = posAttr.getY(i);
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
      const spanY = Math.max(0.01, maxY - minY);
      const arr = new Float32Array(cnt * 3);
      for (let i = 0; i < cnt; i++) {
        const hy = (posAttr.getY(i) - minY) / spanY;
        const shade = isTrunk ? 0.9 + hy * 0.15 : 0.72 + hy * 0.42;
        arr[i * 3] = baseCol.r * shade;
        arr[i * 3 + 1] = baseCol.g * shade;
        arr[i * 3 + 2] = baseCol.b * shade;
      }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    }

    parts.push(g);
  });

  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());

  merged.computeBoundingBox();
  const bb = merged.boundingBox!;
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  bb.getSize(size);
  bb.getCenter(center);

  // Center X/Z around 0 and sit bottom flush on y = 0
  merged.translate(-center.x, -bb.min.y, -center.z);

  let scale = targetLengthOrHeight;
  if (fitBy === 'height') {
    scale = targetLengthOrHeight / Math.max(0.01, size.y);
  } else if (fitBy === 'maxHoriz') {
    scale = targetLengthOrHeight / Math.max(0.01, Math.max(size.x, size.z));
  }
  merged.scale(scale, scale, scale);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

export async function loadCityAssets(
  maxAnisotropy = 16,
  onProgress?: (loaded: number, total: number) => void
): Promise<CityAssets> {
  const loader = new GLTFLoader();

  const paths = {
    skyscrapers: [
      'city-commercial/building-skyscraper-a.glb',
      'city-commercial/building-skyscraper-b.glb',
      'city-commercial/building-skyscraper-c.glb',
      'city-commercial/building-skyscraper-d.glb',
      'city-commercial/building-skyscraper-e.glb',
    ],
    commercial: [
      'city-commercial/building-a.glb',
      'city-commercial/building-b.glb',
      'city-commercial/building-c.glb',
      'city-commercial/building-d.glb',
      'city-commercial/building-f.glb',
      'city-commercial/building-g.glb',
      'city-commercial/building-h.glb',
      'city-commercial/building-j.glb',
      'city-commercial/building-l.glb',
      'city-commercial/building-m.glb',
    ],
    suburban: [
      'city-suburban/building-type-a.glb',
      'city-suburban/building-type-c.glb',
      'city-suburban/building-type-e.glb',
      'city-suburban/building-type-h.glb',
      'city-suburban/building-type-k.glb',
    ],
    industrial: [
      'city-industrial/building-a.glb',
      'city-industrial/building-c.glb',
      'city-industrial/building-f.glb',
      'city-industrial/detail-tank.glb',
      'city-industrial/chimney-large.glb',
    ],
    vehicles: [
      'car/sedan.glb',
      'car/sedan-sports.glb',
      'car/suv.glb',
      'car/suv-luxury.glb',
      'car/taxi.glb',
      'car/delivery.glb',
      'car/truck.glb',
      'car/police.glb',
      'car/ambulance.glb',
      'car/firetruck.glb',
    ],
    ships: [
      'watercraft/ship-cargo-a.glb',
      'watercraft/ship-cargo-b.glb',
      'watercraft/ship-ocean-liner-small.glb',
    ],
    tugs: ['watercraft/boat-tug-a.glb', 'watercraft/boat-tug-b.glb'],
    containers: [
      'watercraft/cargo-container-a.glb',
      'watercraft/cargo-container-b.glb',
      'watercraft/cargo-container-c.glb',
    ],
    lamps: ['city-roads/light-curved.glb', 'city-roads/light-curved-double.glb'],
    bridgePillar: ['city-roads/bridge-pillar-wide.glb'],
    trees: ['nature/tree_oak.glb', 'nature/tree_detailed.glb', 'nature/tree_pineDefaultA.glb'],
  };

  const allUrls = Object.values(paths).flat();
  const total = allUrls.length;
  let loaded = 0;

  const gltfMap = new Map<string, GLTF>();
  await Promise.all(
    allUrls.map(async (rel) => {
      const gltf = await loader.loadAsync(`/models/${rel}`);
      gltfMap.set(rel, gltf);
      loaded++;
      onProgress?.(loaded, total);
    })
  );

  // Share one enhanced PBR material per pack atlas with full anisotropy & clearcoat vehicles
  const commMat = enhanceBuildingMaterial(getSourceMaterial(gltfMap.get(paths.skyscrapers[0])!), maxAnisotropy);
  const subMat = enhanceBuildingMaterial(getSourceMaterial(gltfMap.get(paths.suburban[0])!), maxAnisotropy);
  const indMat = enhanceBuildingMaterial(getSourceMaterial(gltfMap.get(paths.industrial[0])!), maxAnisotropy);

  const carBase = getSourceMaterial(gltfMap.get(paths.vehicles[0])!);
  if (carBase.map) carBase.map.anisotropy = maxAnisotropy;
  const carMat = new THREE.MeshPhysicalMaterial({
    map: carBase.map,
    roughness: 0.22,
    metalness: 0.55,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
  });

  const waterMat = getSourceMaterial(gltfMap.get(paths.ships[0])!).clone();
  if (waterMat.map) waterMat.map.anisotropy = maxAnisotropy;
  waterMat.roughness = 0.42;
  waterMat.metalness = 0.35;

  const roadMat = getSourceMaterial(gltfMap.get(paths.lamps[0])!).clone();
  if (roadMat.map) roadMat.map.anisotropy = maxAnisotropy;
  roadMat.roughness = 0.38;
  roadMat.metalness = 0.65;

  const treeMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.88,
    metalness: 0.02,
  });

  const makeProto = (
    rel: string,
    mat: THREE.Material,
    target: number,
    fitBy: 'height' | 'maxHoriz' | 'uniformScale',
    bakeVC = false
  ): ModelProto => {
    const geom = mergeGltf(gltfMap.get(rel)!, target, fitBy, bakeVC);
    const sz = new THREE.Vector3();
    geom.boundingBox!.getSize(sz);
    return { geometry: geom, material: mat, size: sz };
  };

  return {
    skyscrapers: paths.skyscrapers.map((p) => makeProto(p, commMat, 11.2, 'uniformScale')),
    commercial: paths.commercial.map((p) => makeProto(p, commMat, 10.5, 'uniformScale')),
    suburban: paths.suburban.map((p) => makeProto(p, subMat, 8.2, 'uniformScale')),
    industrial: paths.industrial.map((p) => makeProto(p, indMat, 9.5, 'uniformScale')),
    vehicles: paths.vehicles.map((p, idx) =>
      makeProto(p, carMat, idx >= 5 ? 5.2 : 4.0, 'maxHoriz')
    ),
    ships: paths.ships.map((p) => makeProto(p, waterMat, 36.0, 'maxHoriz')),
    tugs: paths.tugs.map((p) => makeProto(p, waterMat, 10.5, 'maxHoriz')),
    containers: paths.containers.map((p) => makeProto(p, waterMat, 6.2, 'maxHoriz')),
    lamps: paths.lamps.map((p) => makeProto(p, roadMat, 5.4, 'height')),
    bridgePillar: makeProto(paths.bridgePillar[0], roadMat, 10.0, 'height'),
    trees: paths.trees.map((p) => makeProto(p, treeMat, 5.2, 'height', true)),
  };
}
