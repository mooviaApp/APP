/**
 * Quaternion Math Utility
 */

import { Mat3 } from './Mat3';
import { Vec3, Vec3Math } from './Vec3';

export interface Quaternion {
    w: number;
    x: number;
    y: number;
    z: number;
}

export const QuatMath = {
    identity: (): Quaternion => ({ w: 1, x: 0, y: 0, z: 0 }),

    multiply: (a: Quaternion, b: Quaternion): Quaternion => ({
        w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
        x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w
    }),

    conjugate: (q: Quaternion): Quaternion => ({
        w: q.w, x: -q.x, y: -q.y, z: -q.z
    }),

    normalize: (q: Quaternion): Quaternion => {
        const norm = Math.sqrt(q.w * q.w + q.x * q.x + q.y * q.y + q.z * q.z);
        return norm > 0 ? { w: q.w / norm, x: q.x / norm, y: q.y / norm, z: q.z / norm } : { w: 1, x: 0, y: 0, z: 0 };
    },

    // Rotate vector v by quaternion q: v' = q * v * q_inv
    rotate: (q: Quaternion, v: Vec3): Vec3 => {
        const x = q.x, y = q.y, z = q.z, w = q.w;
        const ix = w * v.x + y * v.z - z * v.y;
        const iy = w * v.y + z * v.x - x * v.z;
        const iz = w * v.z + x * v.y - y * v.x;
        const iw = -x * v.x - y * v.y - z * v.z;

        return {
            x: ix * w + iw * -x + iy * -z - iz * -y,
            y: iy * w + iw * -y + iz * -x - ix * -z,
            z: iz * w + iw * -z + ix * -y - iy * -x
        };
    },

    /**
     * Convert Quaternion to Rotation Matrix (3x3)
     * R_wb (Body to World)
     */
    toRotationMatrix: (q: Quaternion): Mat3 => {
        const x = q.x, y = q.y, z = q.z, w = q.w;
        const x2 = x + x, y2 = y + y, z2 = z + z;
        const xx = x * x2, xy = x * y2, xz = x * z2;
        const yy = y * y2, yz = y * z2, zz = z * z2;
        const wx = w * x2, wy = w * y2, wz = w * z2;

        return new Mat3([
            1 - (yy + zz), xy - wz, xz + wy,
            xy + wz, 1 - (xx + zz), yz - wx,
            xz - wy, yz + wx, 1 - (xx + yy)
        ]);
    },

    /**
     * Integrate quaternion using angular velocity (omega)
     * q_new = q_old * exp(0.5 * omega * dt)
     * Approx: q_new = q_old + 0.5 * q_old * (0, omega) * dt
     */
    integrate: (q: Quaternion, omega: Vec3, dt: number): Quaternion => {
        const halfDt = 0.5 * dt;
        const qDot = {
            w: 0.5 * (-q.x * omega.x - q.y * omega.y - q.z * omega.z),
            x: 0.5 * (q.w * omega.x + q.y * omega.z - q.z * omega.y),
            y: 0.5 * (q.w * omega.y - q.x * omega.z + q.z * omega.x),
            z: 0.5 * (q.w * omega.z + q.x * omega.y - q.y * omega.x)
        };

        return QuatMath.normalize({
            w: q.w + qDot.w * dt,
            x: q.x + qDot.x * dt,
            y: q.y + qDot.y * dt,
            z: q.z + qDot.z * dt
        });
    },

    // Convert vector part of small error quaternion to full quaternion
    // dq = [1, 0.5 * dtheta]
    fromOneHalfTheta: (dtheta: Vec3): Quaternion => {
        return { w: 1, x: 0.5 * dtheta.x, y: 0.5 * dtheta.y, z: 0.5 * dtheta.z };
    },

    /**
     * Convert Quaternion to Euler Angles (Roll, Pitch, Yaw)
     * Convention: Z-Y-X (Yaw-Pitch-Roll)
     * Returns in Radians
     */
    toEuler: (q: Quaternion): Vec3 => {
        // roll (x-axis rotation)
        const sinr_cosp = 2 * (q.w * q.x + q.y * q.z);
        const cosr_cosp = 1 - 2 * (q.x * q.x + q.y * q.y);
        const roll = Math.atan2(sinr_cosp, cosr_cosp);

        // pitch (y-axis rotation)
        const sinp = 2 * (q.w * q.y - q.z * q.x);
        let pitch = 0;
        if (Math.abs(sinp) >= 1)
            pitch = Math.sign(sinp) * (Math.PI / 2); // use 90 degrees if out of range
        else
            pitch = Math.asin(sinp);

        // yaw (z-axis rotation)
        const siny_cosp = 2 * (q.w * q.z + q.x * q.y);
        const cosy_cosp = 1 - 2 * (q.y * q.y + q.z * q.z);
        const yaw = Math.atan2(siny_cosp, cosy_cosp);

        return { x: roll, y: pitch, z: yaw };
    },

    fromAxisAngle: (axis: Vec3, angle: number): Quaternion => {
        const halfAngle = angle * 0.5;
        const s = Math.sin(halfAngle);
        return {
            w: Math.cos(halfAngle),
            x: axis.x * s,
            y: axis.y * s,
            z: axis.z * s
        };
    }
};
