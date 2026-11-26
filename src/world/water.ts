import * as THREE from 'three';
import { CUT, TERRAIN_GLSL } from './terrain';

const WATER_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uSeaLevel;
  uniform float uRiverLevel;
  uniform float uStreetFlood;
  uniform float uStorm;

  varying vec3 vWorld;
  varying float vCrest;

  ${TERRAIN_GLSL}

  float gerstner(vec2 p, vec2 dir, float amp, float wl, float spd, float t) {
    float k = 6.283185 / wl;
    return amp * sin(k * (dot(normalize(dir), p) - spd * t));
  }

  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vec2 p = wp.xz;
    float z = zoneAt(p);

    float h = uStreetFlood;
    float wave = 0.0;
    if (z > 1.5) {
      float s = mix(0.22, 1.0, uStorm);
      wave += gerstner(p, vec2(0.18, 0.98), 0.42 * s, 32.0, 7.2, uTime);
      wave += gerstner(p, vec2(-0.36, 0.93), 0.28 * s, 18.0, 5.8, uTime);
      wave += gerstner(p, vec2(0.48, 0.88), 0.16 * s, 10.5, 4.4, uTime);
      h = uSeaLevel + wave;
    } else if (z > 0.5) {
      float rAmp = mix(0.05, 0.22, uStorm);
      wave += sin(p.y * 0.18 - uTime * 1.9 + p.x * 0.12) * rAmp;
      wave += cos(p.y * 0.34 + uTime * 2.4) * rAmp * 0.45;
      h = uRiverLevel + wave;
    } else {
      wave += sin(p.x * 0.24 + p.y * 0.26 - uTime * 2.4) * 0.08 * step(0.2, uStreetFlood);
      h = uStreetFlood + wave;
    }

    wp.y = h;
    vWorld = wp.xyz;
    vCrest = clamp(wave * 1.15, 0.0, 1.0);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const WATER_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uStorm;
  uniform float uGateClose;
  uniform float uCutOpen;
  uniform vec3 uSunDir;
  uniform vec3 uSkyZenith;
  uniform vec3 uSkyHorizon;
  uniform vec3 uFogColor;
  uniform float uFogDensity;

  varying vec3 vWorld;
  varying float vCrest;

  ${TERRAIN_GLSL}

  float hash(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 43.2);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p = p * 2.06 + vec2(7.3, 11.1);
      a *= 0.5;
    }
    return v;
  }

  float rainRing(vec2 uv, float t) {
    vec2 c = floor(uv);
    vec2 f = fract(uv) - 0.5;
    float h = hash(c);
    float ph = fract(t * 1.4 + h);
    float d = length(f);
    return sin((d - ph * 0.42) * 32.0) * exp(-d * 7.0) * (1.0 - ph) * step(0.35, h);
  }

  void main() {
    vec2 p = vWorld.xz;

    if (uCutOpen > 0.05 &&
        p.x > ${CUT.x0.toFixed(1)} - 0.5 && p.x < ${CUT.x1.toFixed(1)} + 0.5 &&
        p.y > ${CUT.z0.toFixed(1)} - 0.5 && p.y < ${CUT.z1.toFixed(1)} + 0.5) {
      discard;
    }

    float th = terrainH(p);
    float depth = vWorld.y - th;
    if (depth <= 0.025) discard;

    // Flow-advected 4-octave ocean ripples + raindrop impact rings
    vec2 uv1 = p * 0.34 + vec2(uTime * 0.25, -uTime * 0.45);
    vec2 uv2 = p * 0.78 + vec2(-uTime * 0.38, -uTime * 0.62);
    float eps = 0.11;
    float h1 = fbm(uv1);
    float h2 = fbm(uv2);
    float hx = (fbm(uv1 + vec2(eps, 0.0)) - h1) + (fbm(uv2 + vec2(eps, 0.0)) - h2) * 0.55;
    float hz = (fbm(uv1 + vec2(0.0, eps)) - h1) + (fbm(uv2 + vec2(0.0, eps)) - h2) * 0.55;
    float rRing = (rainRing(p * 0.75, uTime) + rainRing(p * 1.3 + 11.4, uTime * 1.15)) * uStorm * 0.22;

    vec3 N = normalize(vec3(-hx * 1.45 + rRing, 1.0, -hz * 1.45 + rRing));
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 L = normalize(uSunDir);

    // Beer-Lambert shallow coastal teal -> abyssal ocean navy
    float absorb = 1.0 - exp(-depth * 0.38);
    vec3 shallowCol = vec3(0.09, 0.28, 0.32);
    vec3 deepCol = vec3(0.015, 0.07, 0.13);
    vec3 bodyCol = mix(shallowCol, deepCol, absorb);

    // Subsurface scattering emerald glow in wave crests
    float sss = pow(clamp(vCrest, 0.0, 1.0), 1.5) * max(dot(V, -L) * 0.5 + 0.5, 0.0);
    bodyCol += vec3(0.06, 0.28, 0.30) * sss * 0.5;

    // Schlick Fresnel sky + warm city lights bounce
    float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 4.2);
    vec3 R = reflect(-V, N);
    vec3 skyRefl = mix(uSkyHorizon, uSkyZenith, clamp(R.y * 1.2 + 0.1, 0.0, 1.0));
    float cityGlow = smoothstep(75.0, -70.0, p.y) * (1.0 - smoothstep(15.0, 145.0, abs(p.x)));
    skyRefl += mix(vec3(0.24, 0.18, 0.10), vec3(0.08, 0.22, 0.32), h2) * cityGlow * 0.6;

    vec3 col = mix(bodyCol, skyRefl, clamp(fresnel * 0.88, 0.08, 0.93));

    // Specular sunlight / dusk glint
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 140.0) * 1.25;
    col += vec3(1.0, 0.88, 0.72) * spec;

    // Multi-source turbulent whitewater foam
    float zone = zoneAt(p);
    float shoreFoam = smoothstep(0.55, 0.03, depth) * smoothstep(0.30, 0.70, h1);
    float crestFoam = smoothstep(0.32, 0.82, vCrest + h2 * 0.25) * uStorm * 0.7;

    float barrierImpact = 0.0;
    if (uGateClose > 0.3 && zone > 1.5 && p.y < 71.5) {
      float dCoast = abs(p.y - 69.6);
      float dGate = smoothstep(64.0, 52.0, p.y) * step(abs(p.x - 10.0), 22.0);
      barrierImpact = (smoothstep(3.4, 0.0, dCoast) + dGate * 0.9) * uStorm * smoothstep(0.26, 0.72, h1);
    }

    float foam = clamp(shoreFoam * 0.8 + crestFoam + barrierImpact, 0.0, 1.0);
    col = mix(col, vec3(0.86, 0.92, 0.97), foam * 0.86);

    float dist = length(cameraPosition - vWorld);
    float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));

    float alpha = smoothstep(0.025, 0.14, depth) * mix(0.86, 0.97, clamp(depth * 0.3 + foam, 0.0, 1.0));
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface WaterWorld {
  group: THREE.Group;
  material: THREE.ShaderMaterial;
  update(params: {
    time: number;
    seaLevel: number;
    riverLevel: number;
    streetFlood: number;
    storm: number;
    gateClose: number;
    cutOpen: number;
    skyZenith: THREE.Color;
    skyHorizon: THREE.Color;
    fogColor: THREE.Color;
    fogDensity: number;
  }): void;
}

export function createWaterWorld(): WaterWorld {
  const group = new THREE.Group();

  const material = new THREE.ShaderMaterial({
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    transparent: true,
    depthWrite: true,
    uniforms: {
      uTime: { value: 0 },
      uSeaLevel: { value: 0.4 },
      uRiverLevel: { value: 0.4 },
      uStreetFlood: { value: -2.0 },
      uStorm: { value: 0.2 },
      uGateClose: { value: 0 },
      uCutOpen: { value: 0 },
      uSunDir: { value: new THREE.Vector3(-0.6, 0.28, 0.72).normalize() },
      uSkyZenith: { value: new THREE.Color('#0c182e') },
      uSkyHorizon: { value: new THREE.Color('#273e5c') },
      uFogColor: { value: new THREE.Color('#16263d') },
      uFogDensity: { value: 0.0024 },
    },
  });

  const innerGeo = new THREE.PlaneGeometry(560, 560, 220, 220);
  innerGeo.rotateX(-Math.PI / 2);
  const innerMesh = new THREE.Mesh(innerGeo, material);
  innerMesh.frustumCulled = false;
  group.add(innerMesh);

  const outerGeo = new THREE.PlaneGeometry(1400, 600, 32, 16);
  outerGeo.rotateX(-Math.PI / 2);
  const outerMesh = new THREE.Mesh(outerGeo, material);
  outerMesh.position.set(0, 0, 580);
  outerMesh.frustumCulled = false;
  group.add(outerMesh);

  return {
    group,
    material,
    update(p) {
      const u = material.uniforms;
      u.uTime.value = p.time;
      u.uSeaLevel.value = p.seaLevel;
      u.uRiverLevel.value = p.riverLevel;
      u.uStreetFlood.value = p.streetFlood;
      u.uStorm.value = p.storm;
      u.uGateClose.value = p.gateClose;
      u.uCutOpen.value = p.cutOpen;
      u.uSkyZenith.value.copy(p.skyZenith);
      u.uSkyHorizon.value.copy(p.skyHorizon);
      u.uFogColor.value.copy(p.fogColor);
      u.uFogDensity.value = p.fogDensity;
    },
  };
}
