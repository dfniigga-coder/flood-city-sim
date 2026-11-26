import * as THREE from 'three';
import { makeGlowTexture, rng } from './textures';

// ============================================================================
// 1. Seamless 3D Procedural GLSL Moon (ZERO UV seams, real displaced rims!)
// ============================================================================
const MOON_COMMON_GLSL = /* glsl */ `
  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  vec3 hash33(vec3 p) {
    p = vec3(
      dot(p, vec3(127.1, 311.7, 74.7)),
      dot(p, vec3(269.5, 183.3, 246.1)),
      dot(p, vec3(113.5, 271.9, 124.6))
    );
    return fract(sin(p) * 43758.5453123);
  }

  float noise3(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash31(i + vec3(0,0,0)), hash31(i + vec3(1,0,0)), f.x),
          mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),
          mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y),
      f.z
    );
  }

  float fbm3(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise3(p);
      p = p * 2.04 + vec3(7.1, 13.7, 19.3);
      a *= 0.5;
    }
    return v;
  }

  // 3D Voronoi crater octave returning (heightDelta, ejectaBrightness)
  vec2 craterOctave(vec3 p, float scale, float depthAmp) {
    vec3 sp = p * scale;
    vec3 ip = floor(sp);
    vec3 fp = fract(sp);

    float minD = 9.0;
    float seed = 0.0;
    for (int x = -1; x <= 1; x++) {
      for (int y = -1; y <= 1; y++) {
        for (int z = -1; z <= 1; z++) {
          vec3 nb = vec3(float(x), float(y), float(z));
          vec3 rnd = hash33(ip + nb);
          vec3 pt = nb + 0.18 + 0.64 * rnd;
          float d = length(pt - fp);
          if (d < minD) {
            minD = d;
            seed = rnd.x;
          }
        }
      }
    }

    // Only ~62% of cells host a crater of varying radius
    float radius = 0.24 + 0.28 * seed;
    if (seed < 0.28) return vec2(0.0);

    float rn = minD / radius;
    float h = 0.0;
    float ejecta = 0.0;
    if (rn < 1.38) {
      // Flat/curved bowl inside rim
      float bowl = clamp(1.0 - rn * rn, 0.0, 1.0);
      h -= pow(bowl, 1.4) * depthAmp;
      // Sharp raised crater rim around rn = 0.94
      float rim = exp(-pow((rn - 0.94) * 5.2, 2.0));
      h += rim * depthAmp * 0.42;
      // Central rebound peak on large craters
      if (seed > 0.78 && rn < 0.28) {
        h += cos(rn / 0.28 * 1.5707) * depthAmp * 0.28;
      }
      ejecta = rim * 0.35 + smoothstep(1.38, 0.9, rn) * 0.14 * seed;
    }
    return vec2(h, ejecta);
  }

  vec3 moonField(vec3 dir) {
    float mariaMask = smoothstep(0.36, 0.66, fbm3(dir * 2.2 + vec3(1.4, -0.7, 2.1)));
    float micro = fbm3(dir * 18.0);

    vec2 c1 = craterOctave(dir, 3.6, 0.85);
    vec2 c2 = craterOctave(dir + vec3(2.3, 1.1, 4.7), 8.5, 0.36);
    vec2 c3 = craterOctave(dir + vec3(5.1, 8.2, 1.9), 20.0, 0.14);

    // Bright Tycho-like radial ejecta rays around a prominent south-east highland crater
    vec3 tychoDir = normalize(vec3(0.38, -0.25, 0.89));
    float tAng = acos(clamp(dot(dir, tychoDir), -1.0, 1.0));
    float rayAz = atan(dir.y - tychoDir.y, dir.x - tychoDir.x);
    float rays = pow(0.5 + 0.5 * sin(rayAz * 11.0 + fbm3(dir * 12.0) * 3.0), 3.0)
               * exp(-tAng * 3.2) * 0.32;

    float h = (1.0 - mariaMask) * 0.45 + c1.x + c2.x + c3.x + (micro - 0.5) * 0.14;
    float ejecta = clamp(c1.y + c2.y * 0.7 + c3.y * 0.4 + rays, 0.0, 1.0);
    return vec3(h, mariaMask, ejecta);
  }
`;

const EQUIRECT_DIR_GLSL = /* glsl */ `
  vec3 uvToDir(vec2 uv) {
    float phi = uv.x * 6.28318530718;
    float theta = (1.0 - uv.y) * 3.14159265359;
    float s = sin(theta);
    return normalize(vec3(cos(phi) * s, cos(theta), sin(phi) * s));
  }
`;

const MOON_BAKE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const MOON_BAKE_DATA_FRAG = /* glsl */ `
  varying vec2 vUv;
  ${MOON_COMMON_GLSL}
  ${EQUIRECT_DIR_GLSL}

  void main() {
    vec3 dir = uvToDir(vUv);
    vec3 mf = moonField(dir);
    float h0 = mf.x;
    float maria = mf.y;
    float ejecta = mf.z;

    vec3 mariaCol = vec3(0.24, 0.25, 0.28);
    vec3 highCol = vec3(0.68, 0.66, 0.62);
    vec3 albedo = mix(highCol, mariaCol, maria * 0.85);
    albedo = mix(albedo, vec3(0.86, 0.85, 0.83), ejecta * 0.72);

    float hEnc = clamp(h0 * 0.35 + 0.5, 0.0, 1.0);
    gl_FragColor = vec4(albedo, hEnc);
  }
`;

const MOON_BAKE_NORM_FRAG = /* glsl */ `
  varying vec2 vUv;
  ${MOON_COMMON_GLSL}
  ${EQUIRECT_DIR_GLSL}

  void main() {
    vec3 dir = uvToDir(vUv);
    float h0 = moonField(dir).x;

    float eps = 0.0045;
    vec3 up = abs(dir.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 t1 = normalize(cross(up, dir));
    vec3 t2 = normalize(cross(dir, t1));

    float dh1 = (moonField(normalize(dir + t1 * eps)).x - h0) / eps;
    float dh2 = (moonField(normalize(dir + t2 * eps)).x - h0) / eps;
    vec3 objN = normalize(dir - (t1 * dh1 + t2 * dh2) * 0.075);

    gl_FragColor = vec4(objN * 0.5 + 0.5, 1.0);
  }
`;

const DIR_TO_UV_GLSL = /* glsl */ `
  vec2 dirToUv(vec3 dir) {
    float u = fract(atan(dir.z, dir.x) / 6.28318530718);
    float v = 1.0 - acos(clamp(dir.y, -1.0, 1.0)) / 3.14159265359;
    return vec2(u, v);
  }
`;

const MOON_VERT = /* glsl */ `
  uniform sampler2D uDataMap;

  varying vec3 vObjDir;
  varying vec3 vWorldPos;
  varying vec3 vWorldNorm;

  ${DIR_TO_UV_GLSL}

  void main() {
    vec3 dir = normalize(position);
    float hEnc = texture2D(uDataMap, dirToUv(dir)).a;
    float h0 = (hEnc - 0.5) / 0.35;
    vec3 displaced = position + dir * (h0 * 0.62);

    vObjDir = dir;
    vec4 wp = modelMatrix * vec4(displaced, 1.0);
    vWorldPos = wp.xyz;
    vWorldNorm = normalize(mat3(modelMatrix) * dir);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const MOON_FRAG = /* glsl */ `
  uniform sampler2D uDataMap;
  uniform sampler2D uNormalMap;
  uniform vec3 uSunDir;
  uniform mat3 uNormalMatWorld;

  varying vec3 vObjDir;
  varying vec3 vWorldPos;
  varying vec3 vWorldNorm;

  ${DIR_TO_UV_GLSL}

  void main() {
    vec3 dir = normalize(vObjDir);
    vec2 eqUv = dirToUv(dir);
    vec3 albedo = texture2D(uDataMap, eqUv).rgb;
    vec3 objN = normalize(texture2D(uNormalMap, eqUv).xyz * 2.0 - 1.0);
    vec3 N = normalize(uNormalMatWorld * objN);

    vec3 L = normalize(uSunDir);
    vec3 V = normalize(cameraPosition - vWorldPos);

    // Lommel-Seeliger dusty regolith reflectance (zero plastic specular)
    float ndl = max(dot(N, L), 0.0);
    float ndv = max(dot(N, V), 0.05);
    float lommel = ndl / (ndl + ndv * 0.55 + 0.08);
    float macroNdl = smoothstep(-0.08, 0.14, dot(normalize(vWorldNorm), L));

    // Subtle cool blue Earthshine on the unlit lunar hemisphere
    vec3 earthshine = vec3(0.035, 0.06, 0.105) * (1.0 - macroNdl * 0.7);
    vec3 lit = albedo * (lommel * macroNdl * 1.65) + albedo * earthshine;

    gl_FragColor = vec4(lit, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// ============================================================================
// 2. Photorealistic 4K NASA Earth + Cloud Deck + Rayleigh Atmospheric Halo
// ============================================================================
const EARTH_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vWorldNorm;
  varying vec3 vWorldUp;

  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vWorldNorm = normalize(mat3(modelMatrix) * normal);
    vWorldUp = normalize(mat3(modelMatrix) * vec3(0.0, 1.0, 0.0));
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const EARTH_FRAG = /* glsl */ `
  uniform sampler2D uDayMap;
  uniform sampler2D uNightMap;
  uniform sampler2D uNormalMap;
  uniform sampler2D uSpecMap;
  uniform sampler2D uBrcMap;
  uniform float uSpace;
  uniform vec3 uSunDir;

  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vWorldNorm;
  varying vec3 vWorldUp;

  void main() {
    vec3 N = normalize(vWorldNorm);
    vec3 upAxis = normalize(vWorldUp);
    vec3 T = normalize(cross(upAxis, N));
    vec3 B = normalize(cross(N, T));

    vec3 mapN = texture2D(uNormalMap, vUv).xyz * 2.0 - 1.0;
    mapN.xy *= 0.85;
    vec3 surfN = normalize(T * mapN.x + B * mapN.y + N * mapN.z);

    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 L = normalize(uSunDir);

    vec3 dayCol = texture2D(uDayMap, vUv).rgb;
    vec3 nightCol = texture2D(uNightMap, vUv).rgb;
    float specMask = texture2D(uSpecMap, vUv).r;
    vec3 brc = texture2D(uBrcMap, vUv).rgb;
    float oceanRough = brc.g;

    // Cloud shadow cast slightly offset against solar vector
    float cloudCover = smoothstep(0.18, 0.85, texture2D(uBrcMap, vUv - vec2(0.0022, -0.0012)).b);
    float cloudShadow = 1.0 - cloudCover * 0.48;

    float macroNdl = dot(N, L);
    float detailNdl = max(dot(surfN, L), 0.0);
    float fresnel = pow(clamp(1.0 - max(dot(N, V), 0.0), 0.0, 1.0), 3.4);

    // Subtle aerial Rayleigh scatter near the day limb + warm sunset terminator
    float terminatorBand = exp(-pow((macroNdl - 0.04) * 5.2, 2.0));
    vec3 sunTint = mix(vec3(1.0), vec3(1.18, 0.62, 0.34), terminatorBand * 0.72);
    vec3 litDay = dayCol * (0.015 + detailNdl * 1.38 * cloudShadow) * sunTint;
    litDay = mix(litDay, vec3(0.32, 0.62, 0.96) * (0.18 + detailNdl), fresnel * 0.42);

    // Crisp ocean specular sun glint
    vec3 H = normalize(L + V);
    float shininess = mix(95.0, 28.0, oceanRough);
    float spec = pow(max(dot(surfN, H), 0.0), shininess) * specMask * cloudShadow * smoothstep(-0.05, 0.25, macroNdl) * 0.85;

    // Golden metropolitan lights on the night hemisphere
    float nightMask = smoothstep(0.18, -0.18, macroNdl);
    vec3 nightLights = nightCol * nightMask * (1.0 - cloudCover * 0.55) * 1.45;

    vec3 col = litDay + vec3(1.0, 0.92, 0.80) * spec + nightLights;
    col += vec3(0.24, 0.62, 1.0) * fresnel * smoothstep(-0.25, 0.55, macroNdl) * 0.68;

    gl_FragColor = vec4(col, uSpace);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const EARTH_CLOUDS_FRAG = /* glsl */ `
  uniform sampler2D uBrcMap;
  uniform float uTime;
  uniform float uSpace;
  uniform vec3 uSunDir;

  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vWorldNorm;
  varying vec3 vWorldUp;

  void main() {
    vec3 N = normalize(vWorldNorm);
    vec3 L = normalize(uSunDir);

    // Dual-layer cloud drift + soft hurricane swirl near northern ocean basin
    vec2 cycCenter = vec2(0.41, 0.68);
    vec2 dc = vUv - cycCenter;
    float dCyc = length(dc * vec2(1.6, 1.0));
    float ang = exp(-dCyc * 9.0) * 1.8;
    float cs = cos(ang);
    float sn = sin(ang);
    vec2 swirlUv = cycCenter + mat2(cs, -sn, sn, cs) * dc;

    float c0 = texture2D(uBrcMap, vUv + vec2(uTime * 0.0012, 0.0)).b;
    float c1 = texture2D(uBrcMap, swirlUv + vec2(uTime * 0.0020, 0.004)).b;
    float cloud = smoothstep(0.16, 0.86, mix(c0, c1, 0.45));

    float ndl = dot(N, L);
    float dayTerm = smoothstep(-0.14, 0.35, ndl);
    float sunset = exp(-pow((ndl - 0.02) * 5.0, 2.0));

    vec3 nightCloud = vec3(0.025, 0.045, 0.085);
    vec3 dayCloud = vec3(0.96, 0.98, 1.0) * (0.18 + max(ndl, 0.0) * 1.05);
    vec3 col = mix(nightCloud, dayCloud, dayTerm);
    col = mix(col, vec3(0.98, 0.56, 0.34), sunset * 0.38 * cloud);

    gl_FragColor = vec4(col, cloud * 0.84 * uSpace);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const EARTH_ATMOS_VERT = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vWorldNorm;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vWorldNorm = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const EARTH_ATMOS_FRAG = /* glsl */ `
  uniform float uSpace;
  uniform vec3 uSunDir;
  varying vec3 vWorldPos;
  varying vec3 vWorldNorm;

  void main() {
    vec3 N = normalize(vWorldNorm);
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 L = normalize(uSunDir);

    float rim = clamp(0.65 - dot(N, V), 0.0, 1.0);
    float glow = pow(rim, 3.2);
    float sunFacing = smoothstep(-0.35, 0.65, dot(-N, L));
    vec3 rayleigh = mix(vec3(0.14, 0.42, 0.92), vec3(0.55, 0.82, 1.0), glow);

    gl_FragColor = vec4(rayleigh * glow * (0.28 + sunFacing * 0.95) * uSpace, glow * uSpace);
  }
`;

// ============================================================================
// 3. Twilight Storm Sky Dome
// ============================================================================
const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uStorm;
  uniform float uSpace;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;

  varying vec3 vDir;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0; float a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.04; a *= 0.5; }
    return v;
  }

  void main() {
    vec3 dir = normalize(vDir);
    float elev = clamp(dir.y, 0.0, 1.0);
    vec3 col = mix(uHorizon, uZenith, pow(elev, 0.55));

    // Warm copper-amber twilight sunset glow along western horizon
    float dusk = pow(max(dot(dir, normalize(vec3(-0.62, 0.10, 0.72))), 0.0), 4.5);
    col += vec3(0.55, 0.30, 0.20) * dusk * (1.0 - uStorm * 0.65) * (1.0 - uSpace);

    // Milky Way band faintly visible in deep space
    if (uSpace > 0.05) {
      float band = exp(-pow((dir.y - 0.35 + dir.x * 0.4) * 3.8, 2.0));
      float dust = fbm(dir.xz * 4.5 + dir.xy * 2.0);
      col += vec3(0.04, 0.07, 0.14) * band * dust * uSpace;
    }

    // Layered storm clouds in atmospheric view
    if (dir.y > 0.01 && uSpace < 0.98) {
      vec2 cuv = dir.xz / (dir.y + 0.22);
      float c = fbm(cuv * 1.15 + vec2(uTime * 0.02, -uTime * 0.028));
      float mask = smoothstep(0.36 - uStorm * 0.16, 0.82, c) * smoothstep(0.01, 0.22, dir.y);
      vec3 cloudCol = mix(vec3(0.20, 0.26, 0.36), vec3(0.06, 0.09, 0.15), uStorm);
      col = mix(col, cloudCol, mask * (0.48 + 0.42 * uStorm) * (1.0 - uSpace));
    }

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface SkyAndMoonWorld {
  group: THREE.Group;
  skyZenith: THREE.Color;
  skyHorizon: THREE.Color;
  fogColor: THREE.Color;
  fogDensity: number;
  update(dt: number, time: number, camPos: THREE.Vector3, spaceFactor: number, storm: number): void;
}

export function createSkyAndMoonWorld(renderer: THREE.WebGLRenderer): SkyAndMoonWorld {
  const group = new THREE.Group();
  const skyZenith = new THREE.Color('#0a1528');
  const skyHorizon = new THREE.Color('#273f5e');
  const fogColor = new THREE.Color('#16263d');

  // 1. Sky Dome
  const skyMat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uStorm: { value: 0.2 },
      uSpace: { value: 1 },
      uZenith: { value: skyZenith },
      uHorizon: { value: skyHorizon },
    },
  });
  const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(980, 32, 20), skyMat);
  group.add(skyMesh);

  // 2. Seamless 3D Procedural Moon — baked once on GPU into 1024x512 equirectangular maps
  const bakeOpts: THREE.RenderTargetOptions = {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    generateMipmaps: false,
    depthBuffer: false,
    stencilBuffer: false,
  };
  const moonDataRT = new THREE.WebGLRenderTarget(2048, 1024, bakeOpts);
  const moonNormRT = new THREE.WebGLRenderTarget(2048, 1024, bakeOpts);
  const bakeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const bakeQuadGeo = new THREE.PlaneGeometry(2, 2);
  const bakeDataMat = new THREE.ShaderMaterial({ vertexShader: MOON_BAKE_VERT, fragmentShader: MOON_BAKE_DATA_FRAG });
  const bakeNormMat = new THREE.ShaderMaterial({ vertexShader: MOON_BAKE_VERT, fragmentShader: MOON_BAKE_NORM_FRAG });
  const bakeMesh = new THREE.Mesh(bakeQuadGeo, bakeDataMat);
  const bakeScene = new THREE.Scene();
  bakeScene.add(bakeMesh);

  const prevRT = renderer.getRenderTarget();
  renderer.setRenderTarget(moonDataRT);
  renderer.render(bakeScene, bakeCam);
  bakeMesh.material = bakeNormMat;
  renderer.setRenderTarget(moonNormRT);
  renderer.render(bakeScene, bakeCam);
  renderer.setRenderTarget(prevRT);

  bakeQuadGeo.dispose();
  bakeDataMat.dispose();
  bakeNormMat.dispose();

  const moonSunDir = new THREE.Vector3(0.86, 0.34, 0.38).normalize();
  const moonMat = new THREE.ShaderMaterial({
    vertexShader: MOON_VERT,
    fragmentShader: MOON_FRAG,
    uniforms: {
      uDataMap: { value: moonDataRT.texture },
      uNormalMap: { value: moonNormRT.texture },
      uSunDir: { value: moonSunDir },
      uNormalMatWorld: { value: new THREE.Matrix3() },
    },
  });
  const moonMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(25.5, 56), moonMat);
  moonMesh.position.set(24, 520, -45);
  group.add(moonMesh);

  // 3. Photorealistic 4K NASA Planet Earth + 3D Cloud Deck + Rayleigh Atmosphere + Tidal Bulge
  const maxAniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  const texLoader = new THREE.TextureLoader();
  const loadPlanetTex = (path: string, isSRGB: boolean) => {
    const t = texLoader.load(path);
    t.anisotropy = maxAniso;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    if (isSRGB) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };

  const earthDayTex = loadPlanetTex('/textures/earth/earth_day_4096.jpg', true);
  const earthNightTex = loadPlanetTex('/textures/earth/earth_night_4096.jpg', true);
  const earthBrcTex = loadPlanetTex('/textures/earth/earth_bump_roughness_clouds_4096.jpg', false);
  const earthNormalTex = loadPlanetTex('/textures/earth/earth_normal_2048.jpg', false);
  const earthSpecTex = loadPlanetTex('/textures/earth/earth_specular_2048.jpg', false);

  const earthMat = new THREE.ShaderMaterial({
    vertexShader: EARTH_VERT,
    fragmentShader: EARTH_FRAG,
    transparent: true,
    uniforms: {
      uDayMap: { value: earthDayTex },
      uNightMap: { value: earthNightTex },
      uNormalMap: { value: earthNormalTex },
      uSpecMap: { value: earthSpecTex },
      uBrcMap: { value: earthBrcTex },
      uSpace: { value: 1 },
      uSunDir: { value: moonSunDir },
    },
  });
  const earthMesh = new THREE.Mesh(new THREE.SphereGeometry(184, 128, 96), earthMat);
  earthMesh.position.set(-10, 296, -28);
  earthMesh.rotation.set(0.32, -1.35, 0.08);
  group.add(earthMesh);

  const cloudsMat = new THREE.ShaderMaterial({
    vertexShader: EARTH_VERT,
    fragmentShader: EARTH_CLOUDS_FRAG,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uBrcMap: { value: earthBrcTex },
      uTime: { value: 0 },
      uSpace: { value: 1 },
      uSunDir: { value: moonSunDir },
    },
  });
  const earthCloudsMesh = new THREE.Mesh(new THREE.SphereGeometry(185.5, 128, 96), cloudsMat);
  earthCloudsMesh.position.copy(earthMesh.position);
  earthCloudsMesh.rotation.copy(earthMesh.rotation);
  group.add(earthCloudsMesh);

  const atmosMat = new THREE.ShaderMaterial({
    vertexShader: EARTH_ATMOS_VERT,
    fragmentShader: EARTH_ATMOS_FRAG,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uSpace: { value: 1 },
      uSunDir: { value: moonSunDir },
    },
  });
  const earthAtmosMesh = new THREE.Mesh(new THREE.SphereGeometry(193.5, 96, 64), atmosMat);
  earthAtmosMesh.position.copy(earthMesh.position);
  group.add(earthAtmosMesh);

  // Subtle translucent tidal bulge shell rising toward the Moon
  const bulgeMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uSpace: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNorm;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNorm = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uSpace;
      varying vec3 vNorm;
      varying vec3 vView;
      void main() {
        float fres = pow(clamp(1.0 - abs(dot(vNorm, vView)), 0.0, 1.0), 3.0);
        float pulse = 0.8 + 0.2 * sin(uTime * 1.9);
        vec3 col = mix(vec3(0.12, 0.62, 0.96), vec3(0.55, 0.92, 1.0), fres);
        gl_FragColor = vec4(col, (0.02 + fres * 0.34) * pulse * uSpace);
      }
    `,
  });
  const bulgeMesh = new THREE.Mesh(new THREE.SphereGeometry(189.2, 72, 44, 0, Math.PI * 2, 0, Math.PI * 0.42), bulgeMat);
  bulgeMesh.position.set(-5, 298, -30);
  bulgeMesh.scale.set(1.0, 1.045, 1.0);
  group.add(bulgeMesh);

  // 4. Multi-Color Soft-Sprite Starfield (4,500 stars)
  const starCount = 4500;
  const sPos = new Float32Array(starCount * 3);
  const sCol = new Float32Array(starCount * 3);
  const rand = rng(5150);
  const starPalette = [
    new THREE.Color('#dbeafe'),
    new THREE.Color('#ffffff'),
    new THREE.Color('#fef3c7'),
    new THREE.Color('#bfdbfe'),
  ];
  for (let i = 0; i < starCount; i++) {
    const th = rand() * Math.PI * 2;
    const ph = Math.acos(rand() * 0.92 + 0.08);
    const r = 680 + rand() * 200;
    sPos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    sPos[i * 3 + 1] = 270 + r * Math.cos(ph) * 0.75;
    sPos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    const c = starPalette[i % starPalette.length];
    sCol[i * 3] = c.r;
    sCol[i * 3 + 1] = c.g;
    sCol[i * 3 + 2] = c.b;
  }
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  sGeo.setAttribute('color', new THREE.BufferAttribute(sCol, 3));
  const glowTex = makeGlowTexture();
  const starMat = new THREE.PointsMaterial({
    size: 3.4,
    map: glowTex,
    vertexColors: true,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const stars = new THREE.Points(sGeo, starMat);
  group.add(stars);

  // 5. Twilight Cloud-Deck Layer (y = 185..245) passed during Space -> City dive
  const cloudCount = 65;
  const cPos = new Float32Array(cloudCount * 3);
  for (let i = 0; i < cloudCount; i++) {
    cPos[i * 3] = (rand() - 0.5) * 320;
    cPos[i * 3 + 1] = 175 + rand() * 85;
    cPos[i * 3 + 2] = (rand() - 0.5) * 320;
  }
  const cGeo = new THREE.BufferGeometry();
  cGeo.setAttribute('position', new THREE.BufferAttribute(cPos, 3));
  const cloudDeckMat = new THREE.PointsMaterial({
    size: 135,
    map: glowTex,
    color: '#475e7d',
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
  });
  const cloudDeck = new THREE.Points(cGeo, cloudDeckMat);
  group.add(cloudDeck);

  // 6. Slanted Storm Rain (strictly hidden in space or calm weather!)
  const rainCount = 6500;
  const rainPos = new Float32Array(rainCount * 6);
  const rainSpeeds = new Float32Array(rainCount);
  for (let i = 0; i < rainCount; i++) {
    const x = (rand() - 0.5) * 145;
    const y = rand() * 78;
    const z = (rand() - 0.5) * 145;
    rainSpeeds[i] = 40 + rand() * 18;
    rainPos[i * 6] = x;
    rainPos[i * 6 + 1] = y;
    rainPos[i * 6 + 2] = z;
    rainPos[i * 6 + 3] = x - 0.25;
    rainPos[i * 6 + 4] = y + 1.65;
    rainPos[i * 6 + 5] = z - 0.15;
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rainMat = new THREE.LineBasicMaterial({ color: '#cbd5e1', transparent: true, opacity: 0.34 });
  const rainLines = new THREE.LineSegments(rainGeo, rainMat);
  rainLines.frustumCulled = false;
  group.add(rainLines);

  const normMat3 = new THREE.Matrix3();

  const world: SkyAndMoonWorld = {
    group,
    skyZenith,
    skyHorizon,
    fogColor,
    fogDensity: 0.0024,
    update(dt: number, time: number, camPos: THREE.Vector3, spaceFactor: number, storm: number) {
      const inSpace = spaceFactor > 0.01;
      moonMesh.visible = inSpace;
      if (inSpace) {
        moonMesh.rotation.y += dt * 0.032;
        moonMesh.updateMatrixWorld();
        normMat3.getNormalMatrix(moonMesh.matrixWorld);
        moonMat.uniforms.uNormalMatWorld.value.copy(normMat3);
      }

      earthMesh.visible = inSpace;
      earthCloudsMesh.visible = inSpace;
      earthAtmosMesh.visible = inSpace;
      bulgeMesh.visible = inSpace;
      if (inSpace) {
        earthMesh.rotation.y += dt * 0.006;
        earthMat.uniforms.uSpace.value = spaceFactor;

        earthCloudsMesh.rotation.y += dt * 0.011;
        cloudsMat.uniforms.uTime.value = time;
        cloudsMat.uniforms.uSpace.value = spaceFactor;

        atmosMat.uniforms.uSpace.value = spaceFactor;

        bulgeMat.uniforms.uTime.value = time;
        bulgeMat.uniforms.uSpace.value = spaceFactor;
      }

      // Cloud deck fades smoothly once below 150m
      const cloudVis = camPos.y > 115 && spaceFactor < 0.92;
      cloudDeck.visible = cloudVis;
      cloudDeckMat.opacity = cloudVis ? 0.16 * (1 - spaceFactor * 0.7) : 0;

      skyMesh.position.copy(camPos);

      const cityZenith = new THREE.Color('#0c182e').lerp(new THREE.Color('#07101e'), storm);
      const cityHorizon = new THREE.Color('#324b6e').lerp(new THREE.Color('#182436'), storm);
      const spaceDark = new THREE.Color('#010308');

      skyZenith.copy(cityZenith).lerp(spaceDark, spaceFactor);
      skyHorizon.copy(cityHorizon).lerp(new THREE.Color('#030710'), spaceFactor);
      fogColor.copy(skyHorizon);
      this.fogDensity = THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(0.002, 0.0036, storm),
        0.00014,
        spaceFactor
      );

      skyMat.uniforms.uTime.value = time;
      skyMat.uniforms.uStorm.value = storm;
      skyMat.uniforms.uSpace.value = spaceFactor;

      starMat.opacity = Math.max(0.0, spaceFactor * 0.95);
      stars.visible = starMat.opacity > 0.02;

      // Rain ONLY below 105m altitude and when storm > 0.05
      const showRain = storm > 0.05 && camPos.y < 105 && spaceFactor < 0.12;
      rainLines.visible = showRain;
      if (showRain) {
        rainMat.opacity = storm * 0.34;
        const boxW = 145;
        const boxH = 78;
        const minX = camPos.x - boxW * 0.5;
        const maxX = camPos.x + boxW * 0.5;
        const minZ = camPos.z - boxW * 0.5;
        const maxZ = camPos.z + boxW * 0.5;
        const minY = Math.max(-2, camPos.y - 35);
        const maxY = minY + boxH;

        const wx = 8.5;
        const wz = 4.5;
        const active = Math.floor(rainCount * storm);
        rainGeo.setDrawRange(0, active * 2);

        for (let i = 0; i < active; i++) {
          const idx = i * 6;
          const spd = rainSpeeds[i];
          let x = rainPos[idx] + wx * dt;
          let y = rainPos[idx + 1] - spd * dt;
          let z = rainPos[idx + 2] + wz * dt;
          if (y < minY) y += boxH;
          if (y > maxY) y -= boxH;
          if (x < minX) x += boxW;
          if (x > maxX) x -= boxW;
          if (z < minZ) z += boxW;
          if (z > maxZ) z -= boxW;
          rainPos[idx] = x;
          rainPos[idx + 1] = y;
          rainPos[idx + 2] = z;
          rainPos[idx + 3] = x - wx * 0.04;
          rainPos[idx + 4] = y + spd * 0.04;
          rainPos[idx + 5] = z - wz * 0.04;
        }
        (rainGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      }
    },
  };

  return world;
}
