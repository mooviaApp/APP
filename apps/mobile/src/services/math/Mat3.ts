/**
 * Lightweight 3x3 Matrix Library
 * Optimized for ESKF operations on mobile devices.
 * Avoids overhead of large linear algebra libraries.
 */

export class Mat3 {
    // Row-major data: [r0c0, r0c1, r0c2, r1c0, ...]
    data: Float64Array;

    constructor(values?: number[]) {
        if (values && values.length === 9) {
            this.data = new Float64Array(values);
        } else {
            this.data = new Float64Array(9); // Zero matrix
        }
    }

    static identity(): Mat3 {
        return new Mat3([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    }

    static zero(): Mat3 {
        return new Mat3([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    }

    static fromDiagonal(d: number[]): Mat3 {
        return new Mat3([d[0], 0, 0, 0, d[1], 0, 0, 0, d[2]]);
    }

    clone(): Mat3 {
        const m = new Mat3();
        m.data.set(this.data);
        return m;
    }

    // Accessors
    get(r: number, c: number): number { return this.data[r * 3 + c]; }
    set(r: number, c: number, val: number) { this.data[r * 3 + c] = val; }

    // Operations
    add(m: Mat3): Mat3 {
        const out = new Mat3();
        for (let i = 0; i < 9; i++) out.data[i] = this.data[i] + m.data[i];
        return out;
    }

    scale(s: number): Mat3 {
        const out = new Mat3();
        for (let i = 0; i < 9; i++) out.data[i] = this.data[i] * s;
        return out;
    }

    sub(m: Mat3): Mat3 {
        const out = new Mat3();
        for (let i = 0; i < 9; i++) out.data[i] = this.data[i] - m.data[i];
        return out;
    }

    multiply(m: Mat3): Mat3 {
        const out = new Mat3();
        const a = this.data, b = m.data, r = out.data;
        // Row 0
        r[0] = a[0] * b[0] + a[1] * b[3] + a[2] * b[6];
        r[1] = a[0] * b[1] + a[1] * b[4] + a[2] * b[7];
        r[2] = a[0] * b[2] + a[1] * b[5] + a[2] * b[8];
        // Row 1
        r[3] = a[3] * b[0] + a[4] * b[3] + a[5] * b[6];
        r[4] = a[3] * b[1] + a[4] * b[4] + a[5] * b[7];
        r[5] = a[3] * b[2] + a[4] * b[5] + a[5] * b[8];
        // Row 2
        r[6] = a[6] * b[0] + a[7] * b[3] + a[8] * b[6];
        r[7] = a[6] * b[1] + a[7] * b[4] + a[8] * b[7];
        r[8] = a[6] * b[2] + a[7] * b[5] + a[8] * b[8];
        return out;
    }

    // Matrix-Vector multiplication
    multiplyVec(v: { x: number, y: number, z: number }): { x: number, y: number, z: number } {
        const d = this.data;
        return {
            x: d[0] * v.x + d[1] * v.y + d[2] * v.z,
            y: d[3] * v.x + d[4] * v.y + d[5] * v.z,
            z: d[6] * v.x + d[7] * v.y + d[8] * v.z
        };
    }

    transpose(): Mat3 {
        return new Mat3([
            this.data[0], this.data[3], this.data[6],
            this.data[1], this.data[4], this.data[7],
            this.data[2], this.data[5], this.data[8]
        ]);
    }

    determinant(): number {
        const d = this.data;
        return d[0] * (d[4] * d[8] - d[5] * d[7]) -
            d[1] * (d[3] * d[8] - d[5] * d[6]) +
            d[2] * (d[3] * d[7] - d[4] * d[6]);
    }

    invert(): Mat3 {
        const det = this.determinant();
        if (Math.abs(det) < 1e-10) {
            console.error("Mat3: Singular matrix, returning identity");
            return Mat3.identity();
        }
        const invDet = 1.0 / det;
        const d = this.data;
        const out = new Mat3();
        const r = out.data;

        r[0] = (d[4] * d[8] - d[5] * d[7]) * invDet;
        r[1] = (d[2] * d[7] - d[1] * d[8]) * invDet;
        r[2] = (d[1] * d[5] - d[2] * d[4]) * invDet;
        r[3] = (d[5] * d[6] - d[3] * d[8]) * invDet;
        r[4] = (d[0] * d[8] - d[2] * d[6]) * invDet;
        r[5] = (d[2] * d[3] - d[0] * d[5]) * invDet;
        r[6] = (d[3] * d[7] - d[4] * d[6]) * invDet;
        r[7] = (d[1] * d[6] - d[0] * d[7]) * invDet;
        r[8] = (d[0] * d[4] - d[1] * d[3]) * invDet;
        return out;
    }

    // Skew-symmetric matrix from vector (for cross product logic)
    static skewSymmetric(v: { x: number, y: number, z: number }): Mat3 {
        return new Mat3([
            0, -v.z, v.y,
            v.z, 0, -v.x,
            -v.y, v.x, 0
        ]);
    }
}
