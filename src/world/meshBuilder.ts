import * as THREE from 'three';

export type V3 = [number, number, number];
export type V2 = [number, number];

export class MeshBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];

  tri(a: V3, b: V3, c: V3, ua: V2 = [0, 0], ub: V2 = [1, 0], uc: V2 = [1, 1]): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (const [p, t] of [[a, ua], [b, ub], [c, uc]] as [V3, V2][]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(nx, ny, nz);
      this.uv.push(t[0], t[1]);
    }
  }

  quad(a: V3, b: V3, c: V3, d: V3, ua: V2 = [0, 0], ub: V2 = [1, 0], uc: V2 = [1, 1], ud: V2 = [0, 1]): void {
    this.tri(a, b, c, ua, ub, uc);
    this.tri(a, c, d, ua, uc, ud);
  }

  /** Quad oriented so that its normal points away from `ref`. */
  quadOut(a: V3, b: V3, c: V3, d: V3, ref: V3, s = 4): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const mx = (a[0] + c[0]) / 2 - ref[0], my = (a[1] + c[1]) / 2 - ref[1], mz = (a[2] + c[2]) / 2 - ref[2];
    const L = Math.hypot(ux, uy, uz) / s, H = Math.hypot(vx, vy, vz) / s;
    if (nx * mx + ny * my + nz * mz >= 0) this.quad(a, b, c, d, [0, 0], [L, 0], [L, H], [0, H]);
    else this.quad(a, d, c, b, [0, 0], [0, H], [L, H], [L, 0]);
  }

  /** Axis box (optionally rotated about Y) with all 6 faces. */
  box(cx: number, y0: number, cz: number, w: number, h: number, d: number, rot = 0, s = 4): void {
    const C = corners(cx, cz, w, d, rot);
    const y1 = y0 + h;
    const ref: V3 = [cx, y0 + h / 2, cz];
    for (let i = 0; i < 4; i++) {
      const a = C[i], b = C[(i + 1) % 4];
      this.quadOut([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], ref, s);
    }
    this.quadOut([C[0][0], y1, C[0][1]], [C[1][0], y1, C[1][1]], [C[2][0], y1, C[2][1]], [C[3][0], y1, C[3][1]], ref, s);
    this.quadOut([C[0][0], y0, C[0][1]], [C[1][0], y0, C[1][1]], [C[2][0], y0, C[2][1]], [C[3][0], y0, C[3][1]], ref, s);
  }

  /** Square beam between two points. */
  beam(a: THREE.Vector3, b: THREE.Vector3, t: number): void {
    const dir = b.clone().sub(a).normalize();
    const up = Math.abs(dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const s1 = new THREE.Vector3().crossVectors(dir, up).normalize().multiplyScalar(t / 2);
    const s2 = new THREE.Vector3().crossVectors(s1, dir).normalize().multiplyScalar(t / 2);
    const P = (base: THREE.Vector3, i: number, j: number): V3 => {
      const v = base.clone().addScaledVector(s1, i).addScaledVector(s2, j);
      return [v.x, v.y, v.z];
    };
    const m = a.clone().add(b).multiplyScalar(0.5);
    const ref: V3 = [m.x, m.y, m.z];
    const sq: [number, number][] = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    for (let k = 0; k < 4; k++) {
      const [i0, j0] = sq[k], [i1, j1] = sq[(k + 1) % 4];
      this.quadOut(P(a, i0, j0), P(a, i1, j1), P(b, i1, j1), P(b, i0, j0), ref);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}

export function corners(cx: number, cz: number, w: number, d: number, rot: number): [number, number][] {
  const c = Math.cos(rot), s = Math.sin(rot);
  return [[-w / 2, d / 2], [w / 2, d / 2], [w / 2, -d / 2], [-w / 2, -d / 2]].map(([lx, lz]) => [
    cx + lx * c + lz * s,
    cz - lx * s + lz * c,
  ]) as [number, number][];
}

export function mesh(mb: MeshBuilder, mat: THREE.Material, shadows = true): THREE.Mesh {
  const m = new THREE.Mesh(mb.build(), mat);
  m.castShadow = shadows;
  m.receiveShadow = true;
  return m;
}
