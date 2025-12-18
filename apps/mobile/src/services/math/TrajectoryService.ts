/**
 * Error-State Kalman Filter (ESKF) Trajectory Service
 * 
 * Replaces the previous Madgwick filter.
 * 
 * State Vector (Nominal, 16D):
 * - Position (p): 3
 * - Velocity (v): 3
 * - Orientation (q): 4
 * - Accel Bias (ab): 3
 * - Gyro Bias (gb): 3
 * 
 * Error State (15D):
 * - dp, dv, dtheta, dab, dgb
 */

import { IMUSample } from '../ble/constants';
import { Mat3 } from './Mat3';
import { Mat15 } from './Mat15';
import { Vec3, Vec3Math } from './Vec3';
import { Quaternion, QuatMath } from './QuaternionMath';

// Types covering the older service API
export interface TrajectoryPoint {
    timestamp: number;
    position: Vec3;
    rotation: Quaternion;
}

export class TrajectoryService {
    // --- Nominal State ---
    private p: Vec3 = { x: 0, y: 0, z: 0 };
    private v: Vec3 = { x: 0, y: 0, z: 0 };
    private q: Quaternion = { w: 1, x: 0, y: 0, z: 0 };
    private ab: Vec3 = { x: 0, y: 0, z: 0 };
    private gb: Vec3 = { x: 0, y: 0, z: 0 };

    // --- Error Covariance 15x15 ---
    // Stored as diagonal blocks to save space/ops, or flat array if needed.
    // For MVP, we will store full diagonal or key blocks.
    // Let's implement full flexible covariance logic is hard without a big matrix lib.
    // We will track the DIAGNOAL of P (15 floats) + interactions if critical.
    // User feedback suggested: "F depends on state... use simplified Jacobian".
    // 
    // To properly support updates, we really need the whole P matrix or at least the relevant blocks.
    // Given the 15x15 size (225 floats), a flat Float64Array is trivial for mobile.
    private P: Float64Array = new Float64Array(15 * 15);

    // --- Constants & Tuning ---
    private readonly GRAVITY_MAG = 9.81;
    private readonly GRAVITY: Vec3 = { x: 0, y: 0, z: this.GRAVITY_MAG }; // World Z is up? Assume Z up for now.

    // Process Noise (Continuous)
    private readonly NOISE_ACC = 0.2;  // m/s^2/sqrt(Hz)
    private readonly NOISE_GYR = 0.1;  // rad/s/sqrt(Hz)
    private readonly NOISE_ACC_BIAS = 0.001;
    private readonly NOISE_GYR_BIAS = 0.0001;

    // Measurement Noise
    private readonly MEAS_NOISE_ZUPT = 0.1; // m/s velocity uncertainty
    private readonly MEAS_NOISE_GRAVITY = 0.05; // rad tilt uncertainty

    // ZUPT Detection
    private readonly ZUPT_ACCEL_WIN = 0.25; // s
    private readonly REST_ACCEL_THR = 0.15; // g (deviation from 1g)
    private readonly REST_GYRO_THR = 0.1;   // rad/s
    private accelBuffer: number[] = [];
    private gyroBuffer: number[] = [];
    private readonly BUFFER_SIZE = 250; // assuming 1kHz -> 250ms

    // State
    private isCalibrating = false;
    private calibrationBuffer: IMUSample[] = [];
    private lastTimestamp = 0;
    private path: TrajectoryPoint[] = [];

    // Snapshot
    private liftSnapshot: TrajectoryPoint[] = [];

    constructor() {
        this.reset();
    }

    reset() {
        console.log('[ESKF] Resetting state...');
        this.p = Vec3Math.zero();
        this.v = Vec3Math.zero();
        this.q = QuatMath.identity();
        // Keep biases if already calibrated? For now, reset biases to last known valid calibration or zero
        // this.ab = Vec3Math.zero(); // Optional: keep calibrated bias?
        // this.gb = Vec3Math.zero();

        // Initialize P with small uncertainty
        this.P.fill(0);
        for (let i = 0; i < 15; i++) {
            this.P[i * 15 + i] = 0.01; // Initial uncertainty
        }

        this.path = [];
        this.lastTimestamp = 0;
        this.accelBuffer = [];
        this.gyroBuffer = [];
    }

    // --- Main Loop ---

    processSample(sample: IMUSample): TrajectoryPoint {
        const t = new Date(sample.timestamp).getTime();

        // Calibration Mode
        if (this.isCalibrating) {
            this.calibrationBuffer.push(sample);
            return { timestamp: t, position: Vec3Math.zero(), rotation: QuatMath.identity() };
        }

        if (this.lastTimestamp === 0) {
            this.lastTimestamp = t;
            return { timestamp: t, position: this.p, rotation: this.q };
        }

        const dt = (t - this.lastTimestamp) / 1000.0;
        if (dt <= 0) return this.getLastPoint(); // Duplicate sample
        this.lastTimestamp = t;

        // 1. Unpack Raw Measurements
        // Assume sample already scaled by decoder? Yes (g and dps) => Wait, decoder uses 'g' and 'dps'
        // We need m/s^2 and rad/s
        const a_meas: Vec3 = {
            x: sample.ax * 9.81,
            y: sample.ay * 9.81,
            z: sample.az * 9.81
        };
        const w_meas: Vec3 = {
            x: sample.gx * (Math.PI / 180),
            y: sample.gy * (Math.PI / 180),
            z: sample.gz * (Math.PI / 180)
        };

        // 2. Prediction Step (Integrate Nominal + Covariance)
        this.predict(a_meas, w_meas, dt);

        // 3. Stationary Detection (ZUPT Trigger)
        this.updateBuffers(a_meas, w_meas);
        const isStat = this.isStationary();
        if (isStat) {
            this.applyZUPT();
            this.applyGravityAlignment(a_meas);
        }

        // Debug Logs (every 50 samples ~ 0.5s)
        if (this.path.length % 50 === 0) {
            console.log(`[ESKF] t:${t / 1000} P:[${this.p.x.toFixed(3)},${this.p.y.toFixed(3)},${this.p.z.toFixed(3)}] V:[${this.v.x.toFixed(3)},${this.v.y.toFixed(3)},${this.v.z.toFixed(3)}] ZUPT:${isStat}`);
        }

        // 4. Save and Return Point
        const point: TrajectoryPoint = {
            timestamp: t,
            position: { ...this.p },
            rotation: { ...this.q }
        };
        this.path.push(point);
        return point;
    }

    // --- ESKF Prediction ---

    private predict(a_meas: Vec3, w_meas: Vec3, dt: number) {
        // Correct measurements with current bias estimates
        const a_hat = Vec3Math.sub(a_meas, this.ab);
        const w_hat = Vec3Math.sub(w_meas, this.gb);

        // 1. Nominal State Integration
        const R = QuatMath.toRotationMatrix(this.q);
        const acc_world = R.multiplyVec(a_hat);
        const acc_net = { x: acc_world.x, y: acc_world.y, z: acc_world.z - this.GRAVITY_MAG };

        this.p = Vec3Math.add(this.p, Vec3Math.add(Vec3Math.scale(this.v, dt), Vec3Math.scale(acc_net, 0.5 * dt * dt)));
        this.v = Vec3Math.add(this.v, Vec3Math.scale(acc_net, dt));
        this.q = QuatMath.integrate(this.q, w_hat, dt);

        // 2. Error State Transition Matrix (F) and Covariance Propagation
        // F is 15x15. We construct it explicitly.
        const F = Mat15.identity();

        // Block: dp/dv (Identity * dt)
        F.set(0, 3, dt); F.set(1, 4, dt); F.set(2, 5, dt);

        // Block: dv/dtheta (skew(R*a_hat) * dt) ?? No, it's -R * skew(a_hat) * dt
        // R_a_hat = R * a_hat
        const Ra_hat = R.multiplyVec(a_hat);
        // skew(Ra_hat)
        // [  0    -az   ay ]
        // [  az    0   -ax ]
        // [ -ay   ax    0  ]
        // But the term in error dynamics for v_dot error is -R * skew(a_hat) * dtheta (local error) ? 
        // Standard ESKF (Sola): v_dot_err = -R * skew(a_hat) * dtheta - R * da_b
        // Actually, skew(R * a_hat) is global frame. -skew(Ra_hat) * dtheta_global? 
        // Let's stick to standard error definitions: dtheta is GLOBAL error.
        // Then v_dot_err = -skew(acc_world) * dtheta - R * da_b

        const F_v_theta = new Mat3([
            0, -acc_world.z, acc_world.y,
            acc_world.z, 0, -acc_world.x,
            -acc_world.y, acc_world.x, 0
        ]).scale(-dt); // -skew * dt

        // Inject 3x3 block F_v_theta into F (rows 3,4,5, cols 6,7,8)
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) F.set(3 + r, 6 + c, F_v_theta.get(r, c));

        // Block: dv/da_b (-R * dt)
        const F_v_ab = R.scale(-dt);
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) F.set(3 + r, 9 + c, F_v_ab.get(r, c));

        // Block: dtheta/dtheta (Identity approx for small w, strictly exp(-skew(w)*dt))
        // dtheta_new = dtheta - R * dgb * dt (if local error)
        // If dtheta is global, dtheta_dot = -skew(w_hat) * dtheta - R * dgb ??
        // Simplified: I for small dt.

        // Block: dtheta/dg_b (-R * dt)
        const F_theta_gb = R.scale(-dt);
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) F.set(6 + r, 12 + c, F_theta_gb.get(r, c));

        // Propagate P = F * P * F^T + Q
        // Load P into Mat15 wrapper
        const P_mat = new Mat15();
        P_mat.data.set(this.P);

        const P_pred = F.multiplyFPFt(P_mat);

        // Add Process Noise Q (Diagonal approximation)
        // We add noise variance * dt (Random Walk)
        P_pred.addDiagonal([
            0, 0, 0, // Pos (implicitly 0)
            (this.NOISE_ACC ** 2) * dt, (this.NOISE_ACC ** 2) * dt, (this.NOISE_ACC ** 2) * dt,
            (this.NOISE_GYR ** 2) * dt, (this.NOISE_GYR ** 2) * dt, (this.NOISE_GYR ** 2) * dt,
            (this.NOISE_ACC_BIAS ** 2) * dt, (this.NOISE_ACC_BIAS ** 2) * dt, (this.NOISE_ACC_BIAS ** 2) * dt,
            (this.NOISE_GYR_BIAS ** 2) * dt, (this.NOISE_GYR_BIAS ** 2) * dt, (this.NOISE_GYR_BIAS ** 2) * dt
        ]);

        // Save back to Float64Array
        this.P.set(P_pred.data);
    }

    // --- ZUPT Update (Correct) ---

    private applyZUPT() {
        // H = [0, I, 0, 0, 0] (3x15)
        // K = P * H^T * (H*P*H^T + R)^-1

        const P_mat = new Mat15();
        P_mat.data.set(this.P);

        // 1. Extract H*P*H^T = P_vv (3x3 block at 3,3)
        const P_vv = new Mat3([
            P_mat.get(3, 3), P_mat.get(3, 4), P_mat.get(3, 5),
            P_mat.get(4, 3), P_mat.get(4, 4), P_mat.get(4, 5),
            P_mat.get(5, 3), P_mat.get(5, 4), P_mat.get(5, 5)
        ]);

        // 2. S = P_vv + R
        const noise = this.MEAS_NOISE_ZUPT * this.MEAS_NOISE_ZUPT; // Variance
        const R_cov = Mat3.fromDiagonal([noise, noise, noise]);
        const S = P_vv.add(R_cov);
        const S_inv = S.invert();

        // 3. Compute K (15x3) = P * H^T * S_inv
        // H^T selects columns 3,4,5 of P
        // So for row i, K_i = P_i(v) * S_inv
        const K = new Float64Array(15 * 3);

        // We also need K for P update later: P_new = (I - K*H) * P
        // which is P_new = P - K * (H * P)
        // H * P is just rows 3,4,5 of P.

        for (let i = 0; i < 15; i++) {
            // Row i of P, cols 3..5
            const p_row_v = {
                x: P_mat.get(i, 3),
                y: P_mat.get(i, 4),
                z: P_mat.get(i, 5)
            };
            const k_row = S_inv.multiplyVec(p_row_v); // Symmetric S_inv
            K[i * 3 + 0] = k_row.x;
            K[i * 3 + 1] = k_row.y;
            K[i * 3 + 2] = k_row.z;
        }

        // 4. Update State
        // y = 0 - v
        const dx = new Float64Array(15);
        for (let i = 0; i < 15; i++) {
            dx[i] = K[i * 3 + 0] * (-this.v.x) + K[i * 3 + 1] * (-this.v.y) + K[i * 3 + 2] * (-this.v.z);
        }
        this.injectError(dx);

        // 5. Update Covariance: P = P - K * (H * P)
        // H*P extracts rows 3,4,5 of P.
        // Let M = H*P (3x15 matrix)
        const M = new Float64Array(3 * 15);
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 15; c++) {
                M[r * 15 + c] = P_mat.get(3 + r, c); // Row 3,4,5
            }
        }

        // P_new = P - K * M
        for (let r = 0; r < 15; r++) {
            for (let c = 0; c < 15; c++) {
                let sum = 0;
                // K[r] (row r of K, length 3) dot M[col c] (col c of M, length 3)
                // K is 15x3. K(r, k)
                // M is 3x15. M(k, c)
                for (let k = 0; k < 3; k++) {
                    sum += K[r * 3 + k] * M[k * 15 + c];
                }
                const oldVal = P_mat.get(r, c);
                P_mat.set(r, c, oldVal - sum);
            }
        }

        // Enforce symmetry just in case
        // ... (optional but good practice)

        this.P.set(P_mat.data);
    }

    // --- Gravity Alignment Update ---

    private applyGravityAlignment(a_meas: Vec3) {
        // Measurement: Accel direction should be global UP [0,0,1]
        // Observation vector z = Normalize(a_meas). Expected h(x) = R^T * [0,0,1].
        // But simpler: Project residual in global frame.
        // Accel_global_pred = R * a_hat. Expected = [0,0,g].
        // Difference comes from Orientation Error.
        // Res = Accel_global_pred - [0,0,g_mag]. 
        // Logic: d(Accel_global) / dtheta = -skew(Accel_global).
        // H = [0, 0, -skew(g), 0, 0] (3x15).

        // Use normalized gravity to avoid magnitude issues if bias is bad?
        // Let's use gravity vector matching.

        const P_mat = new Mat15();
        P_mat.data.set(this.P);

        // Predict gravity in world frame (should be [0,0,g])
        // Current: R * a_meas
        const R = QuatMath.toRotationMatrix(this.q);
        const a_world = R.multiplyVec(Vec3Math.sub(a_meas, this.ab));

        // Residual y = a_world - [0, 0, g]
        // Actually, measurement is a_world, prediction is [0,0,g]
        const y_res = {
            x: a_world.x - 0,
            y: a_world.y - 0,
            z: a_world.z - this.GRAVITY_MAG
        };

        // H matrix for global gravity error vs state error
        // Pos/Vel: 0. Biases: complicated. Orientation: Main driver.
        // H_theta = -skew([0,0,g]) = [0 g 0; -g 0 0; 0 0 0]
        const g = this.GRAVITY_MAG;
        const H_theta = new Mat3([
            0, g, 0,
            -g, 0, 0,
            0, 0, 0
        ]);

        // Construct H (3x15). Blocks: 0, 0, H_theta, 0, 0.
        // ...
        // We'll proceed effectively by extracting relevant blocks of P.
        // H only touches cols 6,7,8.

        // S = H * P * H^T + R
        // S = H_theta * P_theta_theta * H_theta^T + R_meas
        const P_tt = new Mat3([
            P_mat.get(6, 6), P_mat.get(6, 7), P_mat.get(6, 8),
            P_mat.get(7, 6), P_mat.get(7, 7), P_mat.get(7, 8),
            P_mat.get(8, 6), P_mat.get(8, 7), P_mat.get(8, 8)
        ]);

        // H * P_tt
        const HPtt = H_theta.multiply(P_tt);
        // (H * P_tt) * H^T
        const HPttHt = HPtt.multiply(H_theta.transpose());

        const noise = this.MEAS_NOISE_GRAVITY * this.MEAS_NOISE_GRAVITY;
        const S = HPttHt.add(Mat3.fromDiagonal([noise, noise, noise]));

        // Invert S
        // Note: S might be singular if g aligns with axes perfectly? No, noise prevents it.
        const S_inv = S.invert();

        // K = P * H^T * S_inv
        // H^T is 15x3, non-zero at rows 6,7,8.
        // H^T_theta = [0 -g 0; g 0 0; 0 0 0]
        const Ht_theta = H_theta.transpose();

        const K = new Float64Array(15 * 3);

        for (let i = 0; i < 15; i++) {
            // P row i, cols 6..8
            // We multiply P_row_theta (1x3) * Ht_theta (3x3)
            const p_i_theta = { x: P_mat.get(i, 6), y: P_mat.get(i, 7), z: P_mat.get(i, 8) };
            // Manual mul: 
            // res = [
            //   p.x*Ht00 + p.y*Ht10 + p.z*Ht20,
            //   p.x*Ht01 + p.y*Ht11...
            // ]
            // Simpler: Use Mat3 mulVec but carefully?
            // Ht_theta is:
            // [ 0 -g  0]
            // [ g  0  0]
            // [ 0  0  0]

            // res.x = p.y * g
            // res.y = p.x * -g
            // res.z = 0

            const PHt_x = p_i_theta.y * g;
            const PHt_y = p_i_theta.x * -g;
            const PHt_z = 0;

            // Multiply by S_inv (3x3)
            const k_row = S_inv.multiplyVec({ x: PHt_x, y: PHt_y, z: PHt_z });
            K[i * 3 + 0] = k_row.x;
            K[i * 3 + 1] = k_row.y;
            K[i * 3 + 2] = k_row.z;
        }

        // Apply Correction to State
        // dx = K * y_res
        const dx = new Float64Array(15);
        for (let i = 0; i < 15; i++) {
            dx[i] = K[i * 3 + 0] * y_res.x + K[i * 3 + 1] * y_res.y + K[i * 3 + 2] * y_res.z;
        }
        this.injectError(dx);

        // Update P = P - K*H*P
        // H*P only involves rows 6,7,8 of P, multiplied by H_theta.
        // M = H*P (3x15).
        // Col j of M = H_theta * P_col_j_theta (3x1 vector P[6..8, j])
        const M = new Float64Array(3 * 15);
        for (let c = 0; c < 15; c++) {
            const p_cj = { x: P_mat.get(6, c), y: P_mat.get(7, c), z: P_mat.get(8, c) };
            // H_theta * p_cj
            // x: p.y * g (Wait, H_theta row 0 is [0 g 0]) -> P[7,c]*g
            // y: p.x * -g -> P[6,c]*-g
            // z: 0
            M[0 * 15 + c] = p_cj.y * g;
            M[1 * 15 + c] = p_cj.x * -g;
            M[2 * 15 + c] = 0;
        }

        // P -= K*M
        for (let r = 0; r < 15; r++) {
            for (let c = 0; c < 15; c++) {
                let sum = 0;
                for (let k = 0; k < 3; k++) sum += K[r * 3 + k] * M[k * 15 + c];
                P_mat.set(r, c, P_mat.get(r, c) - sum);
            }
        }
        this.P.set(P_mat.data);
    }

    private injectError(dx: Float64Array) {
        // 1. Position
        this.p.x += dx[0];
        this.p.y += dx[1];
        this.p.z += dx[2];

        // 2. Velocity
        this.v.x += dx[3];
        this.v.y += dx[4];
        this.v.z += dx[5];

        // 3. Orientation
        // dtheta is a small rotation vector
        const dtheta = { x: dx[6], y: dx[7], z: dx[8] };
        // q_new = q_nom * Quat(dtheta)
        // Ensure small angle approx
        const dq = QuatMath.fromOneHalfTheta(dtheta);
        this.q = QuatMath.multiply(this.q, dq);
        this.q = QuatMath.normalize(this.q);

        // 4. Biases
        this.ab.x += dx[9];
        this.ab.y += dx[10];
        this.ab.z += dx[11];

        this.gb.x += dx[12];
        this.gb.y += dx[13];
        this.gb.z += dx[14];

        // Reset Error State (conceptually 0)
    }

    // --- Helpers ---

    private updateBuffers(a: Vec3, w: Vec3) {
        const a_mag = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
        const w_mag = Math.sqrt(w.x * w.x + w.y * w.y + w.z * w.z);

        this.accelBuffer.push(a_mag);
        this.gyroBuffer.push(w_mag);

        if (this.accelBuffer.length > this.BUFFER_SIZE) this.accelBuffer.shift();
        if (this.gyroBuffer.length > this.BUFFER_SIZE) this.gyroBuffer.shift();
    }

    private isStationary(): boolean {
        if (this.accelBuffer.length < this.BUFFER_SIZE) return false;

        const avgA = this.accelBuffer.reduce((s, v) => s + v, 0) / this.accelBuffer.length;
        const avgW = this.gyroBuffer.reduce((s, v) => s + v, 0) / this.gyroBuffer.length;

        // Check 1: Gyro Low
        if (avgW > this.REST_GYRO_THR) return false;

        // Check 2: Accel near gravity (9.81)
        if (Math.abs(avgA - this.GRAVITY_MAG) > (this.REST_ACCEL_THR * 9.81)) return false;

        return true;
    }

    // --- Public API ---

    getPath() { return this.path; }
    getOrientation() { return this.q; }
    getVelocity() { return this.v; }

    // Función auxiliar matemática
    // Calcula el cuaternión (Body -> World) que alinea la aceleración medida con el eje Z vertical [0,0,1]
    private getRotationFromGravity(ax: number, ay: number, az: number): Quaternion {
        // 1. Normalizar el vector de aceleración (dirección "ARRIBA" medida por el sensor)
        const norm = Math.sqrt(ax * ax + ay * ay + az * az);
        if (norm === 0) return QuatMath.identity();

        const u = { x: ax / norm, y: ay / norm, z: az / norm };

        // 2. Queremos la rotación q tal que R(q) * u = [0,0,1] (Mundo)
        // El eje de rotación es el producto cruz: u x [0,0,1] = [u.y, -u.x, 0]
        const crossX = u.y;
        const crossY = -u.x;
        const dot = u.z; // Producto punto entre u y [0,0,1]

        // Casos límite
        if (dot > 0.9999) return QuatMath.identity();
        if (dot < -0.9999) return { w: 0, x: 1, y: 0, z: 0 }; // Inversión total (180 grados en X)

        // Fórmula de medio ángulo para alineación de vectores
        const w = 1 + dot;
        const x = crossX;
        const y = crossY;
        const z = 0;

        return QuatMath.normalize({ w, x, y, z });
    }

    async calibrateAsync(durationMs: number = 2000) {
        console.log('[ESKF] Starting Calibration...');
        this.isCalibrating = true;
        this.calibrationBuffer = [];
        await new Promise(r => setTimeout(r, durationMs));
        this.isCalibrating = false;

        if (this.calibrationBuffer.length < 10) return;

        // --- 1. Cálculo de Biases ---
        let sumGx = 0, sumGy = 0, sumGz = 0;
        let sumAx = 0, sumAy = 0, sumAz = 0;

        for (const s of this.calibrationBuffer) {
            sumGx += s.gx; sumGy += s.gy; sumGz += s.gz;
            sumAx += s.ax; sumAy += s.ay; sumAz += s.az;
        }

        const count = this.calibrationBuffer.length;
        const radFactor = Math.PI / 180;
        const gFactor = 9.81;

        // Sesgo del giroscopio (en rad/s)
        this.gb = {
            x: (sumGx / count) * radFactor,
            y: (sumGy / count) * radFactor,
            z: (sumGz / count) * radFactor
        };

        // Sesgo del acelerómetro: Lo dejamos en 0 (asumimos calibración de fábrica)
        this.ab = { x: 0, y: 0, z: 0 };

        // --- 2. Orientación Inicial ---
        const avgAx = (sumAx / count) * gFactor;
        const avgAy = (sumAy / count) * gFactor;
        const avgAz = (sumAz / count) * gFactor;

        // Calculamos la rotación inicial basada en la gravedad
        const initialQ = this.getRotationFromGravity(avgAx, avgAy, avgAz);

        console.log(`[ESKF] Calibrated. Gravity Detect: [${avgAx.toFixed(2)}, ${avgAy.toFixed(2)}, ${avgAz.toFixed(2)}]`);
        console.log(`[ESKF] Initial Q calculated: [${initialQ.w.toFixed(3)}, ${initialQ.x.toFixed(3)}, ${initialQ.y.toFixed(3)}, ${initialQ.z.toFixed(3)}]`);

        // --- 3. Reinicio del Estado ---
        this.reset();

        // Asignamos la orientación inicial calculada
        this.q = initialQ;

        // P es reiniciado en reset(), pero los biases (ab, gb) se mantienen porque no se limpian allí.
    }

    // Snapshot API
    createSnapshot() { this.liftSnapshot = [...this.path]; }
    getLiftSnapshot() { return this.liftSnapshot; }
    hasLiftSnapshot() { return this.liftSnapshot.length > 0; }
    clearLiftSnapshot() { this.liftSnapshot = []; }

    private getLastPoint(): TrajectoryPoint {
        return this.path.length > 0 ? this.path[this.path.length - 1] : { timestamp: 0, position: Vec3Math.zero(), rotation: QuatMath.identity() };
    }
}

export const trajectoryService = new TrajectoryService();
