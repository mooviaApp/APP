/**
 * Matrix 15x15 Helper for ESKF
 * Optimized for ESKF operations on mobile devices.
 * Uses Flat Float64Arrays.
 */

export class Mat15 {
    // Row-major data: [r0c0, r0c1, ... r0c14, r1c0, ...]
    data: Float64Array;

    constructor() {
        this.data = new Float64Array(15 * 15);
    }

    static identity(): Mat15 {
        const m = new Mat15();
        for (let i = 0; i < 15; i++) m.data[i * 15 + i] = 1.0;
        return m;
    }

    static zero(): Mat15 {
        return new Mat15();
    }

    set(r: number, c: number, val: number) {
        this.data[r * 15 + c] = val;
    }

    get(r: number, c: number): number {
        return this.data[r * 15 + c];
    }

    /**
     * Multiply this (15x15) by B (15x15) -> Result (15x15)
     * C = A * B
     */
    multiply(B: Mat15): Mat15 {
        const C = new Mat15();
        const a = this.data;
        const b = B.data;
        const c = C.data;

        for (let i = 0; i < 15; i++) {
            const rowOffset = i * 15;
            for (let j = 0; j < 15; j++) {
                let sum = 0;
                for (let k = 0; k < 15; k++) {
                    sum += a[rowOffset + k] * b[k * 15 + j];
                }
                c[rowOffset + j] = sum;
            }
        }
        return C;
    }

    /**
     * Compute P_new = F * P * F^T
     * Optimized slightly by doing (F*P) then * F^T
     */
    multiplyFPFt(P: Mat15): Mat15 {
        // Temp = F * P
        const Temp = this.multiply(P);

        // Result = Temp * F^T
        // Explicit loop for F^T multiply to avoid allocating F^T
        const Res = new Mat15();
        const t = Temp.data;
        const f = this.data; // F
        const r = Res.data;

        for (let i = 0; i < 15; i++) {
            const rowOffset = i * 15;
            for (let j = 0; j < 15; j++) {
                let sum = 0;
                // Col j of F^T is Row j of F
                const fRowOffset = j * 15;
                for (let k = 0; k < 15; k++) {
                    sum += t[rowOffset + k] * f[fRowOffset + k];
                }
                r[rowOffset + j] = sum;
            }
        }
        return Res;
    }

    add(B: Mat15): Mat15 {
        const C = new Mat15();
        for (let i = 0; i < 225; i++) C.data[i] = this.data[i] + B.data[i];
        return C;
    }

    /**
     * Add Q to diagonal (Process Noise)
     */
    addDiagonal(diag: number[]) {
        for (let i = 0; i < 15; i++) {
            if (i < diag.length) this.data[i * 15 + i] += diag[i];
        }
    }
}
