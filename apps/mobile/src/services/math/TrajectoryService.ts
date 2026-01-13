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

import { IMUSample } from '../ble/constants';
import { Vec3, Vec3Math } from './Vec3';
import { Quaternion, QuatMath } from './QuaternionMath';

export interface TrajectoryPoint {
    timestamp: number;
    position: Vec3;
    rotation: Quaternion;
    relativePosition: Vec3;
}

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
    // Logging counter to throttle console output
    private logCounter: number = 0;
    // Raw data buffer for offline post‑processing
    private rawDataBuffer: Array<any> = [];
    // Last timestamp processed (ms)
    private lastTimestamp: number = 0;
    // Path of computed points for UI
    private path: TrajectoryPoint[] = [];
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
        this.lastPoint = null;
        this.accelBuffer = [];
        this.gyroBuffer = [];
        // Clear rawDataBuffer to start fresh for each new session
        this.rawDataBuffer = [];
        this.baselineP = Vec3Math.zero();
        this.stationaryTick = 0;
        this.movingTick = 0;
        this.isStatState = false;
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
        const w_meas: Vec3 = {
            x: sample.gx * (Math.PI / 180),
            y: sample.gy * (Math.PI / 180),
            z: sample.gz * (Math.PI / 180),
        };

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
        this.updateBuffers(a_meas, w_meas);
        const { isCandidate, metrics } = this.checkStationaryCandidate();
        if (isCandidate) {
            this.stationaryTick += dt;
            this.movingTick = 0;
        } else {
            this.movingTick += dt;
            this.stationaryTick = 0;
        }
        // Hysteresis: enter stationary after 300 ms; exit after 100 ms
        if (!this.isStatState && this.stationaryTick > 0.3) {
            this.isStatState = true;
        } else if (this.isStatState && this.movingTick > 0.1) {
            this.isStatState = false;
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

        // Update orientation with Madgwick
        this.madgwick.update(w_meas.x, w_meas.y, w_meas.z, a_meas.x, a_meas.y, a_meas.z, dt);
        this.q = { ...this.madgwick.q };

        // Compute linear acceleration in world frame
        // Rotate measured accel to world frame using sensor orientation
        const R = QuatMath.toRotationMatrix(this.q);
        const acc_world = R.multiplyVec(a_meas);
        const g_vec = { x: 0, y: 0, z: this.GRAVITY };
        const acc_net = Vec3Math.sub(acc_world, g_vec);

        // Integrate kinematics via Kalman
        if (!isStat) {
            this.kX.predict(acc_net.x, dt);
            this.kY.predict(acc_net.y, dt);
            this.kZ.predict(acc_net.z, dt);
        } else {
            this.kX.predict(acc_net.x, dt); this.kX.updateZUPT(acc_net.x);
            this.kY.predict(acc_net.y, dt); this.kY.updateZUPT(acc_net.y);
            this.kZ.predict(acc_net.z, dt); this.kZ.updateZUPT(acc_net.z);
        }

        // Update position and velocity from Kalman filters
        this.p = { x: this.kX.getPosition(), y: this.kY.getPosition(), z: this.kZ.getPosition() };
        this.v = { x: this.kX.getVelocity(), y: this.kY.getVelocity(), z: this.kZ.getVelocity() };
        const relP = Vec3Math.sub(this.p, this.baselineP);

        // Record raw data for offline analysis
        this.rawDataBuffer.push({ timestamp: t, acc_net, q: { ...this.q }, p_raw: { ...this.p }, v_raw: { ...this.v } });

        // Throttled logging: every ~50 samples (~20 Hz at 1000 Hz ODR)
        this.logCounter++;
        if (this.logCounter % 50 === 0) {
            const aMag = Math.sqrt(a_meas.x ** 2 + a_meas.y ** 2 + a_meas.z ** 2);
            const accLinMag = Math.sqrt(acc_net.x ** 2 + acc_net.y ** 2 + acc_net.z ** 2);
            console.log(
                `[Hybrid] Stat:${isStat} dt:${dt.toFixed(4)} |a|:${aMag.toFixed(2)} |aLin|:${accLinMag.toFixed(3)} v:(${this.v.x.toFixed(3)},${this.v.y.toFixed(3)},${this.v.z.toFixed(3)}) p:(${this.p.x.toFixed(3)},${this.p.y.toFixed(3)},${this.p.z.toFixed(3)})`);
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
        // Thresholds tuned for typical handheld IMU noise. Adjust as needed.
        const isAccelStable = Math.abs(meanA - this.GRAVITY) < 0.5 && stdA < 0.15;
        const isGyroStable = meanW < 0.15 && stdW < 0.05;
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

    /** Returns the recorded path of trajectory points. */
    public getPath() { return this.path; }
    /**
     * Returns the current orientation of the bar for UI. The raw
     * sensor orientation (sensor->world) is first combined with the
     * fixed mount rotation (bar->sensor) to produce the bar
     * orientation (bar->world). Then a -90° rotation about the X axis
     * is applied to convert from the physics Z‑up coordinate frame to
     * the UI Y‑up coordinate frame. The returned quaternion can be
     * passed directly to the OrientationViz component.
     */
    public getOrientation() {
        const q_bar_world = QuatMath.multiply(this.q, this.q_mount);
        const fix = { w: Math.SQRT1_2, x: -Math.SQRT1_2, y: 0, z: 0 };
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
        } else {
            console.warn('[Hybrid] Calibration complete but no samples collected. Orientation will be initialised on next sample.');
        }
        // Reset kinematics after calibration but preserve raw data buffer
        this.resetKinematics();
    }

    /** Return the raw data buffer for offline analysis. */
    public getRawData() { return this.rawDataBuffer; }
    /** Enable or disable real‑time trajectory updates to the UI. */
    public setRealtimeEnabled(enabled: boolean) { this.realtimeEnabled = enabled; }

    /**
     * Post‑process the captured raw data into a corrected trajectory path.
     *
     * During real‑time streaming we disable UI updates and simply
     * integrate internally. When streaming stops we can call this
     * function to construct a full trajectory from the stored raw
     * samples. It builds a new path by iterating over the raw data
     * buffer, computing a relative position from the initial point and
     * applying both the mount rotation and UI fix rotation to the
     * orientation. This method does not alter the internal filter
     * state and can be called multiple times. If the rawDataBuffer is
     * empty, the path will remain empty.
     */
    public applyPostProcessingCorrections() {
        // Clear any previously computed path
        this.path = [];
        if (this.rawDataBuffer.length === 0) {
            console.warn('[Hybrid] applyPostProcessingCorrections: No raw data to process');
            return;
        }
        // Use the first recorded position as the baseline for relative
        // displacement. This ensures the trajectory starts at the
        // origin in the UI. We do not use this.baselineP here
        // because baselineP may have been modified during streaming
        // resets. Instead, derive from raw data directly.
        const first = this.rawDataBuffer[0];
        const baseline: Vec3 = { x: first.p_raw.x, y: first.p_raw.y, z: first.p_raw.z };
        const fix: Quaternion = { w: Math.SQRT1_2, x: -Math.SQRT1_2, y: 0, z: 0 };

        // Iterate through raw samples and rebuild trajectory points
        for (const record of this.rawDataBuffer) {
            const t = record.timestamp as number;
            // Use the raw position recorded from the Kalman filter
            const p_raw: Vec3 = record.p_raw;
            // Compute relative position from baseline
            const relP: Vec3 = {
                x: p_raw.x - baseline.x,
                y: p_raw.y - baseline.y,
                z: p_raw.z - baseline.z,
            };
            // Raw orientation (sensor->world) at this sample
            const q_raw: Quaternion = record.q;
            // Apply mount rotation to convert to bar frame
            const q_bar_world = QuatMath.multiply(q_raw, this.q_mount);
            // Apply fix rotation to convert world Z‑up to UI Y‑up
            const q_visual = QuatMath.normalize(QuatMath.multiply(fix, q_bar_world));
            // Compose trajectory point
            this.path.push({
                timestamp: t,
                position: { ...p_raw },
                rotation: q_visual,
                relativePosition: relP,
            });
        }
        console.log(`[Hybrid] Post-processing complete. Generated ${this.path.length} trajectory points.`);
    }
    // 1️⃣ MÉTODO NUEVO: devuelve la aceleración lineal pico (m/s²)
    public getPeakLinearAcceleration(): number {
        if (!this.rawDataBuffer || this.rawDataBuffer.length === 0) return 0;
        let maxAcc = 0;
        for (const s of this.rawDataBuffer) {
            // acc_net es un Vec3 con la aceleración lineal (sin gravedad) en m/s²
            const acc = s.acc_net;
            if (acc) {
                const mag = Math.sqrt(acc.x * acc.x + acc.y * acc.y + acc.z * acc.z);
                if (mag > maxAcc) maxAcc = mag;
            }
        }
        return maxAcc; // valor en m/s²
    }
}

// Export a singleton instance
export const trajectoryService = new TrajectoryService();