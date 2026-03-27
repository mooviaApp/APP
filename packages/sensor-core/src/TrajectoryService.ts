/**
 * Hybrid Trajectory Service: Stabilized & Visually Corrected
 *
 * This service fuses inertial measurements (accelerometer and gyroscope)
 * into a 3D orientation estimate (using a Madgwick filter) and a 3D
 * position estimate (using a simple per-axis Kalman filter with bias
 * estimation). The service is designed for a strength‑training bar
 * tracking application where the sensor may be mounted at an arbitrary
 * orientation on the bar. It provides real‑time kinematics for UI
 * rendering and records raw data for offline analysis.
 *
 * Key design points:
 * 1. Physics world frame is Z‑up. UI world frame is Y‑up (via a fixed
 *    rotation applied at the end).
 * 2. Orientation is estimated with the Madgwick filter. A small beta
 *    value is used for smoothness. When the bar is detected as
 *    stationary for >0.5 s, pitch/roll are re‑aligned with gravity
 *    while preserving the current yaw.
 * 3. Position is estimated independently along each axis with a
 *    3‑state Kalman filter [position, velocity, accelerometer bias].
 *    When the bar is stationary, ZUPT (Zero Velocity Update) and a
 *    bias update are applied.
 * 4. A fixed mount rotation can be applied to convert from the sensor
 *    coordinate frame to the bar coordinate frame. By default this is
 *    the identity (no rotation) but can be set via setMountRotation().
 * 5. Stationary detection uses a sliding window of the last ~250 ms
 *    worth of accelerometer and gyroscope magnitudes. Both the mean
 *    and standard deviation of these magnitudes are thresholded
 *    independently, with hysteresis on entry/exit.
 * 6. Extensive console logging is included (throttled) to aid in
 *    debugging. Logs report dt, acceleration magnitudes, linear
 *    acceleration, velocity, position and stationary state.
 */

import {
    IMUSample,
    MovementSegment,
    SessionAnalysisSummary,
    SessionMovementMetrics,
    TrajectoryPoint,
    TrajectoryRecord,
} from './types';
import { Vec3, Vec3Math } from './Vec3';
import { Quaternion, QuatMath } from './QuaternionMath';

/**
 * Simple 3‑state Kalman filter for a single axis: position (p),
 * velocity (v) and accelerometer bias (b). The model assumes constant
 * acceleration between samples. When the axis is stationary a ZUPT
 * observation is applied (velocity is zero) along with a bias
 * observation (linear acceleration should be zero). Process and
 * measurement noise values were tuned empirically; adjust Q and R
 * values below as necessary.
 */
class KalmanFilter1D {
    // State x = [p, v, b]
    private x: number[] = [0, 0, 0];
    // Covariance matrix P (3×3)
    private P: number[][] = [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
    ];
    // Process noise Q (tune these to control how much the state can drift)
    private Q: number[][] = [
        [1e-5, 0, 0],    // position noise
        [0, 1e-4, 0],    // velocity noise
        [0, 0, 1e-6],    // bias noise (random walk)
    ];
    // Measurement noise (tune for ZUPT/bias updates)
    private R_v: number = 0.001; // velocity measurement noise
    private R_b: number = 0.01;  // bias measurement noise

    /** Reset the filter state and covariance. */
    reset() {
        this.x = [0, 0, 0];
        this.P = [
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 0.1],
        ];
    }

    /** Predict step: integrate acceleration (minus bias) for dt seconds. */
    predict(acc_in: number, dt: number) {
        if (dt <= 0) return;
        const [p, v, b] = this.x;
        const acc_eff = acc_in - b;
        // State prediction
        this.x[0] = p + v * dt + 0.5 * acc_eff * dt * dt;
        this.x[1] = v + acc_eff * dt;
        this.x[2] = b;
        // Jacobian F
        const F = [
            [1, dt, -0.5 * dt * dt],
            [0, 1, -dt],
            [0, 0, 1],
        ];
        // P = F P F^T + Q
        const P = this.P;
        const FP: number[][] = [
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
        ];
        // FP = F * P
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                FP[i][j] = F[i][0] * P[0][j] + F[i][1] * P[1][j] + F[i][2] * P[2][j];
            }
        }
        const P_next: number[][] = [
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
        ];
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                // F^T: F[j][i]
                P_next[i][j] = FP[i][0] * F[j][0] + FP[i][1] * F[j][1] + FP[i][2] * F[j][2] + this.Q[i][j];
            }
        }
        this.P = P_next;
    }

    /**
     * ZUPT + bias update when stationary. First we observe v = 0,
     * then b = acc_net (approx linear acceleration equals bias).
     */
    updateZUPT(acc_linear_in: number) {
        // 1) velocity measurement v = 0
        this.scalarUpdate(1, 0, this.R_v);
        // 2) bias measurement b = acc_linear_in
        this.scalarUpdate(2, acc_linear_in, this.R_b);
    }

    /**
     * Scalar measurement update on state index `stateIdx` with
     * measurement `measurement` and measurement noise `noiseR`.
     */
    private scalarUpdate(stateIdx: number, measurement: number, noiseR: number) {
        const y = measurement - this.x[stateIdx];
        const S = this.P[stateIdx][stateIdx] + noiseR;
        const K = [
            this.P[0][stateIdx] / S,
            this.P[1][stateIdx] / S,
            this.P[2][stateIdx] / S,
        ];
        // Update state
        this.x[0] += K[0] * y;
        this.x[1] += K[1] * y;
        this.x[2] += K[2] * y;
        // Update covariance
        const P_new: number[][] = [
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0],
        ];
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                P_new[i][j] = this.P[i][j] - K[i] * this.P[stateIdx][j];
            }
        }
        this.P = P_new;
    }

    getPosition() { return this.x[0]; }
    getVelocity() { return this.x[1]; }
    getBias() { return this.x[2]; }
}

/**
 * Madgwick orientation filter. A slightly higher beta (0.033) is used
 * compared to the original code to allow the filter to converge
 * reasonably fast while still smoothing noise.
 */
class Madgwick {
    public q: Quaternion = { w: 1, x: 0, y: 0, z: 0 };
    private beta: number;

    constructor(beta: number = 0.033) {
        this.beta = beta;
    }

    setQuaternion(q: Quaternion) { this.q = { ...q }; }

    update(gx: number, gy: number, gz: number, ax: number, ay: number, az: number, dt: number) {
        let q1 = this.q.w, q2 = this.q.x, q3 = this.q.y, q4 = this.q.z;
        const normRecip = (n: number) => (n === 0 ? 0 : 1 / Math.sqrt(n));

        let qDot1 = 0.5 * (-q2 * gx - q3 * gy - q4 * gz);
        let qDot2 = 0.5 * (q1 * gx + q3 * gz - q4 * gy);
        let qDot3 = 0.5 * (q1 * gy - q2 * gz + q4 * gx);
        let qDot4 = 0.5 * (q1 * gz + q2 * gy - q3 * gx);

        if (!((ax === 0.0) && (ay === 0.0) && (az === 0.0))) {
            let recipNorm = normRecip(ax * ax + ay * ay + az * az);
            ax *= recipNorm; ay *= recipNorm; az *= recipNorm;

            const _2q1 = 2.0 * q1;
            const _2q2 = 2.0 * q2;
            const _2q3 = 2.0 * q3;
            const _2q4 = 2.0 * q4;
            const _4q1 = 4.0 * q1;
            const _4q2 = 4.0 * q2;
            const _4q3 = 4.0 * q3;
            const _8q2 = 8.0 * q2;
            const _8q3 = 8.0 * q3;
            const q1q1 = q1 * q1;
            const q2q2 = q2 * q2;
            const q3q3 = q3 * q3;
            const q4q4 = q4 * q4;

            let s1 = _4q1 * q3q3 + _2q3 * ax + _4q1 * q2q2 - _2q2 * ay;
            let s2 = _4q2 * q4q4 - _2q4 * ax + 4.0 * q1q1 * q2 - _2q1 * ay - _4q2 + _8q2 * q2q2 + _8q2 * q3q3 + _4q2 * az;
            let s3 = 4.0 * q1q1 * q3 + _2q1 * ax + _4q3 * q4q4 - _2q4 * ay - _4q3 + _8q3 * q2q2 + _8q3 * q3q3 + _4q3 * az;
            let s4 = 4.0 * q2q2 * q4 - _2q2 * ax + 4.0 * q3q3 * q4 - _2q3 * ay;

            recipNorm = normRecip(s1 * s1 + s2 * s2 + s3 * s3 + s4 * s4);
            s1 *= recipNorm; s2 *= recipNorm; s3 *= recipNorm; s4 *= recipNorm;

            qDot1 -= this.beta * s1;
            qDot2 -= this.beta * s2;
            qDot3 -= this.beta * s3;
            qDot4 -= this.beta * s4;
        }

        q1 += qDot1 * dt;
        q2 += qDot2 * dt;
        q3 += qDot3 * dt;
        q4 += qDot4 * dt;

        const recipNorm = normRecip(q1 * q1 + q2 * q2 + q3 * q3 + q4 * q4);
        this.q.w = q1 * recipNorm;
        this.q.x = q2 * recipNorm;
        this.q.y = q3 * recipNorm;
        this.q.z = q4 * recipNorm;
    }
}

export class TrajectoryService {
    // Position, velocity and orientation (sensor->world)
    private p: Vec3 = { x: 0, y: 0, z: 0 };
    private v: Vec3 = { x: 0, y: 0, z: 0 };
    private q: Quaternion = { w: 1, x: 0, y: 0, z: 0 };
    // Fixed mount rotation (bar->sensor). Default identity (no rotation).
    private q_mount: Quaternion = { w: 1, x: 0, y: 0, z: 0 };
    // Per‑axis Kalman filters
    private kX: KalmanFilter1D = new KalmanFilter1D();
    private kY: KalmanFilter1D = new KalmanFilter1D();
    private kZ: KalmanFilter1D = new KalmanFilter1D();
    // Orientation filter
    private madgwick: Madgwick = new Madgwick(0.033);
    // Gravity magnitude (m/s^2)
    private readonly GRAVITY = 9.81;
    // Sampling rate expectation (Hz). Determines buffer size for
    // stationary detection. Default 1000 Hz.
    private expectedHz: number = 1000;
    // Sliding window size (number of samples) for stationary detection
    private bufferSize: number = 250; // Default for 1000 Hz @ 250ms window
    // Buffers to hold recent accelerometer and gyro magnitudes
    private accelBuffer: number[] = [];
    private gyroBuffer: number[] = [];
    // Stationary detection state and timers
    private stationaryTick: number = 0;
    private movingTick: number = 0;
    private isStatState: boolean = false;
    // Yaw locking when spin cae por debajo de umbral (reduce deriva lateral)
    private yawLocked: boolean = false;
    private yawLockValue: number = 0; // rad
    private readonly YAW_LOCK_LOW = 5 * Math.PI / 180;   // 5 dps
    private readonly YAW_LOCK_HIGH = 15 * Math.PI / 180; // hysteresis release
    // Logging counter to throttle console output
    private logCounter: number = 0;
    // Raw data buffer for offline post‑processing
    private rawDataBuffer: TrajectoryRecord[] = [];
    // Last timestamp processed (ms)
    private lastTimestamp: number = 0;
    // Path of computed points for UI
    private path: TrajectoryPoint[] = [];
    private fullPath: TrajectoryPoint[] = [];
    private activeRawData: TrajectoryRecord[] = [];
    private sessionAnalysis: SessionAnalysisSummary | null = null;
    // Last emitted point (for hold cases)
    private lastPoint: TrajectoryPoint | null = null;
    // Calibration state and buffer
    private isCalibrating: boolean = false;
    private calibrationBuffer: IMUSample[] = [];
    // Orientation initialisation flag
    private isOrientationInitialized: boolean = false;
    // Baseline position for relative position calculation
    private baselineP: Vec3 = { x: 0, y: 0, z: 0 };
    // Real‑time streaming flag: if false, path is not updated and zero
    private realtimeEnabled: boolean = false;
    // Gravity estimation using low-pass filter (for instantaneous gravity compensation)
    private gravity_estimate: Vec3 = { x: 0, y: 0, z: 9.81 };
    private readonly GRAVITY_ALPHA = 0.98; // Low-pass filter coefficient (98% old, 2% new)
    private lastIsStat: boolean = false;
    // Bar sleeve spin compensation
    private barAxis: Vec3 | null = null; // unit vector in sensor frame
    private barAxisBuffer: Vec3[] = [];
    private readonly BAR_AXIS_SAMPLES = 600; // ~0.6s @1kHz
    // Rep state machine
    private repState: 'IDLE' | 'MOVING' | 'APEX' | 'RETURN' = 'IDLE';
    private maxLateral: number = 0;
    private readonly MIN_IDLE_SECONDS = 0.4;
    private readonly MIN_MOVEMENT_SECONDS = 0.08;
    private readonly MOVEMENT_LIN_ACC_THRESHOLD = 0.35;
    private readonly MOVEMENT_VZ_THRESHOLD = 0.05;

    constructor(expectedHz: number = 1000) {
        this.setExpectedHz(expectedHz);
        this.reset();
    }

    /**
     * Set the expected sampling rate (Hz). This affects the stationary
     * detection window. Call before reset().
     */
    public setExpectedHz(hz: number) {
        this.expectedHz = Math.max(10, hz);
        this.bufferSize = Math.max(10, Math.round(this.expectedHz * 0.25));
    }

    /**
     * Set a fixed mount rotation from bar frame to sensor frame. If the
     * sensor is mounted such that its axes do not align with the bar
     * axes, supply the orientation of the bar relative to the sensor.
     * This rotation will be applied when computing the bar's orientation
     * for display. The provided quaternion will be normalized.
     */
    public setMountRotation(q: Quaternion) {
        this.q_mount = QuatMath.normalize(q);
    }

    /** Fully reset the service state. Position and velocity are zeroed,
     * orientation reset, kalman filters reset, and buffers cleared. Raw
     * data buffer is preserved across resets to enable offline analysis.
     */
    public reset() {
        console.log('[Hybrid] Full Reset...');
        this.p = Vec3Math.zero();
        this.v = Vec3Math.zero();
        this.q = { w: 1, x: 0, y: 0, z: 0 };
        this.madgwick = new Madgwick(0.033);
        this.kX.reset();
        this.kY.reset();
        this.kZ.reset();
        this.isOrientationInitialized = false;
        this.lastTimestamp = 0;
        this.path = [];
        this.fullPath = [];
        this.activeRawData = [];
        this.sessionAnalysis = null;
        this.lastPoint = null;
        this.accelBuffer = [];
        this.gyroBuffer = [];
        // Clear rawDataBuffer to start fresh for each new session
        this.rawDataBuffer = [];
        this.baselineP = Vec3Math.zero();
        this.stationaryTick = 0;
        this.movingTick = 0;
        this.isStatState = false;
        this.yawLocked = false;
        this.yawLockValue = 0;
        // Reset gravity estimate to default [0, 0, 9.81]
        this.gravity_estimate = { x: 0, y: 0, z: this.GRAVITY };
        // Reset bar spin estimation
        this.barAxis = null;
        this.barAxisBuffer = [];
        // Reset rep tracking
        this.repState = 'IDLE';
        this.maxLateral = 0;
    }

    /** Reset only the kinematic state (position, velocity, kalman) while
     * preserving the raw data buffer and mount rotation. This is
     * invoked automatically when a large gap in timestamps is
     * encountered or when calibration completes.
     */
    public resetKinematics() {
        this.p = Vec3Math.zero();
        this.v = Vec3Math.zero();
        this.path = [];
        this.fullPath = [];
        this.activeRawData = [];
        this.sessionAnalysis = null;
        this.lastPoint = null;
        this.baselineP = Vec3Math.zero();
        this.kX.reset();
        this.kY.reset();
        this.kZ.reset();
        this.accelBuffer = [];
        this.gyroBuffer = [];
        this.stationaryTick = 0;
        this.movingTick = 0;
        this.isStatState = false;
        // Keep gravity estimate across kinematic resets for continuity
        console.log('[Hybrid] Kinematics Reset');
    }

    /** Process a single IMU sample. Returns a TrajectoryPoint for
     * rendering. If realtimeEnabled is false, relative position and
     * position are always zero to avoid moving the UI. However,
     * internal integration and raw data recording still occur. */
    public processSample(sample: IMUSample): TrajectoryPoint {
        const t = sample.timestampMs;
        // During calibration, just collect samples and return a
        // placeholder. Calibration will set orientation later.
        if (this.isCalibrating) {
            this.calibrationBuffer.push(sample);
            const out: TrajectoryPoint = {
                timestamp: t,
                position: Vec3Math.zero(),
                rotation: { ...this.q },
                relativePosition: Vec3Math.zero(),
            };
            this.lastPoint = out;
            return out;
        }

        // Convert raw sample to m/s^2 and rad/s
        const a_meas: Vec3 = {
            x: sample.ax * this.GRAVITY,
            y: sample.ay * this.GRAVITY,
            z: sample.az * this.GRAVITY,
        };
        let w_meas: Vec3 = {
            x: sample.gx * (Math.PI / 180),
            y: sample.gy * (Math.PI / 180),
            z: sample.gz * (Math.PI / 180),
        };

        // Collect gyro for bar-axis estimation (~0.6s inicial)
        if (this.barAxisBuffer.length < this.BAR_AXIS_SAMPLES && !this.isCalibrating) {
            this.barAxisBuffer.push({ ...w_meas });
            if (this.barAxisBuffer.length === this.BAR_AXIS_SAMPLES) {
                this.barAxis = this.estimateBarAxis(this.barAxisBuffer);
            }
        }

        // Si tenemos eje de barra, eliminamos la componente de giro alrededor de él (spin de manga)
        if (this.barAxis) {
            const dot = w_meas.x * this.barAxis.x + w_meas.y * this.barAxis.y + w_meas.z * this.barAxis.z;
            w_meas = {
                x: w_meas.x - dot * this.barAxis.x,
                y: w_meas.y - dot * this.barAxis.y,
                z: w_meas.z - dot * this.barAxis.z
            };
        }

        // Initialize orientation using either calibration buffer or the
        // first sample. We require at least one sample of data to
        // determine gravity. If orientation is already initialized,
        // skip this block.
        if (!this.isOrientationInitialized) {
            this.lastTimestamp = t;
            let qInit: Quaternion;
            // If calibrationBuffer contains data, compute average accel
            if (this.calibrationBuffer.length > 0) {
                let sumAx = 0, sumAy = 0, sumAz = 0;
                for (const s of this.calibrationBuffer) {
                    sumAx += s.ax * this.GRAVITY;
                    sumAy += s.ay * this.GRAVITY;
                    sumAz += s.az * this.GRAVITY;
                }
                const n = this.calibrationBuffer.length;
                const avgAx = sumAx / n;
                const avgAy = sumAy / n;
                const avgAz = sumAz / n;
                qInit = this.getRotationFromGravity(avgAx, avgAy, avgAz);
                console.log('[Hybrid] Initial orientation computed from calibration buffer');
                // Clear calibration buffer after use
                this.calibrationBuffer = [];
            } else {
                // Fallback: single sample init
                qInit = this.getRotationFromGravity(a_meas.x, a_meas.y, a_meas.z);
                console.log('[Hybrid] Hot Start executed on first sample');
            }
            this.q = qInit;
            this.madgwick.setQuaternion(qInit);
            this.isOrientationInitialized = true;
            // Reset kinematics when orientation is initialised to avoid
            // integrating stale data. Preserve raw data buffer.
            this.resetKinematics();
            const out: TrajectoryPoint = {
                timestamp: t,
                position: Vec3Math.zero(),
                rotation: { ...this.q },
                relativePosition: Vec3Math.zero(),
            };
            this.lastPoint = out;
            return out;
        }

        // Compute dt (s) from timestamp differences
        let dt = (t - this.lastTimestamp) / 1000.0;
        this.lastTimestamp = t;

        // Invalid or duplicate sample
        if (dt <= 0) {
            return this.getLastPoint(t);
        }

        // If dt is suspiciously large (>0.2 s), reset kinematics and
        // require reinitialisation of orientation on next sample. A
        // connection drop or pause likely occurred.
        if (dt > 0.2) {
            console.warn(`[Hybrid] Large gap detected (${dt.toFixed(3)} s). Resetting kinematics.`);
            this.resetKinematics();
            this.isOrientationInitialized = false;
            const out: TrajectoryPoint = {
                timestamp: t,
                position: Vec3Math.zero(),
                rotation: { ...this.q },
                relativePosition: Vec3Math.zero(),
            };
            this.lastPoint = out;
            return out;
        }

        // If dt is moderately large (>50 ms) but not huge, we simply
        // hold the last point. We do not integrate orientation or
        // kinematics in this window to avoid jumps.
        if (dt > 0.05) {
            return this.getLastPoint(t);
        }

        // Update sliding buffers for stationary detection
        const w_mag = Math.sqrt(w_meas.x * w_meas.x + w_meas.y * w_meas.y + w_meas.z * w_meas.z);
        this.updateBuffers(a_meas, w_meas);
        const { isCandidate, metrics } = this.checkStationaryCandidate();
        if (isCandidate) {
            this.stationaryTick += dt;
            this.movingTick = 0;
        } else {
            this.movingTick += dt;
            this.stationaryTick = 0;
        }
        // Hysteresis: enter stationary after ~450 ms; exit after short movement
        if (!this.isStatState && this.stationaryTick > 0.45) {
            this.isStatState = true;
            console.log('[Hybrid] → STATIONARY');
        } else if (this.isStatState && this.movingTick > 0.1) {
            this.isStatState = false;
            console.log('[Hybrid] STATIONARY → MOVING');
        }
        const isStat = this.isStatState;

        // When stationary for >0.5 s, realign pitch/roll to gravity.  We
        // preserve the current yaw while re‑aligning the measured
        // gravity vector with the +Z axis. Since QuatMath does not
        // expose a general axis‑angle constructor, construct a yaw
        // quaternion manually.
        if (isStat && this.stationaryTick > 0.5) {
            const euler = this.toEuler(this.q);
            const yaw = euler.z;
            const halfYaw = yaw * 0.5;
            const q_yaw = { w: Math.cos(halfYaw), x: 0, y: 0, z: Math.sin(halfYaw) } as Quaternion;
            const q_gravity = this.getRotationFromGravity(a_meas.x, a_meas.y, a_meas.z);
            // Compose yaw then gravity: q_new = q_yaw ⊗ q_gravity
            const q_new = QuatMath.normalize(QuatMath.multiply(q_yaw, q_gravity));
            this.q = q_new;
            this.madgwick.setQuaternion(this.q);
        }

        // Lock/unlock yaw to reduce lateral drift when the spin stops
        if (!this.yawLocked && w_mag < this.YAW_LOCK_LOW) {
            const e = this.toEuler(this.q);
            this.yawLockValue = e.z;
            this.yawLocked = true;
            console.log('[Hybrid] Yaw locked');
        } else if (this.yawLocked && w_mag > this.YAW_LOCK_HIGH) {
            this.yawLocked = false;
            console.log('[Hybrid] Yaw unlocked');
        }

        // Update orientation with Madgwick (for visualization only, not used for gravity compensation)
        this.madgwick.update(w_meas.x, w_meas.y, w_meas.z, a_meas.x, a_meas.y, a_meas.z, dt);
        this.q = { ...this.madgwick.q };
        if (this.yawLocked) {
            const e = this.toEuler(this.q);
            this.q = this.fromEuler(e.x, e.y, this.yawLockValue);
        }

        // Rotate measured acceleration to world frame before gravity removal
        const a_world = QuatMath.rotate(this.q, a_meas);

        // Outlier guard: descartar picos imposibles (>30 m/s^2)
        const a_world_mag = Math.sqrt(a_world.x * a_world.x + a_world.y * a_world.y + a_world.z * a_world.z);
        if (a_world_mag > 30) {
            return this.getLastPoint(t);
        }

        // Adaptive gravity estimate: más lenta en reposo, más rápida en movimiento
        const alpha = isStat ? this.GRAVITY_ALPHA : 0.7;
        this.gravity_estimate.x = alpha * this.gravity_estimate.x + (1 - alpha) * a_world.x;
        this.gravity_estimate.y = alpha * this.gravity_estimate.y + (1 - alpha) * a_world.y;
        this.gravity_estimate.z = alpha * this.gravity_estimate.z + (1 - alpha) * a_world.z;

        // Re-normalizar la gravedad estimada a 9.81 para evitar deriva por magnitud
        const gMag = Math.sqrt(this.gravity_estimate.x ** 2 + this.gravity_estimate.y ** 2 + this.gravity_estimate.z ** 2);
        if (gMag > 1e-3) {
            const scale = 9.81 / gMag;
            this.gravity_estimate.x *= scale;
            this.gravity_estimate.y *= scale;
            this.gravity_estimate.z *= scale;
        }

        // Compute linear acceleration in world frame by subtracting estimated gravity
        const acc_net = {
            x: a_world.x - this.gravity_estimate.x,
            y: a_world.y - this.gravity_estimate.y,
            z: a_world.z - this.gravity_estimate.z
        };

        // Clip pequeños offsets para limitar drift acumulado
        const clip = (v: number, thresh = 0.005) => Math.abs(v) < thresh ? 0 : v;
        acc_net.x = clip(acc_net.x);
        acc_net.y = clip(acc_net.y);
        acc_net.z = clip(acc_net.z);
        // Clamp para evitar overshoots por picos aislados
        const clamp = (v: number, limit = 15) => Math.max(-limit, Math.min(limit, v));
        acc_net.x = clamp(acc_net.x);
        acc_net.y = clamp(acc_net.y);
        acc_net.z = clamp(acc_net.z);

        // Integrate kinematics via Kalman
        if (!isStat) {
            this.kX.predict(acc_net.x, dt);
            this.kY.predict(acc_net.y, dt);
            this.kZ.predict(acc_net.z, dt);
        } else {
            this.kX.predict(acc_net.x, dt); this.kX.updateZUPT(acc_net.x);
            this.kY.predict(acc_net.y, dt); this.kY.updateZUPT(acc_net.y);
            this.kZ.predict(acc_net.z, dt); this.kZ.updateZUPT(acc_net.z);
            // Zero velocity explicitly en reposo
            this.v = Vec3Math.zero();
            // Baseline lateral al estabilizar; mantener Z para conservar altura absoluta
            this.baselineP = { x: this.p.x, y: this.p.y, z: this.baselineP.z };
        }

        // Update position and velocity from Kalman filters
        this.p = { x: this.kX.getPosition(), y: this.kY.getPosition(), z: this.kZ.getPosition() };
        this.v = { x: this.kX.getVelocity(), y: this.kY.getVelocity(), z: this.kZ.getVelocity() };
        const relP = Vec3Math.sub(this.p, this.baselineP);
        // Track lateral deviation (sqrt(x^2 + y^2))
        const lateral = Math.sqrt(relP.x * relP.x + relP.y * relP.y);
        if (lateral > this.maxLateral) this.maxLateral = lateral;

        // Record raw data for offline analysis and segmentation diagnostics
        const linAccMag = Math.sqrt(acc_net.x ** 2 + acc_net.y ** 2 + acc_net.z ** 2);
        this.rawDataBuffer.push({
            timestamp: t,
            acc_net,
            q: { ...this.q },
            p_raw: { ...this.p },
            v_raw: { ...this.v },
            isStationary: isStat,
            linAccMag,
            gyroMagDps: w_mag * (180 / Math.PI),
            dtMs: dt * 1000,
        });

        // Throttled logging: every ~50 samples (~20 Hz at 1000 Hz ODR)
        this.logCounter++;
        if (this.logCounter % 50 === 0) {
            const aMag = Math.sqrt(a_world.x ** 2 + a_world.y ** 2 + a_world.z ** 2);
            const gEst = Math.sqrt(this.gravity_estimate.x ** 2 + this.gravity_estimate.y ** 2 + this.gravity_estimate.z ** 2);
            console.log(
                `[Hybrid] Stat:${isStat} dt:${dt.toFixed(4)} |a|:${aMag.toFixed(2)} |gEst|:${gEst.toFixed(2)} |aLin|:${linAccMag.toFixed(3)} v:(${this.v.x.toFixed(3)},${this.v.y.toFixed(3)},${this.v.z.toFixed(3)}) p:(${this.p.x.toFixed(3)},${this.p.y.toFixed(3)},${this.p.z.toFixed(3)})`);
            // Optional: log stationary metrics to debug detection
            if (metrics.meanA !== undefined) {
                console.log(
                    `[Hybrid] StatMetrics meanA:${metrics.meanA.toFixed(2)} stdA:${metrics.stdA.toFixed(2)} meanW:${metrics.meanW.toFixed(3)} stdW:${metrics.stdW.toFixed(3)}`

                );
            }
        }

        // Build output point. If realtimeEnabled is false, return zeros to avoid moving UI.
        // Compute bar orientation by applying mount rotation: q_bar_world = q_sensor_world ⊗ q_mount.
        const q_bar_world = QuatMath.multiply(this.q, this.q_mount);
        // Apply -90° rotation about X to convert Z‑up world to Y‑up UI.
        const fix = { w: Math.SQRT1_2, x: -Math.SQRT1_2, y: 0, z: 0 };
        const q_visual = QuatMath.normalize(QuatMath.multiply(fix, q_bar_world));

        const point: TrajectoryPoint = {
            timestamp: t,
            position: { ...this.p },
            rotation: q_visual,
            relativePosition: relP,
        };

        // Re-baseline al salir de estacionario para eliminar offset acumulado
        if (this.lastIsStat && !isStat) {
            // Re-baseline lateral only when saliendo de reposo
            this.baselineP = { x: this.p.x, y: this.p.y, z: this.baselineP.z };
        }
        this.lastIsStat = isStat;

        // Always update lastPoint even if not emitting to UI
        this.lastPoint = point;

        if (!this.realtimeEnabled) {
            // Return zeroed position to UI while still updating internal state
            return {
                timestamp: t,
                position: Vec3Math.zero(),
                rotation: q_visual,
                relativePosition: Vec3Math.zero(),
            };
        }

        // Append to path for realtime UI
        this.path.push(point);
        this.updateRepState(point);
        return point;
    }

    /** Compute a rotation quaternion from measured gravity. Given an
     * accelerometer reading (ax,ay,az), returns a quaternion that
     * rotates the body frame so that the gravity vector points along
     * the +Z world axis. */
    private getRotationFromGravity(ax: number, ay: number, az: number): Quaternion {
        const norm = Math.sqrt(ax * ax + ay * ay + az * az);
        if (norm === 0) return { w: 1, x: 0, y: 0, z: 0 };
        const u = { x: ax / norm, y: ay / norm, z: az / norm };
        const v = { x: 0, y: 0, z: 1 }; // target world +Z
        const dot = u.x * v.x + u.y * v.y + u.z * v.z;
        if (dot > 0.999) return { w: 1, x: 0, y: 0, z: 0 };
        if (dot < -0.999) return { w: 0, x: 1, y: 0, z: 0 };
        const w = 1 + dot;
        const x = u.y * v.z - u.z * v.y;
        const y = u.z * v.x - u.x * v.z;
        const z = u.x * v.y - u.y * v.x;
        return QuatMath.normalize({ w, x, y, z });
    }

    /** Update the sliding buffers with the magnitude of the
     * accelerometer and gyroscope measurements. */
    private updateBuffers(a: Vec3, w: Vec3) {
        const a_mag = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
        const w_mag = Math.sqrt(w.x * w.x + w.y * w.y + w.z * w.z);
        this.accelBuffer.push(a_mag);
        this.gyroBuffer.push(w_mag);
        if (this.accelBuffer.length > this.bufferSize) this.accelBuffer.shift();
        if (this.gyroBuffer.length > this.bufferSize) this.gyroBuffer.shift();
    }

    /** Estima el eje principal de giro (barAxis) a partir de muestras de gyro. */
    private estimateBarAxis(buf: Vec3[]): Vec3 {
        // Media de omega
        let sx = 0, sy = 0, sz = 0;
        buf.forEach(w => { sx += w.x; sy += w.y; sz += w.z; });
        const n = buf.length || 1;
        const axis = Vec3Math.normalize({ x: sx / n, y: sy / n, z: sz / n });
        // Fallback si norma ~0
        const norm = Vec3Math.norm(axis);
        if (norm < 1e-3) return { x: 0, y: 0, z: 1 };
        return axis;
    }

    /** Actualiza máquina de estados de repetición para consolidar métricas al cerrar ciclo. */
    private updateRepState(_: TrajectoryPoint) {
        const vz = this.v.z;
        const moving = Math.abs(vz) > 0.05;

        switch (this.repState) {
            case 'IDLE':
                if (moving) this.repState = 'MOVING';
                break;
            case 'MOVING':
                if (vz <= 0) this.repState = 'APEX';
                break;
            case 'APEX':
                if (vz < -0.05) this.repState = 'RETURN';
                break;
            case 'RETURN':
                if (this.isStatState) {
                    // Al cerrar rep en reposo, fijar baseline para siguiente rep
                    this.baselineP = { ...this.p };
                    this.repState = 'IDLE';
                }
                break;
        }
    }

    /** Determine whether the sensor is currently stationary based on
     * recent accelerometer and gyroscope magnitudes. Returns
     * isCandidate along with diagnostic metrics. */
    private checkStationaryCandidate(): { isCandidate: boolean; metrics: any } {
        if (this.accelBuffer.length < this.bufferSize) {
            return { isCandidate: false, metrics: {} };
        }
        const mean = (arr: number[]) => arr.reduce((s, x) => s + x, 0) / arr.length;
        const variance = (arr: number[], m: number) => arr.reduce((s, x) => s + (x - m) * (x - m), 0) / arr.length;
        const meanA = mean(this.accelBuffer);
        const meanW = mean(this.gyroBuffer);
        const stdA = Math.sqrt(variance(this.accelBuffer, meanA));
        const stdW = Math.sqrt(variance(this.gyroBuffer, meanW));
        // Thresholds afinados para detectar reposo m\u00e1s r\u00e1pido
        const isAccelStable = Math.abs(meanA - this.GRAVITY) < 0.3 && stdA < 0.08;
        const isGyroStable = meanW < 0.087 && stdW < 0.03; // 5 dps
        return {
            isCandidate: isAccelStable && isGyroStable,
            metrics: { meanA, stdA, meanW, stdW },
        };
    }

    /** Convert quaternion to Euler angles (roll, pitch, yaw). Returns
     * angles in radians. */
    private toEuler(q: Quaternion): { x: number; y: number; z: number } {
        const sinr_cosp = 2 * (q.w * q.x + q.y * q.z);
        const cosr_cosp = 1 - 2 * (q.x * q.x + q.y * q.y);
        const roll = Math.atan2(sinr_cosp, cosr_cosp);
        const sinp = 2 * (q.w * q.y - q.z * q.x);
        let pitch: number;
        if (Math.abs(sinp) >= 1) {
            pitch = Math.sign(sinp) * (Math.PI / 2);
        } else {
            pitch = Math.asin(sinp);
        }
        const siny_cosp = 2 * (q.w * q.z + q.x * q.y);
        const cosy_cosp = 1 - 2 * (q.y * q.y + q.z * q.z);
        const yaw = Math.atan2(siny_cosp, cosy_cosp);
        return { x: roll, y: pitch, z: yaw };
    }

    /** Build quaternion from roll/pitch/yaw (radians). */
    private fromEuler(roll: number, pitch: number, yaw: number): Quaternion {
        const cr = Math.cos(roll * 0.5), sr = Math.sin(roll * 0.5);
        const cp = Math.cos(pitch * 0.5), sp = Math.sin(pitch * 0.5);
        const cy = Math.cos(yaw * 0.5), sy = Math.sin(yaw * 0.5);
        return QuatMath.normalize({
            w: cr * cp * cy + sr * sp * sy,
            x: sr * cp * cy - cr * sp * sy,
            y: cr * sp * cy + sr * cp * sy,
            z: cr * cp * sy - sr * sp * cy,
        });
    }

    /** Returns the last emitted TrajectoryPoint or a zeroed point if
     * none exists. */
    private getLastPoint(nowTs: number): TrajectoryPoint {
        if (this.lastPoint) return this.lastPoint;
        return {
            timestamp: nowTs,
            position: Vec3Math.zero(),
            rotation: { w: 1, x: 0, y: 0, z: 0 },
            relativePosition: Vec3Math.zero(),
        };
    }

    private getEmptyMetrics(): SessionMovementMetrics {
        return {
            peakLinearAcc: 0,
            meanPropulsiveVelocity: 0,
            maxHeight: 0,
            finalHeight: 0,
            maxLateral: 0,
            finalLateral: 0,
        };
    }

    private getFixRotation(): Quaternion {
        return { w: Math.SQRT1_2, x: -Math.SQRT1_2, y: 0, z: 0 };
    }

    private buildPathFromRecords(records: TrajectoryRecord[], baseline: Vec3): TrajectoryPoint[] {
        const fix = this.getFixRotation();
        return records.map((record) => {
            const q_bar_world = QuatMath.multiply(record.q, this.q_mount);
            const q_visual = QuatMath.normalize(QuatMath.multiply(fix, q_bar_world));
            return {
                timestamp: record.timestamp,
                position: { ...record.p_raw },
                rotation: q_visual,
                relativePosition: {
                    x: record.p_raw.x - baseline.x,
                    y: record.p_raw.y - baseline.y,
                    z: record.p_raw.z - baseline.z,
                },
            };
        });
    }

    private getDurationMs(startIndex: number, endIndex: number): number {
        if (endIndex < startIndex) return 0;
        const start = this.rawDataBuffer[startIndex];
        const end = this.rawDataBuffer[endIndex];
        if (!start || !end) return 0;
        return (end.timestamp - start.timestamp) + (end.dtMs ?? 0);
    }

    private findStationarySegments(): Array<{ startIndex: number; endIndex: number; durationMs: number }> {
        const segments: Array<{ startIndex: number; endIndex: number; durationMs: number }> = [];
        let segmentStart = -1;

        for (let i = 0; i < this.rawDataBuffer.length; i++) {
            const isStat = !!this.rawDataBuffer[i].isStationary;
            if (isStat && segmentStart === -1) {
                segmentStart = i;
            } else if (!isStat && segmentStart !== -1) {
                const endIndex = i - 1;
                segments.push({
                    startIndex: segmentStart,
                    endIndex,
                    durationMs: this.getDurationMs(segmentStart, endIndex),
                });
                segmentStart = -1;
            }
        }

        if (segmentStart !== -1) {
            const endIndex = this.rawDataBuffer.length - 1;
            segments.push({
                startIndex: segmentStart,
                endIndex,
                durationMs: this.getDurationMs(segmentStart, endIndex),
            });
        }

        return segments.filter((segment) => segment.durationMs >= this.MIN_IDLE_SECONDS * 1000);
    }

    private isMovementRecord(record: TrajectoryRecord): boolean {
        return (record.linAccMag ?? 0) > this.MOVEMENT_LIN_ACC_THRESHOLD
            || Math.abs(record.v_raw.z) > this.MOVEMENT_VZ_THRESHOLD;
    }

    private detectMovementStart(fromIndex: number, toIndex: number): number {
        if (toIndex < fromIndex) return fromIndex;

        let activeMs = 0;
        let candidateStart = fromIndex;

        for (let i = fromIndex; i <= toIndex; i++) {
            const record = this.rawDataBuffer[i];
            const dtMs = Math.max(record.dtMs ?? 0, 1);
            if (this.isMovementRecord(record)) {
                if (activeMs === 0) candidateStart = i;
                activeMs += dtMs;
                if (activeMs >= this.MIN_MOVEMENT_SECONDS * 1000) {
                    return candidateStart;
                }
            } else {
                activeMs = 0;
            }
        }

        return fromIndex;
    }

    private detectFallbackMovementEnd(fromIndex: number, toIndex: number): number {
        if (toIndex < fromIndex) return fromIndex;

        let activeMs = 0;
        let lastConfirmedEnd = fromIndex;

        for (let i = fromIndex; i <= toIndex; i++) {
            const record = this.rawDataBuffer[i];
            const dtMs = Math.max(record.dtMs ?? 0, 1);
            if (this.isMovementRecord(record)) {
                activeMs += dtMs;
                if (activeMs >= this.MIN_MOVEMENT_SECONDS * 1000) {
                    lastConfirmedEnd = i;
                }
            } else {
                activeMs = 0;
            }
        }

        return Math.max(fromIndex, lastConfirmedEnd);
    }

    private averagePosition(startIndex: number, endIndex: number): Vec3 {
        if (endIndex < startIndex) {
            return this.rawDataBuffer[0]?.p_raw ? { ...this.rawDataBuffer[0].p_raw } : Vec3Math.zero();
        }

        let sx = 0;
        let sy = 0;
        let sz = 0;
        let count = 0;
        for (let i = startIndex; i <= endIndex; i++) {
            const position = this.rawDataBuffer[i]?.p_raw;
            if (!position) continue;
            sx += position.x;
            sy += position.y;
            sz += position.z;
            count++;
        }

        if (count === 0) {
            return this.rawDataBuffer[0]?.p_raw ? { ...this.rawDataBuffer[0].p_raw } : Vec3Math.zero();
        }

        return { x: sx / count, y: sy / count, z: sz / count };
    }

    private computeActiveBaseline(initialIdle: { startIndex: number; endIndex: number } | null): Vec3 {
        if (!initialIdle) {
            return this.rawDataBuffer[0]?.p_raw ? { ...this.rawDataBuffer[0].p_raw } : Vec3Math.zero();
        }

        const endRecord = this.rawDataBuffer[initialIdle.endIndex];
        const windowStartTs = endRecord.timestamp - 100;
        let windowStartIndex = initialIdle.startIndex;
        for (let i = initialIdle.endIndex; i >= initialIdle.startIndex; i--) {
            if (this.rawDataBuffer[i].timestamp < windowStartTs) {
                windowStartIndex = i + 1;
                break;
            }
            windowStartIndex = i;
        }

        return this.averagePosition(windowStartIndex, initialIdle.endIndex);
    }

    private relativeFromBaseline(position: Vec3, baseline: Vec3): Vec3 {
        return {
            x: position.x - baseline.x,
            y: position.y - baseline.y,
            z: position.z - baseline.z,
        };
    }

    private computeMovementMetrics(
        records: TrajectoryRecord[],
        path: TrajectoryPoint[],
        settledFinalRelative?: Vec3,
    ): SessionMovementMetrics {
        if (records.length === 0 || path.length === 0) return this.getEmptyMetrics();

        let peakLinearAcc = 0;
        let sumVelocity = 0;
        let velocityCount = 0;
        let maxHeight = path[0].relativePosition.z;
        let maxLateral = 0;

        for (const record of records) {
            const magnitude = record.linAccMag ?? Math.sqrt(
                record.acc_net.x * record.acc_net.x +
                record.acc_net.y * record.acc_net.y +
                record.acc_net.z * record.acc_net.z
            );
            if (magnitude > peakLinearAcc) peakLinearAcc = magnitude;
            if (record.v_raw.z > this.MOVEMENT_VZ_THRESHOLD) {
                sumVelocity += record.v_raw.z;
                velocityCount++;
            }
        }

        for (const point of path) {
            if (point.relativePosition.z > maxHeight) {
                maxHeight = point.relativePosition.z;
            }
            const lateral = Math.hypot(point.relativePosition.x, point.relativePosition.y);
            if (lateral > maxLateral) {
                maxLateral = lateral;
            }
        }

        const lastPoint = path[path.length - 1];
        const finalRelative = settledFinalRelative ?? lastPoint.relativePosition;
        return {
            peakLinearAcc,
            meanPropulsiveVelocity: velocityCount > 0 ? sumVelocity / velocityCount : 0,
            maxHeight,
            finalHeight: finalRelative.z,
            maxLateral,
            finalLateral: Math.hypot(finalRelative.x, finalRelative.y),
        };
    }

    private buildSessionAnalysis(): SessionAnalysisSummary {
        const emptyMetrics = this.getEmptyMetrics();
        if (this.rawDataBuffer.length === 0) {
            return {
                movementSegment: null,
                movementMetrics: emptyMetrics,
                activePath: [],
                fullPath: [],
            };
        }

        const stationarySegments = this.findStationarySegments();
        const initialIdle = stationarySegments.length > 0 ? stationarySegments[0] : null;
        const movementSearchStart = initialIdle ? Math.min(initialIdle.endIndex + 1, this.rawDataBuffer.length - 1) : 0;
        const movementStart = this.detectMovementStart(movementSearchStart, this.rawDataBuffer.length - 1);
        const finalIdle = [...stationarySegments]
            .reverse()
            .find((segment) => segment.startIndex > movementStart) ?? null;

        let confidence: MovementSegment['confidence'] = 'segmented';
        if (!initialIdle || !finalIdle) {
            confidence = 'fallback';
        }

        let movementEnd = finalIdle
            ? Math.max(movementStart, finalIdle.startIndex - 1)
            : this.detectFallbackMovementEnd(movementStart, this.rawDataBuffer.length - 1);

        if (movementEnd < movementStart) {
            movementEnd = movementStart;
            confidence = 'insufficient';
        }

        const baseline = this.computeActiveBaseline(initialIdle);
        const fullPath = this.buildPathFromRecords(this.rawDataBuffer, baseline);
        const activeRawData = this.rawDataBuffer.slice(movementStart, movementEnd + 1);
        const activePath = fullPath.slice(movementStart, movementEnd + 1);
        const settledFinalPosition = finalIdle
            ? this.averagePosition(finalIdle.startIndex, finalIdle.endIndex)
            : activeRawData[activeRawData.length - 1]?.p_raw ?? this.rawDataBuffer[movementEnd].p_raw;
        const metrics = this.computeMovementMetrics(
            activeRawData,
            activePath,
            this.relativeFromBaseline(settledFinalPosition, baseline),
        );

        this.activeRawData = activeRawData;
        this.fullPath = fullPath;
        this.path = activePath;
        this.maxLateral = metrics.maxLateral;

        return {
            movementSegment: {
                startIndex: movementStart,
                endIndex: movementEnd,
                startTimeMs: this.rawDataBuffer[movementStart]?.timestamp ?? this.rawDataBuffer[0].timestamp,
                endTimeMs: this.rawDataBuffer[movementEnd]?.timestamp ?? this.rawDataBuffer[this.rawDataBuffer.length - 1].timestamp,
                initialIdleMs: initialIdle?.durationMs ?? 0,
                finalIdleMs: finalIdle?.durationMs ?? 0,
                confidence,
            },
            movementMetrics: metrics,
            activePath,
            fullPath,
        };
    }

    /** Returns the recorded active path of trajectory points. */
    public getPath() { return this.path; }
    /** Returns the full post-processed path for the complete session. */
    public getFullPath() { return this.fullPath; }
    /**
     * Returns the current orientation of the bar for UI. The raw
     * sensor orientation (sensor->world) is first combined with the
     * fixed mount rotation (bar->sensor) to produce the bar
     * orientation (bar->world). Then a -90?? rotation about the X axis
     * is applied to convert from the physics Z???up coordinate frame to
     * the UI Y???up coordinate frame. The returned quaternion can be
     * passed directly to the OrientationViz component.
     */
    public getOrientation() {
        const q_bar_world = QuatMath.multiply(this.q, this.q_mount);
        const fix = this.getFixRotation();
        return QuatMath.normalize(QuatMath.multiply(fix, q_bar_world));
    }
    /** Returns the current linear velocity vector. */
    public getVelocity() { return this.v; }
    /** Returns whether the sensor is currently calibrating. */
    public getIsCalibrating() { return this.isCalibrating; }

    /** Begin calibration. Samples will be collected for `d` milliseconds
     * to compute a robust initial orientation based on the average
     * accelerometer reading. During calibration the processSample
     * method will return zeroed points. After calibration completes,
     * the orientation is initialised from the buffered samples and
     * kinematics are reset. */
    public async calibrateAsync(d: number = 2000) {
        this.isCalibrating = true;
        this.calibrationBuffer = [];
        console.log('[Hybrid] Calibration started');
        await new Promise((resolve) => setTimeout(resolve, d));
        this.isCalibrating = false;
        // Compute average acceleration from calibration buffer
        if (this.calibrationBuffer.length > 0) {
            let sumAx = 0, sumAy = 0, sumAz = 0;
            for (const s of this.calibrationBuffer) {
                sumAx += s.ax * this.GRAVITY;
                sumAy += s.ay * this.GRAVITY;
                sumAz += s.az * this.GRAVITY;
            }
            const n = this.calibrationBuffer.length;
            const avgAx = sumAx / n;
            const avgAy = sumAy / n;
            const avgAz = sumAz / n;
            const qInit = this.getRotationFromGravity(avgAx, avgAy, avgAz);
            this.q = qInit;
            this.madgwick.setQuaternion(qInit);
            this.isOrientationInitialized = true;
            console.log('[Hybrid] Calibration complete. Orientation initialised.');
            // Anchor timestamp to last calibration sample to avoid "large gap" reset on next packet
            const lastCalTs = this.calibrationBuffer[this.calibrationBuffer.length - 1]?.timestampMs;
            this.lastTimestamp = lastCalTs ?? Date.now();
        } else {
            console.warn('[Hybrid] Calibration complete but no samples collected. Orientation will be initialised on next sample.');
            this.lastTimestamp = Date.now();
        }
        // Reset kinematics after calibration but preserve raw data buffer
        this.resetKinematics();
    }

    /** Return the full raw data buffer for offline analysis. */
    public getRawData() { return this.rawDataBuffer; }
    /** Return the active slice of raw data used for movement charts. */
    public getActiveRawData() { return this.activeRawData.length > 0 ? this.activeRawData : this.rawDataBuffer; }
    /** Return the latest session analysis summary. */
    public getSessionAnalysis(): SessionAnalysisSummary {
        return this.sessionAnalysis ?? {
            movementSegment: null,
            movementMetrics: this.getEmptyMetrics(),
            activePath: this.path,
            fullPath: this.fullPath,
        };
    }
    /** Enable or disable real???time trajectory updates to the UI. */
    public setRealtimeEnabled(enabled: boolean) { this.realtimeEnabled = enabled; }

    /**
     * Post-process the captured raw data into corrected session paths.
     *
     * The full session is reconstructed first and then segmented into
     * initial idle, active movement and final idle. UI metrics and
     * charts use the active slice; capture health remains separate.
     */
    public applyPostProcessingCorrections() {
        this.path = [];
        this.fullPath = [];
        this.activeRawData = [];
        this.sessionAnalysis = null;
        if (this.rawDataBuffer.length === 0) {
            console.warn('[Hybrid] applyPostProcessingCorrections: No raw data to process');
            return;
        }

        this.sessionAnalysis = this.buildSessionAnalysis();
        console.log(`[Hybrid] Post-processing complete. Active path: ${this.path.length} points. Full path: ${this.fullPath.length} points.`);
    }

    public getPeakLinearAcceleration(): number {
        return this.sessionAnalysis?.movementMetrics.peakLinearAcc ?? this.getEmptyMetrics().peakLinearAcc;
    }

    /**
     * Calcula la Velocidad Media Propulsiva (VMP) del tramo activo.
     */
    public getMeanPropulsiveVelocity(): number {
        return this.sessionAnalysis?.movementMetrics.meanPropulsiveVelocity ?? this.getEmptyMetrics().meanPropulsiveVelocity;
    }

    /** Devuelve la altura m??xima alcanzada durante el tramo activo. */
    public getMaxHeight(): number {
        return this.sessionAnalysis?.movementMetrics.maxHeight ?? this.getEmptyMetrics().maxHeight;
    }

    /** Altura final del tramo activo. */
    public getFinalHeight(): number {
        return this.sessionAnalysis?.movementMetrics.finalHeight ?? this.getEmptyMetrics().finalHeight;
    }

    /** Desviaci??n lateral m??xima (plano X-Y relativo) del tramo activo. */
    public getMaxLateral(): number {
        return this.sessionAnalysis?.movementMetrics.maxLateral ?? this.maxLateral;
    }

    /** Desviaci??n lateral final (norma en plano X-Y del ??ltimo punto activo). */
    public getFinalLateral(): number {
        return this.sessionAnalysis?.movementMetrics.finalLateral ?? this.getEmptyMetrics().finalLateral;
    }
}

// Export a singleton instance
export const trajectoryService = new TrajectoryService();
