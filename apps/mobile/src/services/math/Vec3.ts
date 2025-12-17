/**
 * Vector3 Utility
 */

export interface Vec3 {
    x: number;
    y: number;
    z: number;
}

export const Vec3Math = {
    zero: (): Vec3 => ({ x: 0, y: 0, z: 0 }),

    add: (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),

    sub: (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),

    scale: (v: Vec3, s: number): Vec3 => ({ x: v.x * s, y: v.y * s, z: v.z * s }),

    dot: (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z,

    cross: (a: Vec3, b: Vec3): Vec3 => ({
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x
    }),

    norm: (v: Vec3): number => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z),

    normalize: (v: Vec3): Vec3 => {
        const n = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
        return n > 0 ? { x: v.x / n, y: v.y / n, z: v.z / n } : { x: 0, y: 0, z: 0 };
    },

    clone: (v: Vec3): Vec3 => ({ ...v })
};
