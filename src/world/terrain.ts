// Shared world layout + analytic terrain (identical in TS and GLSL).
export const COAST_Z = 70;
export const CH = 13; // river channel half-width
export const WALL_D = 13.9; // distance of river walls from river centre
export const INNER = 180;
export const PARAPET_TOP = 2.3;
export const COAST_WALL_TOP = 5.4;
export const BANK_BASE = 1.75;
export const RIVER_WALL_TOP = 5.0;
export const NORMAL_SEA = 0.3;
export const ROAD_HALF = 4;

export const ZS = [-150, -120, -90, -60, -30, 0, 30, 60];
export const XS = [-144, -112, -80, -48, 48, 80, 112, 144];
export const BRIDGES_Z = [-120, -60, 0];

export interface Rect { x0: number; x1: number; z0: number; z1: number }
export const PARK_RES: Rect = { x0: 52, x1: 108, z0: -56, z1: -4 };
export const CUT = { x0: 60, x1: 100, z0: -50, z1: -12, bottom: -30 };
export const PARK_W: Rect = { x0: 15, x1: 42, z0: -114, z1: -66 };
export const BARRIER_ZONE: Rect = { x0: -46, x1: 74, z0: 24, z1: 72 };
export const PORT: Rect = { x0: 60, x1: 156, z0: 34, z1: 68 };

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const inRect = (r: Rect, x: number, z: number, m = 0) =>
  x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m;

export function riverX(z: number): number {
  return 14 * Math.sin(z * 0.016 + 0.6);
}

// Storm-surge barrier geometry (two radial gates, Maeslant-style)
export const BAR = { rc: riverX(56), poff: 22, pz: 38, r: 27.2 };

export function groundBase(x: number, z: number): number {
  let g = 1.6 + Math.max(0, COAST_Z - z) * 0.011;
  g += smoothstep(150, 420, Math.abs(x)) * 40;
  g += (1 - smoothstep(-420, -175, z)) * 35;
  return g;
}

export function terrainHeight(x: number, z: number): number {
  const g = groundBase(x, z);
  const d = Math.abs(x - riverX(z));
  const bank = smoothstep(CH - 1.2, CH + 0.4, d);
  const h = -3.5 + (g + 3.5) * bank;
  const sea = smoothstep(COAST_Z - 0.3, COAST_Z + 1.2, z);
  const floor = -7 - clamp((z - COAST_Z) / 80, 0, 1) * 6;
  return h + (floor - h) * sea;
}

export const TERRAIN_GLSL = /* glsl */ `
float riverX(float z){ return 14.0*sin(z*0.016+0.6); }
float groundBase(vec2 p){
  float g = 1.6 + max(0.0, 70.0 - p.y) * 0.011;
  g += smoothstep(150.0, 420.0, abs(p.x)) * 40.0;
  g += (1.0 - smoothstep(-420.0, -175.0, p.y)) * 35.0;
  return g;
}
float terrainH(vec2 p){
  float g = groundBase(p);
  float d = abs(p.x - riverX(p.y));
  float bank = smoothstep(11.8, 13.4, d);
  float h = -3.5 + (g + 3.5) * bank;
  float sea = smoothstep(69.7, 71.2, p.y);
  float fl = -7.0 - clamp((p.y - 70.0) / 80.0, 0.0, 1.0) * 6.0;
  return mix(h, fl, sea);
}
// 0 = land, 1 = river (inside barrier), 2 = sea
float zoneAt(vec2 p){
  if (p.y > 69.2) return 2.0;
  float d = abs(p.x - riverX(p.y));
  if (d < 13.9) {
    float u = abs(p.x - ${BAR.rc.toFixed(4)});
    float dx = ${BAR.poff.toFixed(1)} - u;
    float gz = ${BAR.pz.toFixed(1)} + sqrt(max(${(BAR.r * BAR.r).toFixed(2)} - dx*dx, 0.0));
    return p.y > gz ? 2.0 : 1.0;
  }
  return 0.0;
}
`;
