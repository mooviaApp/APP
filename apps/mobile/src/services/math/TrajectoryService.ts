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
    relativePosition: Vec3;
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
    private readonly MEAS_NOISE_GRAVITY = 0.05; // m/s^2 (Strong gravity trust)

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
    private isOrientationInitialized = false;

    // Repetition tracking
    private wasMoving = false;
    private baselineP: Vec3 = { x: 0, y: 0, z: 0 };

    // Snapshot
    private liftSnapshot: TrajectoryPoint[] = [];

    // ========================================
    // RAW DATA BUFFER FOR POST-PROCESSING
    // ========================================
    // Captures corrected accelerations for offline batch corrections
    private rawDataBuffer: Array<{
        timestamp: number;
        acc_net: Vec3;      // Gravity-corrected acceleration (world frame)
        acc_world: Vec3;    // Rotated acceleration before gravity removal
        w_meas: Vec3;       // Gyro measurement (bias-corrected)
        q: Quaternion;      // Orientation at this sample
        p_raw: Vec3;        // Raw integrated position (with drift)
        v_raw: Vec3;        // Raw integrated velocity (with drift)
    }> = [];

    // VBT: Vertical axis detection (from calibration)
    private verticalAxis: 'x' | 'y' | 'z' = 'z'; // Default Z, updated in calibration
    private verticalAxisSign: 1 | -1 = 1; // 1 = positive, -1 = negative

    // Debug Throttling
    private correctionLogCounter = 0;
    private readonly LOG_THROTTLE = 100;

    // Record-Only Mode
    private realtimeEnabled = false;

    constructor() {
        this.reset();
    }

    /**
     * FULL RESET: Resets everything including biases
     * Use this only when starting a completely new session
     */
    reset() {
        console.log('[ESKF] Full Reset (including biases)...');
        this.p = Vec3Math.zero();
        this.v = Vec3Math.zero();
        this.q = QuatMath.identity();
        this.ab = Vec3Math.zero();
        this.gb = Vec3Math.zero();

        // Initialize P with small uncertainty
        this.P.fill(0);
        for (let i = 0; i < 15; i++) {
            this.P[i * 15 + i] = 0.01;
        }

        this.path = [];
        this.lastTimestamp = 0;
        this.accelBuffer = [];
        this.gyroBuffer = [];
        this.wasMoving = false;
        this.baselineP = { x: 0, y: 0, z: 0 };
        this.isOrientationInitialized = false;
        this.isCalibrating = false;
        this.calibrationBuffer = [];
    }

    /**
     * KINEMATIC RESET ("NEW REP" / "TARE")
     * Resets position, velocity, and path for a new lift
     * KEEPS the calibrated biases (ab, gb) - no need to recalibrate!
     * Use this between reps during a training session
     */
    resetKinematics() {
        console.log('[ESKF] Kinematic Reset (keeping calibrated biases)...');

        // Reset kinematics
        this.p = Vec3Math.zero();
        this.v = Vec3Math.zero();

        // Reset orientation (will re-align on next packet via Hot Start)
        this.q = QuatMath.identity();
        this.isOrientationInitialized = false;

        // Reset covariance
        this.P.fill(0);
        for (let i = 0; i < 15; i++) {
            this.P[i * 15 + i] = 0.01;
        }

        // Clear path and buffers
        this.path = [];
        this.accelBuffer = [];
        this.gyroBuffer = [];
        this.rawDataBuffer = []; // Clear previous recording data
        this.wasMoving = false;
        this.baselineP = { x: 0, y: 0, z: 0 };

        // NOTE: We do NOT reset ab and gb - those are calibrated values!
        console.log('[ESKF] Ready for new rep (biases preserved)');
    }

    // --- Main Loop ---

    processSample(sample: IMUSample): TrajectoryPoint {
        const t = sample.timestampMs;

        // Calibration Mode
        if (this.isCalibrating) {
            this.calibrationBuffer.push(sample);
            return {
                timestamp: t,
                position: Vec3Math.zero(),
                rotation: QuatMath.identity(),
                relativePosition: Vec3Math.zero()
            };
        }

        // ========================================
        // CALIBRATION-ONLY MODE (Logic preserved)
        // ========================================

        // --- CORRECCIÓN: Manejo del Primer Paquete ---
        if (this.lastTimestamp === 0) {
            this.lastTimestamp = t;
            // Hot Start instantáneo ONLY if not calibrated
            if (!this.isOrientationInitialized) {
                const a_init = { x: sample.ax * 9.81, y: sample.ay * 9.81, z: sample.az * 9.81 };
                this.q = this.getRotationFromGravity(a_init.x, a_init.y, a_init.z);
                this.isOrientationInitialized = true;
                console.log('[ESKF] First packet: Orientation aligned to gravity (Hot Start).');
            } else {
                console.log('[ESKF] First packet: Preserving Calibrated Orientation.');
            }
            return {
                timestamp: t,
                position: Vec3Math.zero(), // Always [0,0,0]
                rotation: { ...this.q },
                relativePosition: Vec3Math.zero()
            };
        }

        const dt = (t - this.lastTimestamp) / 1000.0;
        if (dt <= 0) return this.getLastPoint(); // Duplicate sample
        this.lastTimestamp = t;

        // 1. Unpack Raw Measurements (No Bias Subtraction yet - handled in predict)
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

        // 1.1 Update Stationary Detection Buffers (CRITICAL FIX)
        // Feed physical units (m/s² and rad/s) to the sliding window
        this.updateBuffers(a_meas, w_meas);

        // ========================================
        // RAW INTEGRATION MODE (No Corrections)
        // ========================================

        // ========================================
        // 1.5 Real-time Gravity Alignment (Drift Correction)
        // ========================================
        const isStat = this.isStationary();

        // Debug Status (Every 500ms ~ 500 samples)
        if (this.path.length % 500 === 0) {
            const a_mag = Math.sqrt(a_meas.x * a_meas.x + a_meas.y * a_meas.y + a_meas.z * a_meas.z);
            console.log(`[ESKF-STATUS] Stationary: ${isStat} | |a|:${a_mag.toFixed(2)} | q:[${this.q.w.toFixed(2)},${this.q.x.toFixed(2)},${this.q.y.toFixed(2)},${this.q.z.toFixed(2)}]`);
        }

        // If the sensor is stationary, we TRUST Gravity more than the Gyroscope.
        // We use the accelerometer to correct the tilt (Roll/Pitch).
        if (isStat && this.isOrientationInitialized) {
            this.applyGravityAlignment(a_meas);
            this.applyZUPT(); // Zero-Velocity Update to stop positional drift
        }

        // 2. Prediction Step (Integrate Nominal State Only)
        // Returns the calculated accelerations (consistent with integration)
        const { acc_net, acc_world } = this.predict(a_meas, w_meas, dt);

        // Relative position = current - baseline
        const relP = Vec3Math.sub(this.p, this.baselineP);

        // ========================================
        // CAPTURE RAW DATA FOR POST-PROCESSING
        // ========================================
        // Store corrected accelerations for offline batch corrections
        // This buffer is filled from Stream On → Stream Off
        this.rawDataBuffer.push({
            timestamp: t,
            acc_net,           // Gravity-corrected acceleration (from predict)
            acc_world,         // Rotated acceleration (from predict)
            w_meas,            // Raw gyro (conceptually we might want unbiased, but keeping structure)
            q: { ...this.q },
            p_raw: { ...this.p },
            v_raw: { ...this.v }
        });

        // Debug Logs (every 50 samples ~ 50ms @ 1kHz)
        if (this.path.length % 50 === 0) {
            const v_mag = Math.sqrt(this.v.x ** 2 + this.v.y ** 2 + this.v.z ** 2);
            console.log(`[ESKF-RAW] t:${(t / 1000).toFixed(2)}s P:[${this.p.x.toFixed(3)},${this.p.y.toFixed(3)},${this.p.z.toFixed(3)}] V:${v_mag.toFixed(3)}m/s Buffer:${this.rawDataBuffer.length}`);
        }

        // 4. Record-Only Mode Logic
        // If realtimeEnabled is false, we do NOT update this.path, so the UI sees nothing (or static).
        // The rawDataBuffer IS updated above, so post-processing will work.

        if (!this.realtimeEnabled) {
            return {
                timestamp: t,
                position: Vec3Math.zero(),
                rotation: { ...this.q },
                relativePosition: Vec3Math.zero()
            };
        }

        // Real-time Mode: Push to path for live visualization
        const point: TrajectoryPoint = {
            timestamp: t,
            position: { ...this.p },          // Real position (will drift)
            rotation: { ...this.q },
            relativePosition: relP
        };
        this.path.push(point);
        return point;
    }

    public setRealtimeEnabled(enabled: boolean) {
        this.realtimeEnabled = enabled;
        console.log(`[ESKF] Realtime visualization enabled: ${enabled}`);
    }

    // --- ESKF Prediction ---

    private predict(a_meas: Vec3, w_meas: Vec3, dt: number): { acc_net: Vec3, acc_world: Vec3 } {
        // Correct measurements with current bias estimates
        const a_hat = Vec3Math.sub(a_meas, this.ab);
        const w_hat = Vec3Math.sub(w_meas, this.gb);

        // 1. Nominal State Integration

        // UPDATE ORIENTATION FIRST (Fix 2)
        this.q = QuatMath.integrate(this.q, w_hat, dt);
        this.q = QuatMath.normalize(this.q);

        // ROTATE ACCELERATION with new orientation
        const R = QuatMath.toRotationMatrix(this.q);
        const acc_world = R.multiplyVec(a_hat);

        // SUBTRACT GRAVITY (Model: g_world = [0, 0, 9.81])
        const g_world: Vec3 = { x: 0, y: 0, z: this.GRAVITY_MAG };
        const acc_net = Vec3Math.sub(acc_world, g_world); // Kinematic acceleration

        // Guard: Check for NaN/Infinity in accelerations
        if (!isFinite(acc_world.x) || !isFinite(acc_world.y) || !isFinite(acc_world.z) ||
            !isFinite(acc_net.x) || !isFinite(acc_net.y) || !isFinite(acc_net.z)) {
            console.error('[ESKF-PREDICT] ❌ NaN/Infinity detected in acceleration, discarding sample');
            return { acc_net: Vec3Math.zero(), acc_world: Vec3Math.zero() };
        }

        // Validation logs every 200 samples (~200ms @ 1kHz)
        if (this.path.length % 200 === 0) {
            const a_meas_mag = Math.sqrt(a_meas.x ** 2 + a_meas.y ** 2 + a_meas.z ** 2);
            const acc_world_mag = Math.sqrt(acc_world.x ** 2 + acc_world.y ** 2 + acc_world.z ** 2);
            const acc_net_mag = Math.sqrt(acc_net.x ** 2 + acc_net.y ** 2 + acc_net.z ** 2);
            console.log(`[ESKF-PREDICT] |a_meas|:${a_meas_mag.toFixed(2)} |acc_world|:${acc_world_mag.toFixed(2)} |acc_net|:${acc_net_mag.toFixed(2)} acc_net.xy:[${acc_net.x.toFixed(3)},${acc_net.y.toFixed(3)}]`);
        }

        // INTEGRATE POSITION AND VELOCITY
        this.p = Vec3Math.add(this.p, Vec3Math.add(Vec3Math.scale(this.v, dt), Vec3Math.scale(acc_net, 0.5 * dt * dt)));
        this.v = Vec3Math.add(this.v, Vec3Math.scale(acc_net, dt));

        // 2. Error State Transition Matrix (F) and Covariance Propagation
        // F is 15x15. We construct it explicitly.
        const F = Mat15.identity();

        // Block: dp/dv (Identity * dt)
        F.set(0, 3, dt); F.set(1, 4, dt); F.set(2, 5, dt);

        // Block: dv/dtheta (skew(R*a_hat) * dt) ?? No, it's -R * skew(a_hat) * dt
        // Using updated R and a_hat (which matches the integration above)
        // skew(acc_world) is used for global error definition

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

        // Clamp Covariance to prevent explosion
        for (let i = 0; i < 225; i++) {
            if (P_pred.data[i] > 1000) P_pred.data[i] = 1000;
            if (P_pred.data[i] < -1000) P_pred.data[i] = -1000;
        }

        // Save back to Float64Array
        this.P.set(P_pred.data);

        return { acc_net, acc_world };
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

        // --- DEBUG LOGS ---
        this.correctionLogCounter++;
        if (this.correctionLogCounter % this.LOG_THROTTLE === 0) {
            const dx_v_mag = Math.sqrt(dx[3] ** 2 + dx[4] ** 2 + dx[5] ** 2);
            console.log(`[ESKF-ZUPT] Correcting Vel: Innovation:[${(-this.v.x).toFixed(4)},${(-this.v.y).toFixed(4)},${(-this.v.z).toFixed(4)}] S_diag:[${S.get(0, 0).toFixed(4)},${S.get(1, 1).toFixed(4)},${S.get(2, 2).toFixed(4)}] dx_mag:${dx_v_mag.toFixed(6)}`);
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

        // --- DEBUG LOGS ---
        if (this.correctionLogCounter % this.LOG_THROTTLE === 0) {
            const dx_theta_mag = Math.sqrt(dx[6] ** 2 + dx[7] ** 2 + dx[8] ** 2);
            console.log(`[ESKF-GRAV] Correcting Tilt: Res:[${y_res.x.toFixed(4)},${y_res.y.toFixed(4)},${y_res.z.toFixed(4)}] S_diag:[${S.get(0, 0).toFixed(4)},${S.get(1, 1).toFixed(4)},${S.get(2, 2).toFixed(4)}] dx_theta_mag:${dx_theta_mag.toFixed(6)}rad`);
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

    /**
     * Check if sensor is stationary using robust ZUPT detection
     * Uses gyro quietness, accel near 1g, and low variance
     * PUBLIC: Used by UI for lift start/stop detection
     */
    public isStationary(): boolean {
        // Assume NOT stationary until we have enough data
        if (this.accelBuffer.length < this.BUFFER_SIZE) return false;

        // 1. Calcular Media
        const avgA = this.accelBuffer.reduce((s, v) => s + v, 0) / this.accelBuffer.length;
        const avgW = this.gyroBuffer.reduce((s, v) => s + v, 0) / this.gyroBuffer.length;

        // 2. Calcular Varianza (Qué tan inestable es la señal)
        const varA = this.accelBuffer.reduce((s, v) => s + (v - avgA) ** 2, 0) / this.accelBuffer.length;

        // UMBRALES RECOMENDADOS PARA PESAS
        const ACCEL_MEAN_TOLERANCE = 0.5; // m/s^2 (tolerant to offset)
        const ACCEL_VAR_TOLERANCE = 0.2; // m/s^2 variance (allow hand jitter)
        const GYRO_MEAN_TOLERANCE = 0.1; // rad/s (tolerant to slow rotation)

        // Check 1: Gyroscope quietness (Rotation kills position accuracy)
        if (avgW > GYRO_MEAN_TOLERANCE) return false;

        // Check 2: Acceleration Magnitude close to Gravity
        if (Math.abs(avgA - this.GRAVITY_MAG) > ACCEL_MEAN_TOLERANCE) return false;

        // Check 3: Acceleration Variance (Vibration check)
        if (varA > ACCEL_VAR_TOLERANCE) return false;

        return true;
    }

    /**
     * Check if barbell is on the ground
     * Combines ZUPT (stationary) with height check to distinguish:
     * - Barbell on ground: quiet + height ~0m ✅
     * - Barbell held still in air: quiet + height >0.15m ❌
     * - Peak of lift (v=0 momentarily): not quiet OR height >0.15m ❌
     */
    public isOnGround(): boolean {
        const isQuiet = this.isStationary();
        const heightNearZero = Math.abs(this.p.z) < 0.15;  // < 15cm threshold
        return isQuiet && heightNearZero;
    }

    // --- Public API ---

    getPath() { return this.path; }
    getOrientation() { return this.q; }
    getVelocity() { return this.v; }
    getIsCalibrating() { return this.isCalibrating; }

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

    async calibrateAsync(durationMs: number = 5000) {
        console.log('[ESKF] ========================================');
        console.log('[ESKF] STARTING RIGOROUS STATIC CALIBRATION');
        console.log(`[ESKF] Duration: ${durationMs}ms`);
        console.log('[ESKF] Keep the sensor COMPLETELY STILL!');
        console.log('[ESKF] ========================================');

        this.isCalibrating = true;
        this.calibrationBuffer = [];
        await new Promise(r => setTimeout(r, durationMs));
        this.isCalibrating = false;

        const MIN_SAMPLES = 500; // Reduced from 3000 - sufficient for BLE streaming
        if (this.calibrationBuffer.length < MIN_SAMPLES) {
            console.error(`[ESKF] ❌ Calibration FAILED: Only ${this.calibrationBuffer.length}/${MIN_SAMPLES} samples received.`);
            console.error('[ESKF] Is the sensor streaming at ~1kHz?');
            return;
        }

        console.log(`[ESKF] ✓ Received ${this.calibrationBuffer.length} samples. Processing...`);

        // --- 1. Cálculo de Promedios Crudos ---
        let sumGx = 0, sumGy = 0, sumGz = 0;
        let sumAx = 0, sumAy = 0, sumAz = 0;

        for (const s of this.calibrationBuffer) {
            sumGx += s.gx; sumGy += s.gy; sumGz += s.gz;
            sumAx += s.ax; sumAy += s.ay; sumAz += s.az;
        }

        const count = this.calibrationBuffer.length;
        const radFactor = Math.PI / 180;
        const gFactor = 9.81;

        // Promedios en unidades crudas (g y dps)
        const avgGx_dps = sumGx / count;
        const avgGy_dps = sumGy / count;
        const avgGz_dps = sumGz / count;

        const avgAx_g = sumAx / count;
        const avgAy_g = sumAy / count;
        const avgAz_g = sumAz / count;

        // --- 2. Sesgo del Giroscopio (Directo) ---
        this.gb = {
            x: avgGx_dps * radFactor,
            y: avgGy_dps * radFactor,
            z: avgGz_dps * radFactor
        };

        console.log('[ESKF] Gyro Bias (rad/s):');
        console.log(`[ESKF]   X: ${this.gb.x.toFixed(6)} (${avgGx_dps.toFixed(3)} dps)`);
        console.log(`[ESKF]   Y: ${this.gb.y.toFixed(6)} (${avgGy_dps.toFixed(3)} dps)`);
        console.log(`[ESKF]   Z: ${this.gb.z.toFixed(6)} (${avgGz_dps.toFixed(3)} dps)`);

        // --- 3. Orientación Inicial (Necesaria para calcular bias del acelerómetro) ---
        const avgAx = avgAx_g * gFactor;
        const avgAy = avgAy_g * gFactor;
        const avgAz = avgAz_g * gFactor;

        // CRITICAL: Log raw accelerometer to identify gravity axis
        console.log('[ESKF] ========================================');
        console.log('[ESKF] RAW ACCELEROMETER (identify gravity axis):');
        console.log(`[ESKF]   X: ${avgAx_g.toFixed(3)} g  (${avgAx.toFixed(2)} m/s²)`);
        console.log(`[ESKF]   Y: ${avgAy_g.toFixed(3)} g  (${avgAy.toFixed(2)} m/s²)`);
        console.log(`[ESKF]   Z: ${avgAz_g.toFixed(3)} g  (${avgAz.toFixed(2)} m/s²)`);
        console.log('[ESKF] → The axis closest to ±1.0g is your gravity axis');
        console.log('[ESKF] ========================================');

        // VBT: Detect which axis is vertical (closest to ±1g)
        const absX = Math.abs(avgAx_g);
        const absY = Math.abs(avgAy_g);
        const absZ = Math.abs(avgAz_g);

        if (absX > absY && absX > absZ) {
            this.verticalAxis = 'x';
            this.verticalAxisSign = avgAx_g > 0 ? 1 : -1;
        } else if (absY > absX && absY > absZ) {
            this.verticalAxis = 'y';
            this.verticalAxisSign = avgAy_g > 0 ? 1 : -1;
        } else {
            this.verticalAxis = 'z';
            this.verticalAxisSign = avgAz_g > 0 ? 1 : -1;
        }

        console.log(`[VBT] Vertical Axis Detected: ${this.verticalAxis.toUpperCase()} (${this.verticalAxisSign > 0 ? '+' : '-'}${this.verticalAxis})`);

        // Calculamos la rotación inicial basada en la gravedad
        const initialQ = this.getRotationFromGravity(avgAx, avgAy, avgAz);

        console.log('[ESKF] Detected Gravity Direction (m/s²):');
        console.log(`[ESKF]   [${avgAx.toFixed(3)}, ${avgAy.toFixed(3)}, ${avgAz.toFixed(3)}]`);
        console.log('[ESKF] Initial Orientation (Quaternion):');
        console.log(`[ESKF]   [w:${initialQ.w.toFixed(4)}, x:${initialQ.x.toFixed(4)}, y:${initialQ.y.toFixed(4)}, z:${initialQ.z.toFixed(4)}]`);

        // --- 4. Sesgo del Acelerómetro (CRÍTICO) ---
        // La lectura promedio del acelerómetro en reposo debería ser SOLO gravedad.
        // Cualquier desviación de [0, 0, g] en el marco global es un bias.

        // Convertimos la lectura promedio al marco global usando la orientación inicial
        const R_init = QuatMath.toRotationMatrix(initialQ);
        const a_measured_global = R_init.multiplyVec({ x: avgAx, y: avgAy, z: avgAz });

        // En el marco global, esperamos [0, 0, 9.81]
        // El error es lo que medimos menos lo esperado
        const a_bias_global = {
            x: a_measured_global.x - 0,
            y: a_measured_global.y - 0,
            z: a_measured_global.z - this.GRAVITY_MAG
        };

        // Convertimos el bias de vuelta al marco del sensor (body frame)
        // porque el ESKF lo necesita en coordenadas del sensor
        const R_init_T = R_init.transpose();
        this.ab = R_init_T.multiplyVec(a_bias_global);

        console.log('[ESKF] Accel Bias (m/s²) [Body Frame]:');
        console.log(`[ESKF]   X: ${this.ab.x.toFixed(6)} (${(this.ab.x / 9.81).toFixed(5)} g)`);
        console.log(`[ESKF]   Y: ${this.ab.y.toFixed(6)} (${(this.ab.y / 9.81).toFixed(5)} g)`);
        console.log(`[ESKF]   Z: ${this.ab.z.toFixed(6)} (${(this.ab.z / 9.81).toFixed(5)} g)`);

        // --- 5. Validación de Calidad ---
        const bias_magnitude = Math.sqrt(this.ab.x ** 2 + this.ab.y ** 2 + this.ab.z ** 2);
        const gyro_magnitude = Math.sqrt(this.gb.x ** 2 + this.gb.y ** 2 + this.gb.z ** 2);

        console.log('[ESKF] Calibration Quality Check:');
        console.log(`[ESKF]   Accel Bias Magnitude: ${bias_magnitude.toFixed(4)} m/s² (${(bias_magnitude / 9.81 * 100).toFixed(2)}% of g)`);
        console.log(`[ESKF]   Gyro Bias Magnitude: ${(gyro_magnitude * 180 / Math.PI).toFixed(3)} dps`);

        if (bias_magnitude > 0.5) {
            console.warn('[ESKF] ⚠️  WARNING: Accel bias is unusually high (>0.5 m/s²).');
            console.warn('[ESKF] Was the sensor moving during calibration?');
        }

        if (gyro_magnitude > 0.1) {
            console.warn('[ESKF] ⚠️  WARNING: Gyro bias is high (>5.7 dps).');
            console.warn('[ESKF] Sensor may need factory recalibration.');
        }

        // --- 6. Reinicio del Estado ---
        this.reset();

        // Asignamos la orientación inicial calculada
        this.q = initialQ;
        this.isOrientationInitialized = true;

        console.log('[ESKF] ========================================');
        console.log('[ESKF] ✅ CALIBRATION COMPLETE');
        console.log('[ESKF] System ready for accurate tracking.');
        console.log('[ESKF] ========================================');
    }

    // --- Drift Correction (Post-Processing) ---

    /**
     * Apply drift correction to a trajectory path.
     * Distributes the final velocity error linearly across all points.
     * This ensures the path starts and ends at zero velocity.
     */
    private applyDriftCorrection(path: TrajectoryPoint[]): TrajectoryPoint[] {
        if (path.length < 2) return path;

        // 1. Get the velocity at the end of the movement
        // (Should be zero, but drift causes it to be non-zero)
        const finalVelocityError = { ...this.v };

        // 2. Calculate total duration
        const t0 = path[0].timestamp;
        const tN = path[path.length - 1].timestamp;
        const duration = (tN - t0) / 1000; // seconds

        if (duration === 0) return path;

        console.log(`[DRIFT] Correcting path with ${path.length} points`);
        console.log(`[DRIFT] Final velocity error: [${finalVelocityError.x.toFixed(3)}, ${finalVelocityError.y.toFixed(3)}, ${finalVelocityError.z.toFixed(3)}] m/s`);

        // 3. Distribute error linearly across all points
        const correctedPath = path.map((point, i) => {
            const t = (point.timestamp - t0) / 1000; // Time since start
            const ratio = t / duration; // 0 to 1

            // Position correction (integrate velocity correction)
            // p_correction = -0.5 * v_error * t * ratio
            const p_correction = {
                x: -0.5 * finalVelocityError.x * t * ratio,
                y: -0.5 * finalVelocityError.y * t * ratio,
                z: -0.5 * finalVelocityError.z * t * ratio
            };

            return {
                ...point,
                relativePosition: {
                    x: point.relativePosition.x + p_correction.x,
                    y: point.relativePosition.y + p_correction.y,
                    z: point.relativePosition.z + p_correction.z
                }
            };
        });

        console.log(`[DRIFT] Correction applied successfully`);
        return correctedPath;
    }

    /**
     * Calculate statistics for a lift (max height, max velocity, duration)
     */
    getLiftStatistics(path: TrajectoryPoint[]) {
        if (path.length === 0) {
            return {
                maxHeight: 0,
                maxVelocity: 0,
                duration: 0,
                pointCount: 0
            };
        }

        let maxHeight = 0;
        let maxVelocity = 0;

        for (const point of path) {
            const height = point.relativePosition.z;
            if (height > maxHeight) maxHeight = height;

            // Approximate velocity from position derivative (not stored in point)
            // For now, we'll use the service's current velocity as max
        }

        // Get max velocity from the entire path (we'd need to store velocity in points for accuracy)
        // For MVP, we'll track it separately or estimate
        maxVelocity = Math.sqrt(this.v.x ** 2 + this.v.y ** 2 + this.v.z ** 2);

        const duration = (path[path.length - 1].timestamp - path[0].timestamp) / 1000;

        return {
            maxHeight,
            maxVelocity,
            duration,
            pointCount: path.length
        };
    }

    // Snapshot API
    createSnapshot() {
        // Apply drift correction before saving snapshot
        const rawPath = [...this.path];
        this.liftSnapshot = this.applyDriftCorrection(rawPath);
        console.log('[SNAPSHOT] Created with drift correction applied');
    }

    getLiftSnapshot() { return this.liftSnapshot; }
    hasLiftSnapshot() { return this.liftSnapshot.length > 0; }
    clearLiftSnapshot() { this.liftSnapshot = []; }

    // Raw Data Buffer API (for post-processing)
    getRawDataBuffer() {
        console.log(`[RAW-BUFFER] Returning ${this.rawDataBuffer.length} samples for post-processing`);
        return this.rawDataBuffer;
    }

    clearRawDataBuffer() {
        console.log(`[RAW-BUFFER] Clearing ${this.rawDataBuffer.length} samples`);
        this.rawDataBuffer = [];
    }


    /**
     * POST-PROCESSING: Apply offline corrections to raw data buffer
     * Called after Stream Off to correct drift using ZUPT + Boundary + Smoothing
     * 
     * Assumptions:
     * - Movement starts and ends at rest (v₀ = vₙ = 0)
     * - Movement returns to initial position (p₀ ≈ pₙ)
     * - Suitable for weightlifting: squat, bench, deadlift, etc.
     */
    applyPostProcessingCorrections() {
        if (this.rawDataBuffer.length < 10) {
            console.warn('[POST-PROC] Insufficient data for corrections');
            return;
        }

        const N = this.rawDataBuffer.length;
        console.log('[POST-PROC] ========================================');
        console.log('[POST-PROC] STARTING CORRECTIONS');
        console.log('[POST-PROC] ========================================');
        console.log(`[POST-PROC] Samples: ${N}`);

        // STEP 0: Analyze raw data
        const v_initial = this.rawDataBuffer[0].v_raw;
        const v_final = this.rawDataBuffer[N - 1].v_raw;
        const p_initial = this.rawDataBuffer[0].p_raw;
        const p_final = this.rawDataBuffer[N - 1].p_raw;

        const v_final_mag = Math.sqrt(v_final.x ** 2 + v_final.y ** 2 + v_final.z ** 2);
        const p_final_mag = Math.sqrt(p_final.x ** 2 + p_final.y ** 2 + p_final.z ** 2);

        console.log(`[POST-PROC] RAW DATA:`);
        console.log(`[POST-PROC]   V_initial: [${v_initial.x.toFixed(3)}, ${v_initial.y.toFixed(3)}, ${v_initial.z.toFixed(3)}] m/s`);
        console.log(`[POST-PROC]   V_final: [${v_final.x.toFixed(3)}, ${v_final.y.toFixed(3)}, ${v_final.z.toFixed(3)}] = ${v_final_mag.toFixed(3)} m/s`);
        console.log(`[POST-PROC]   P_final: [${p_final.x.toFixed(3)}, ${p_final.y.toFixed(3)}, ${p_final.z.toFixed(3)}] = ${p_final_mag.toFixed(3)} m drift`);

        // STEP 1: ZUPT - Force zero velocity at start and end
        console.log('[POST-PROC] ----------------------------------------');
        console.log('[POST-PROC] Step 1/3: ZUPT (Zero-velocity Update)');
        console.log('[POST-PROC] ----------------------------------------');

        // Redistribute velocity error linearly
        for (let i = 0; i < N; i++) {
            const ratio = i / (N - 1);
            this.rawDataBuffer[i].v_raw = {
                x: this.rawDataBuffer[i].v_raw.x - (v_final.x * ratio),
                y: this.rawDataBuffer[i].v_raw.y - (v_final.y * ratio),
                z: this.rawDataBuffer[i].v_raw.z - (v_final.z * ratio)
            };
        }

        const v_after_zupt = this.rawDataBuffer[N - 1].v_raw;
        const v_zupt_mag = Math.sqrt(v_after_zupt.x ** 2 + v_after_zupt.y ** 2 + v_after_zupt.z ** 2);
        console.log(`[POST-PROC]   ✅ V_final after ZUPT: ${v_zupt_mag.toFixed(6)} m/s (should be ~0)`);

        // STEP 2: Re-integrate position with corrected velocity
        console.log('[POST-PROC] ----------------------------------------');
        console.log('[POST-PROC] Step 2/3: Re-integrate Position');
        console.log('[POST-PROC] ----------------------------------------');

        this.rawDataBuffer[0].p_raw = Vec3Math.zero(); // Start at origin

        for (let i = 1; i < N; i++) {
            const dt = (this.rawDataBuffer[i].timestamp - this.rawDataBuffer[i - 1].timestamp) / 1000.0;
            const v_avg = {
                x: (this.rawDataBuffer[i].v_raw.x + this.rawDataBuffer[i - 1].v_raw.x) / 2,
                y: (this.rawDataBuffer[i].v_raw.y + this.rawDataBuffer[i - 1].v_raw.y) / 2,
                z: (this.rawDataBuffer[i].v_raw.z + this.rawDataBuffer[i - 1].v_raw.z) / 2
            };

            this.rawDataBuffer[i].p_raw = {
                x: this.rawDataBuffer[i - 1].p_raw.x + v_avg.x * dt,
                y: this.rawDataBuffer[i - 1].p_raw.y + v_avg.y * dt,
                z: this.rawDataBuffer[i - 1].p_raw.z + v_avg.z * dt
            };
        }

        const p_after_reintegrate = this.rawDataBuffer[N - 1].p_raw;
        const p_reint_mag = Math.sqrt(p_after_reintegrate.x ** 2 + p_after_reintegrate.y ** 2 + p_after_reintegrate.z ** 2);
        console.log(`[POST-PROC]   P_final after re-integration: [${p_after_reintegrate.x.toFixed(3)}, ${p_after_reintegrate.y.toFixed(3)}, ${p_after_reintegrate.z.toFixed(3)}] = ${p_reint_mag.toFixed(3)} m`);

        // STEP 3: BOUNDARY - Force return to origin (p_final = p_initial = 0)
        console.log('[POST-PROC] ----------------------------------------');
        console.log('[POST-PROC] Step 3/3: Boundary Conditions (p₀ = pₙ = 0)');
        console.log('[POST-PROC] ----------------------------------------');

        // LINEAR DETRENDING: Remove linear drift trend
        // Assumption: p[0] = 0, p[N] = 0 (movement returns to start)
        // Method: Subtract drift linearly proportional to time

        // Force boundary constraints
        this.rawDataBuffer[0].p_raw = Vec3Math.zero(); // Already set, but enforce

        // Distribute drift error linearly across trajectory
        for (let i = 1; i < N; i++) {
            const ratio = i / (N - 1); // 0 → 1

            // Linear interpolation: subtract (drift * ratio) from each point
            // At i=0: ratio=0 → no correction (already p=0)
            // At i=N: ratio=1 → full drift correction (p=0)
            this.rawDataBuffer[i].p_raw = {
                x: this.rawDataBuffer[i].p_raw.x - (p_after_reintegrate.x * ratio),
                y: this.rawDataBuffer[i].p_raw.y - (p_after_reintegrate.y * ratio),
                z: this.rawDataBuffer[i].p_raw.z - (p_after_reintegrate.z * ratio)
            };
        }

        const p_final_corrected = this.rawDataBuffer[N - 1].p_raw;
        const p_corrected_mag = Math.sqrt(p_final_corrected.x ** 2 + p_final_corrected.y ** 2 + p_final_corrected.z ** 2);
        console.log(`[POST-PROC]   ✅ P_final after boundary: [${p_final_corrected.x.toFixed(6)}, ${p_final_corrected.y.toFixed(6)}, ${p_final_corrected.z.toFixed(6)}] = ${p_corrected_mag.toFixed(6)} m`);

        // Find maximum displacement during movement
        let max_displacement = 0;
        for (const sample of this.rawDataBuffer) {
            const disp = Math.sqrt(sample.p_raw.x ** 2 + sample.p_raw.y ** 2 + sample.p_raw.z ** 2);
            if (disp > max_displacement) max_displacement = disp;
        }

        console.log('[POST-PROC] ========================================');
        console.log('[POST-PROC] ✅ CORRECTIONS COMPLETE');
        console.log('[POST-PROC] ========================================');
        console.log(`[POST-PROC] Max displacement: ${max_displacement.toFixed(3)} m`);
        console.log(`[POST-PROC] Final drift: ${p_corrected_mag.toFixed(6)} m (should be ~0)`)
            ;
        console.log(`[POST-PROC] Corrected trajectory ready for display`);

        // Calculate VBT metrics using vertical axis
        this.calculateVBTMetrics();

        // Update main path with corrected data
        this.updatePathWithCorrectedData();
    }

    /**
     * Calculate VBT (Velocity-Based Training) metrics using only vertical axis
     * Uses acc_net from rawDataBuffer to compute velocity in vertical direction
     */
    private calculateVBTMetrics() {
        if (this.rawDataBuffer.length < 10) {
            console.warn('[VBT] Insufficient data for metrics calculation');
            return;
        }

        console.log('[VBT] ========================================');
        console.log('[VBT] VELOCITY-BASED TRAINING METRICS');
        console.log('[VBT] ========================================');
        console.log(`[VBT] Vertical Axis: ${this.verticalAxis.toUpperCase()} (${this.verticalAxisSign > 0 ? '+' : '-'}${this.verticalAxis})`);

        // Extract vertical acceleration component for each sample
        let v_vertical = 0; // Vertical velocity
        let peak_velocity = 0;
        let concentric_start_time = 0;
        let concentric_end_time = 0;
        let mpv_sum = 0;
        let mpv_count = 0;
        let in_concentric_phase = false;

        const ACCELERATION_THRESHOLD = 0.1; // m/s² - threshold to detect concentric phase

        for (let i = 1; i < this.rawDataBuffer.length; i++) {
            const dt = (this.rawDataBuffer[i].timestamp - this.rawDataBuffer[i - 1].timestamp) / 1000.0;

            // Extract vertical component from acc_net
            let acc_vertical = 0;
            const acc = this.rawDataBuffer[i].acc_net;

            switch (this.verticalAxis) {
                case 'x':
                    acc_vertical = acc.x * this.verticalAxisSign;
                    break;
                case 'y':
                    acc_vertical = acc.y * this.verticalAxisSign;
                    break;
                case 'z':
                    acc_vertical = acc.z * this.verticalAxisSign;
                    break;
            }

            // Integrate to get velocity
            v_vertical += acc_vertical * dt;

            // Detect concentric phase (upward movement with positive acceleration)
            if (acc_vertical > ACCELERATION_THRESHOLD && !in_concentric_phase) {
                in_concentric_phase = true;
                concentric_start_time = this.rawDataBuffer[i].timestamp;
            }

            // Track peak velocity during concentric phase
            if (in_concentric_phase) {
                if (Math.abs(v_vertical) > Math.abs(peak_velocity)) {
                    peak_velocity = v_vertical;
                }

                // Mean Propulsive Velocity (average during positive acceleration)
                if (acc_vertical > 0) {
                    mpv_sum += Math.abs(v_vertical);
                    mpv_count++;
                }

                // End of concentric phase (acceleration turns negative or velocity drops)
                if (acc_vertical < -ACCELERATION_THRESHOLD || v_vertical < 0) {
                    concentric_end_time = this.rawDataBuffer[i].timestamp;
                    in_concentric_phase = false;
                }
            }
        }

        // Calculate metrics
        const mpv = mpv_count > 0 ? mpv_sum / mpv_count : 0;
        const concentric_time = concentric_end_time > 0 ? (concentric_end_time - concentric_start_time) / 1000.0 : 0;

        console.log(`[VBT] Peak Velocity: ${Math.abs(peak_velocity).toFixed(3)} m/s`);
        console.log(`[VBT] Mean Propulsive Velocity (MPV): ${mpv.toFixed(3)} m/s`);
        console.log(`[VBT] Concentric Time: ${concentric_time.toFixed(3)} s`);
        console.log('[VBT] ========================================');
    }

    /**
     * Update this.path[] with corrected data from rawDataBuffer
     */
    private updatePathWithCorrectedData() {
        this.path = this.rawDataBuffer.map(sample => ({
            timestamp: sample.timestamp,
            position: { ...sample.p_raw },
            rotation: { ...sample.q },
            relativePosition: { ...sample.p_raw } // Relative to origin (0,0,0)
        }));

        console.log(`[POST-PROC] Updated path[] with ${this.path.length} corrected samples`);
    }

    private getLastPoint(): TrajectoryPoint {
        return this.path.length > 0 ? this.path[this.path.length - 1] : {
            timestamp: 0,
            position: Vec3Math.zero(),
            rotation: QuatMath.identity(),
            relativePosition: Vec3Math.zero()
        };
    }
}

export const trajectoryService = new TrajectoryService();
