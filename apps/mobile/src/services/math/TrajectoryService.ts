/**
 * Hybrid Trajectory Service: Madgwick (Orientation) + Integrated Physics (Navigation)
 * 
 * Architecture:
 * 1. Orientation: Madgwick Filter (Gradient Descent) -> Smooth 3D Visualization
 * 2. Position/Velocity: Strapdown Integration with ZUPT & Zero-Clamp safeguards
 * 
 * This approach decouples visualization smoothness from physics integration errors.
 */

import { IMUSample } from '../ble/constants';
import { Mat3 } from './Mat3';
import { Vec3, Vec3Math } from './Vec3';
import { Quaternion, QuatMath } from './QuaternionMath';

// Types covering the older service API
export interface TrajectoryPoint {
    timestamp: number;
    position: Vec3;
    rotation: Quaternion;
    relativePosition: Vec3;
}

/**
 * Standard Madgwick AHRS implementation
 * Source ideas: https://x-io.co.uk/open-source-imu-and-ahrs-algorithms/
 */
class Madgwick {
    public q: Quaternion = { w: 1, x: 0, y: 0, z: 0 };
    private beta: number;
    private sampleFreq: number;

    constructor(sampleFreq: number = 200.0, beta: number = 0.1) {
        this.sampleFreq = sampleFreq;
        this.beta = beta;
    }

    public setQuaternion(q: Quaternion) {
        this.q = { ...q };
    }

    public setBeta(newBeta: number) {
        this.beta = newBeta;
    }

    public update(gx: number, gy: number, gz: number, ax: number, ay: number, az: number) {
        let q1 = this.q.w, q2 = this.q.x, q3 = this.q.y, q4 = this.q.z;
        const normRecip = (n: number) => (n === 0 ? 0 : 1 / Math.sqrt(n));

        // Rate of change of quaternion from gyroscope
        let qDot1 = 0.5 * (-q2 * gx - q3 * gy - q4 * gz);
        let qDot2 = 0.5 * (q1 * gx + q3 * gz - q4 * gy);
        let qDot3 = 0.5 * (q1 * gy - q2 * gz + q4 * gx);
        let qDot4 = 0.5 * (q1 * gz + q2 * gy - q3 * gx);

        // Compute feedback only if accelerometer measurement valid (avoids NaN in accelerometer normalisation)
        if (!((ax === 0.0) && (ay === 0.0) && (az === 0.0))) {
            // Normalise accelerometer measurement
            let recipNorm = normRecip(ax * ax + ay * ay + az * az);
            ax *= recipNorm;
            ay *= recipNorm;
            az *= recipNorm;

            // Auxiliary variables to avoid repeated arithmetic
            let _2q1 = 2.0 * q1;
            let _2q2 = 2.0 * q2;
            let _2q3 = 2.0 * q3;
            let _2q4 = 2.0 * q4;
            let _4q1 = 4.0 * q1;
            let _4q2 = 4.0 * q2;
            let _4q3 = 4.0 * q3;
            let _8q2 = 8.0 * q2;
            let _8q3 = 8.0 * q3;
            let q1q1 = q1 * q1;
            let q2q2 = q2 * q2;
            let q3q3 = q3 * q3;
            let q4q4 = q4 * q4;

            // Gradient decent algorithm corrective step
            let s1 = _4q1 * q3q3 + _2q3 * ax + _4q1 * q2q2 - _2q2 * ay;
            let s2 = _4q2 * q4q4 - _2q4 * ax + 4.0 * q1q1 * q2 - _2q1 * ay - _4q2 + _8q2 * q2q2 + _8q2 * q3q3 + _4q2 * az;
            let s3 = 4.0 * q1q1 * q3 + _2q1 * ax + _4q3 * q4q4 - _2q4 * ay - _4q3 + _8q3 * q2q2 + _8q3 * q3q3 + _4q3 * az;
            let s4 = 4.0 * q2q2 * q4 - _2q2 * ax + 4.0 * q3q3 * q4 - _2q3 * ay;

            recipNorm = normRecip(s1 * s1 + s2 * s2 + s3 * s3 + s4 * s4); // normalise step magnitude
            s1 *= recipNorm;
            s2 *= recipNorm;
            s3 *= recipNorm;
            s4 *= recipNorm;

            // Apply feedback step
            qDot1 -= this.beta * s1;
            qDot2 -= this.beta * s2;
            qDot3 -= this.beta * s3;
            qDot4 -= this.beta * s4;
        }

        // Integrate to yield quaternion
        const dt = 1.0 / this.sampleFreq; // Approx, or pass dynamic dt
        q1 += qDot1 * dt;
        q2 += qDot2 * dt;
        q3 += qDot3 * dt;
        q4 += qDot4 * dt;

        // Normalise quaternion
        let recipNorm = normRecip(q1 * q1 + q2 * q2 + q3 * q3 + q4 * q4);
        this.q.w = q1 * recipNorm;
        this.q.x = q2 * recipNorm;
        this.q.y = q3 * recipNorm;
        this.q.z = q4 * recipNorm;
    }

    // Allow dynamic update with exact dt if available
    public updateWithDt(gx: number, gy: number, gz: number, ax: number, ay: number, az: number, dt: number) {
        // Temporary override of sampleFreq logic for exact dt
        const oldFreq = this.sampleFreq;
        if (dt > 0) this.sampleFreq = 1.0 / dt;
        this.update(gx, gy, gz, ax, ay, az);
        this.sampleFreq = oldFreq; // restore
    }
}

export class TrajectoryService {
    // --- Nominal State ---
    private p: Vec3 = { x: 0, y: 0, z: 0 };
    private v: Vec3 = { x: 0, y: 0, z: 0 };
    private q: Quaternion = { w: 1, x: 0, y: 0, z: 0 };

    // --- Madgwick Filter ---
    // Beta: larger = faster convergence/more noise, smaller = smoother/more drift
    // 0.1 is standard. 0.033 is very smooth.
    // We use a relatively high beta (0.1) for gym movements which are dynamic.
    private madgwick: Madgwick = new Madgwick(100, 0.1);

    // --- Biases (Still kept for Gyro correction if needed, but Madgwick handles some drift) ---
    private ab: Vec3 = { x: 0, y: 0, z: 0 };
    private gb: Vec3 = { x: 0, y: 0, z: 0 };

    // --- Constants ---
    private readonly GRAVITY = 9.81;

    // ZUPT Detection
    private readonly BUFFER_SIZE = 250;
    private accelBuffer: number[] = [];
    private gyroBuffer: number[] = [];

    // State
    private isCalibrating = false;
    private calibrationBuffer: IMUSample[] = [];
    private lastTimestamp = 0;
    private path: TrajectoryPoint[] = [];
    private isOrientationInitialized = false;

    // Repetition tracking
    private baselineP: Vec3 = { x: 0, y: 0, z: 0 };

    // Raw Data Buffer
    private rawDataBuffer: Array<any> = [];

    // Record-Only Mode
    private realtimeEnabled = false;

    constructor() {
        this.reset();
    }

    /**
     * FULL RESET
     */
    reset() {
        console.log('[Hybrid] Full Reset...');
        this.p = Vec3Math.zero();
        this.v = Vec3Math.zero();
        this.q = QuatMath.identity();

        // Reset Madgwick
        this.madgwick = new Madgwick(100, 0.1);

        this.ab = Vec3Math.zero();
        this.gb = Vec3Math.zero();

        this.path = [];
        this.lastTimestamp = 0;
        this.accelBuffer = [];
        this.gyroBuffer = [];
        this.baselineP = { x: 0, y: 0, z: 0 };
        this.isOrientationInitialized = false;
        this.isCalibrating = false;
        this.calibrationBuffer = [];
    }

    resetKinematics() {
        console.log('[Hybrid] Kinematic Reset (biases preserved)...');
        this.p = Vec3Math.zero();
        this.v = Vec3Math.zero();
        this.path = [];
        this.accelBuffer = [];
        this.gyroBuffer = [];
        this.rawDataBuffer = [];
        this.baselineP = { x: 0, y: 0, z: 0 };
        // We DO NOT reset Madgwick here to keep orientation continuity.
        console.log('[Hybrid] Ready for new rep');
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

        // --- Hot Start: Initialize Orientation from Gravity ---
        if (this.lastTimestamp === 0) {
            this.lastTimestamp = t;
            if (!this.isOrientationInitialized) {
                const a_init = { x: sample.ax * 9.81, y: sample.ay * 9.81, z: sample.az * 9.81 };
                // Calculate initial Q aligned to gravity
                const qInit = this.getRotationFromGravity(a_init.x, a_init.y, a_init.z);
                this.q = qInit;
                // Inject into Madgwick so it starts converged
                this.madgwick.setQuaternion(qInit);

                this.isOrientationInitialized = true;
                console.log('[Hybrid] Hot Start: Madgwick Seeded from Gravity.');
            }
            return {
                timestamp: t,
                position: Vec3Math.zero(),
                rotation: { ...this.q },
                relativePosition: Vec3Math.zero()
            };
        }

        const dt = (t - this.lastTimestamp) / 1000.0;
        if (dt <= 0) return this.getLastPoint();
        this.lastTimestamp = t;

        // =============================================================
        // CORRECCIÓN VISUAL: "Turbo Boost" para arranque rápido
        // =============================================================
        // Si llevamos pocos samples (ej. < 200, aprox 2 segundos), 
        // usamos un Beta agresivo para que el cubo se enderece rápido.
        // Luego pasamos a modo suave para filtrar vibraciones.
        if (this.path.length < 200) {
            this.madgwick.setBeta(2.5); // Modo Rápido (corrige en <0.5s)
        } else {
            this.madgwick.setBeta(0.1); // Modo Suave (estándar)
        }
        // =============================================================

        // 1. Raw Measurements (Physical Units)
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

        // 1.1 Update Stationary Detection Buffers
        this.updateBuffers(a_meas, w_meas);

        // 1.2 Detect Stationary State
        const isStat = this.isStationary();

        // --- STEP 1: UPDATE ORIENTATION (MADGWICK) ---
        // Madgwick expects Rad/s and G (or consistent units). 
        // We pass Rad/s and m/s^2. Madgwick implementation normalizes Accel, so magnitude doesn't matter, only direction.
        // We use the RAW measurements (Madgwick generally handles biases implicitly via Beta, or we could bias-correct first).
        // Let's bias-correct Gyro if we have gb, but Madgwick is robust.
        // For now, let's pass a_meas and w_meas directly (or w_meas - gb).
        // Given we don't strictly calibrate gb anymore in this simple version, raw is fine.
        this.madgwick.updateWithDt(w_meas.x, w_meas.y, w_meas.z, a_meas.x, a_meas.y, a_meas.z, dt);

        // SYNC: Take quaternion from Madgwick
        this.q = { ...this.madgwick.q };

        // --- STEP 2: PREPARE PHYSICS ---

        // Correction 1: Stationay Lock Pre-Calculation (Snapshot)
        const prevPosition = { ...this.p };

        // --- STEP 3: ROTATE ACCELERATION / GRAVITY REMOVAL ---

        // A. Remove Bias (Standard simple bias subtraction if we had it)
        // const a_hat = Vec3Math.sub(a_meas, this.ab);
        const a_hat = a_meas; // Using raw for now as AB is 0.

        // B. Rotate to World Frame
        const R = QuatMath.toRotationMatrix(this.q);
        const acc_world = R.multiplyVec(a_hat);

        // C. Subtract Gravity
        // Model: Gravity is [0, 0, 9.81] in World (Standard Z-Up).
        const g_world: Vec3 = { x: 0, y: 0, z: this.GRAVITY };
        let acc_net = Vec3Math.sub(acc_world, g_world);

        // --- STEP 4: PHYSICS INTEGRATION (Double Integration) ---

        // Safeguard: Gravity Leakage Clamp (User's Logic)
        const a_mag = Math.sqrt(a_meas.x ** 2 + a_meas.y ** 2 + a_meas.z ** 2);
        const net_mag = Math.sqrt(acc_net.x ** 2 + acc_net.y ** 2 + acc_net.z ** 2);

        // If sensor says 1G (static) but math says specific force > 2.0 (moving), it's an artifact.
        if (Math.abs(a_mag - 9.81) < 1.0 && net_mag > 2.0) {
            acc_net = { x: 0, y: 0, z: 0 };
            // Note: We don't integrate in this branch, effectively suppressing the spike.
        }

        // Standard Integration: p = p + v*dt + 0.5*a*dt^2
        if (!isStat) {
            this.p = Vec3Math.add(this.p, Vec3Math.add(Vec3Math.scale(this.v, dt), Vec3Math.scale(acc_net, 0.5 * dt * dt)));
            this.v = Vec3Math.add(this.v, Vec3Math.scale(acc_net, dt));
        }

        // --- STEP 5: SAFEGUARDS (STATIONARY LOCKS) ---
        if (isStat) {
            // A. Force Net Accel to Zero (Clean Buffer)
            acc_net = { x: 0, y: 0, z: 0 };

            // B. Snapshot Lock: Restore position to prevent creep
            this.p = prevPosition;

            // C. Zero Velocity (Hard ZUPT)
            this.v = { x: 0, y: 0, z: 0 };
        }

        // Relative position
        const relP = Vec3Math.sub(this.p, this.baselineP);

        // Capture Raw Data
        this.rawDataBuffer.push({
            timestamp: t,
            acc_net,
            acc_world,
            w_meas,
            q: { ...this.q },
            p_raw: { ...this.p },
            v_raw: { ...this.v }
        });

        // Debug Logs
        if (this.path.length % 20 === 0) {
            console.log(`[Hybrid] ${isStat ? '🛑' : '🚀'} | ` +
                `Beta:${this.path.length < 200 ? '2.5' : '0.1'} | ` +
                `Az:${a_meas.z.toFixed(2)} | ` +
                `NetZ:${acc_net.z.toFixed(2)} | ` +
                `Vz:${this.v.z.toFixed(3)} | ` +
                `Pz:${this.p.z.toFixed(3)}`);
        }

        if (!this.realtimeEnabled) {
            return {
                timestamp: t,
                position: Vec3Math.zero(),
                rotation: { ...this.q },
                relativePosition: Vec3Math.zero()
            };
        }

        // --- CORRECCIÓN VISUAL PARA LA UI ---
        // Como invertimos la gravedad para la física, el cubo se ve al revés.
        // Rotamos 180 grados en X para corregirlo visualmente sin afectar los cálculos.
        // Q_rot_180_X = [0, 1, 0, 0] (w, x, y, z)
        const q_visual = QuatMath.multiply(this.q, { w: 0, x: 1, y: 0, z: 0 });

        const point: TrajectoryPoint = {
            timestamp: t,
            position: { ...this.p },
            rotation: q_visual, // <--- ÚNICO CAMBIO: Enviar q_visual en vez de this.q
            relativePosition: relP
        };
        this.path.push(point);
        return point;
    }

    public setRealtimeEnabled(enabled: boolean) {
        this.realtimeEnabled = enabled;
        console.log(`[Hybrid] Realtime visualization enabled: ${enabled}`);
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

    public isStationary(): boolean {
        if (this.accelBuffer.length < this.BUFFER_SIZE) return false;
        const avgA = this.accelBuffer.reduce((s, v) => s + v, 0) / this.accelBuffer.length;
        const avgW = this.gyroBuffer.reduce((s, v) => s + v, 0) / this.gyroBuffer.length;
        const varA = this.accelBuffer.reduce((s, v) => s + (v - avgA) ** 2, 0) / this.accelBuffer.length;

        const ACCEL_MEAN_TOLERANCE = 0.5;
        const ACCEL_VAR_TOLERANCE = 0.2;
        const GYRO_MEAN_TOLERANCE = 0.1;

        if (avgW > GYRO_MEAN_TOLERANCE) return false;
        if (Math.abs(avgA - this.GRAVITY) > ACCEL_MEAN_TOLERANCE) return false;
        if (varA > ACCEL_VAR_TOLERANCE) return false;

        return true;
    }

    private getLastPoint(): TrajectoryPoint {
        if (this.path.length > 0) return this.path[this.path.length - 1];
        return { timestamp: 0, position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, relativePosition: { x: 0, y: 0, z: 0 } };
    }

    // --- Public API ---
    getPath() { return this.path; }
    getOrientation() { return this.q; }
    getVelocity() { return this.v; }
    getIsCalibrating() { return this.isCalibrating; }

    // Aux: Rotation from Gravity (Static Alignment)
    private getRotationFromGravity(ax: number, ay: number, az: number): Quaternion {
        const norm = Math.sqrt(ax * ax + ay * ay + az * az);
        if (norm === 0) return QuatMath.identity();


        const u = { x: ax / norm, y: ay / norm, z: az / norm };

        // Queremos R(q) * u = [0,0,1]
        const crossX = u.y;
        const crossY = -u.x;
        const dot = u.z;

        if (dot > 0.9999) return QuatMath.identity();
        if (dot < -0.9999) return { w: 0, x: 1, y: 0, z: 0 };

        const w = 1 + dot;
        const x = crossX;
        const y = crossY;
        const z = 0;

        return QuatMath.normalize({ w, x, y, z });
    }

    async calibrateAsync(durationMs: number = 5000) {
        console.log('[Hybrid] Starting Calibration...');
        this.isCalibrating = true;
        this.calibrationBuffer = [];
        await new Promise(r => setTimeout(r, durationMs));
        this.isCalibrating = false;

        if (this.calibrationBuffer.length < 100) {
            console.log('Calibration failed: not enough samples');
            return;
        }

        // Simple average for biases
        let bx = 0, by = 0, bz = 0;
        let gx = 0, gy = 0, gz = 0;
        const n = this.calibrationBuffer.length;

        for (const s of this.calibrationBuffer) {
            gx += s.gx; gy += s.gy; gz += s.gz;
        }

        // Gyro Bias in Rad/s
        this.gb = {
            x: (gx / n) * (Math.PI / 180),
            y: (gy / n) * (Math.PI / 180),
            z: (gz / n) * (Math.PI / 180)
        };
        console.log(`[Hybrid] Calibrated Gyro Bias: ${this.gb.x.toFixed(4)}, ${this.gb.y.toFixed(4)}, ${this.gb.z.toFixed(4)}`);

        this.resetKinematics();
    }

    // --- Stub Methods for Compatibility ---
    public isOnGround() { return this.isStationary() && Math.abs(this.p.z) < 0.15; }

    // =================================================================
    // POST-PROCESSING & VBT METRICS (Restoring lost functionality)
    // =================================================================

    /**
     * Apply offline corrections to raw data buffer (ZUPT + Boundary Condition)
     */
    applyPostProcessingCorrections() {
        if (this.rawDataBuffer.length < 10) {
            console.warn('[POST-PROC] Insufficient data for corrections');
            return;
        }

        const N = this.rawDataBuffer.length;
        console.log('[POST-PROC] Starting Corrections on ' + N + ' samples...');

        // STEP 0: Analyze raw data
        const v_final = this.rawDataBuffer[N - 1].v_raw;

        // STEP 1: ZUPT - Force zero velocity at start and end
        // Distribute velocity error linearly across the set
        for (let i = 0; i < N; i++) {
            const ratio = i / (N - 1);
            this.rawDataBuffer[i].v_raw = {
                x: this.rawDataBuffer[i].v_raw.x - (v_final.x * ratio),
                y: this.rawDataBuffer[i].v_raw.y - (v_final.y * ratio),
                z: this.rawDataBuffer[i].v_raw.z - (v_final.z * ratio)
            };
        }

        // STEP 2: Re-integrate position with corrected velocity
        this.rawDataBuffer[0].p_raw = Vec3Math.zero(); // Start at origin

        for (let i = 1; i < N; i++) {
            const dt = (this.rawDataBuffer[i].timestamp - this.rawDataBuffer[i - 1].timestamp) / 1000.0;
            // Trapezoidal integration for better accuracy
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

        // STEP 3: BOUNDARY - Force return to origin (p_final = p_initial = 0)
        const p_final_drift = this.rawDataBuffer[N - 1].p_raw;

        // Distribute position drift error linearly
        for (let i = 1; i < N; i++) {
            const ratio = i / (N - 1);
            this.rawDataBuffer[i].p_raw = {
                x: this.rawDataBuffer[i].p_raw.x - (p_final_drift.x * ratio),
                y: this.rawDataBuffer[i].p_raw.y - (p_final_drift.y * ratio),
                z: this.rawDataBuffer[i].p_raw.z - (p_final_drift.z * ratio)
            };
        }

        console.log('[POST-PROC] Corrections Complete.');

        // Calculate VBT metrics using the cleaned data
        this.calculateVBTMetrics();

        // Update the main path array so the UI graph updates
        this.updatePathWithCorrectedData();
    }

    /**
     * Calculate VBT (Velocity-Based Training) metrics
     */
    private calculateVBTMetrics() {
        if (this.rawDataBuffer.length < 10) return;

        console.log('[VBT] Calculating Metrics...');

        // Determine vertical axis based on movement range
        // (Simple heuristic: axis with largest variance)
        // Or assume Z since we rotated to World Frame? 
        // In our Hybrid code, we rotate to World, so Vertical is ALWAYS Z.
        // But we kept the 'verticalAxis' property, let's use Z.

        let v_vertical_max = 0;
        let v_vertical_sum = 0;
        let count_propulsive = 0;
        let concentric_time = 0;

        // Simple Concentric Phase detection: Velocity > 0 (Upward)
        // Since we align gravity to -Z, Up is +Z.

        for (let i = 0; i < this.rawDataBuffer.length; i++) {
            const velZ = this.rawDataBuffer[i].v_raw.z;

            if (velZ > 0.05) { // Threshold 0.05 m/s
                if (velZ > v_vertical_max) v_vertical_max = velZ;
                v_vertical_sum += velZ;
                count_propulsive++;
            }
        }

        const mpv = count_propulsive > 0 ? v_vertical_sum / count_propulsive : 0;

        console.log(`[VBT] Peak Velocity: ${v_vertical_max.toFixed(3)} m/s`);
        console.log(`[VBT] Mean Propulsive Velocity: ${mpv.toFixed(3)} m/s`);
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
}

export const trajectoryService = new TrajectoryService();
