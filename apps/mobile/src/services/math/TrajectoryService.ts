/**
 * Trajectory Service
 * 
 * Reconstructs 3D trajectory from 6-axis IMU data.
 * Pipeline:
 * 1. Gyro integration + Accel correction (Complementary Filter) -> Orientation (Quaternion)
 * 2. Rotate Body Accel -> World Accel
 * 3. Remove Gravity
 * 4. Double Integration: Accel -> Velocity -> Position
 * 5. Zero-Velocity Update (ZUPT) for drift control
 */

import { IMUSample } from '../ble/constants';

export interface Quaternion {
    w: number;
    x: number;
    y: number;
    z: number;
}

export interface Vector3 {
    x: number;
    y: number;
    z: number;
}

export interface TrajectoryPoint {
    timestamp: number;
    position: Vector3;
    rotation: Quaternion;
}

export class TrajectoryService {
    // State
    private q: Quaternion = { w: 1, x: 0, y: 0, z: 0 };
    private velocity: Vector3 = { x: 0, y: 0, z: 0 };
    private position: Vector3 = { x: 0, y: 0, z: 0 };
    private lastTimestamp: number = 0;

    // ZUPT & Drift Correction State
    private isMoving: boolean = false;
    private segmentStartIndex: number = -1; // Index in this.path where movement started
    private segmentStartTime: number = 0;

    // ZUPT Temporal Filter (50 samples = 50ms buffer)
    private readonly ZUPT_BUFFER_SIZE = 50;
    private gyroMagBuffer: number[] = [];
    private accelMagBuffer: number[] = [];
    private zuptConsecutiveCount: number = 0; // Consecutive samples meeting ZUPT criteria
    private readonly ZUPT_MIN_CONSECUTIVE = 50; // Require 50ms of stable rest before triggering

    // Calibration properties
    private gyroBias = { x: 0, y: 0, z: 0 };
    private initialQ: Quaternion = { w: 1, x: 0, y: 0, z: 0 }; // q0 (Zero frame)
    private isCalibrating: boolean = false;
    private calibrationBuffer: IMUSample[] = [];

    // Auto-detected Vertical Axis (0=X, 1=Y, 2=Z)
    // Determined during calibration by finding which axis measures ~1g
    private verticalAxis: 0 | 1 | 2 = 2; // Default to Z
    private verticalSign: 1 | -1 = 1; // +1 or -1 depending on orientation

    // Snapshot (Manual trigger via Stream ON/OFF)
    private liftSnapshot: TrajectoryPoint[] = []; // Frozen trajectory when streaming stops

    // Lever Arm (Sensor offset from Barbell Center in Body frame)
    // Assuming sensor is on the sleeve: ~1.1m from center (standard olympic bar)
    // Coordinate system: X=Right, Y=Forward, Z=Up
    // If sensor is on Right Sleeve: (+1.1, 0, 0)
    private readonly LEVER_ARM = { x: 1.1, y: 0, z: 0 };

    // Constants
    private readonly SAMPLING_RATE = 1000; // 1 kHz
    private readonly DT = 1.0 / this.SAMPLING_RATE;
    // Madgwick beta parameter for orientation correction (0 = no correction, higher = stronger)
    private readonly MADGWICK_BETA = 0.1;
    private readonly GRAVITY = 9.81;
    private readonly REST_THRESHOLD = 0.08; // rad/s threshold for gyroscope to detect rest (~4.6 deg/s)
    private readonly ACCEL_REST_WINDOW = 0.05; // g deviation from 1g allowed for rest

    // Buffer for simple moving average or calibration if needed
    private path: TrajectoryPoint[] = [];

    /**
     * Reset the trajectory state
     */
    reset() {
        // Reset to Identity, but KEEP calibration data (gyroBias, initialQ, verticalAxis)
        this.q = { w: 1, x: 0, y: 0, z: 0 };
        this.velocity = { x: 0, y: 0, z: 0 };
        this.position = { x: 0, y: 0, z: 0 };
        this.path = [];
        this.lastTimestamp = 0;
        this.isMoving = false;
        this.segmentStartIndex = -1;
        this.segmentStartTime = 0;

        // Reset ZUPT temporal buffers
        this.gyroMagBuffer = [];
        this.accelMagBuffer = [];
        this.zuptConsecutiveCount = 0;

        // Note: liftSnapshot persists across resets (cleared manually via clearLiftSnapshot())
    }

    /**
     * Process a single IMU sample
     */
    processSample(sample: IMUSample): TrajectoryPoint {
        const t = new Date(sample.timestamp).getTime();

        // Handle first sample
        // If calibrating, collect samples and return empty
        if (this.isCalibrating) {
            this.calibrationBuffer.push(sample);
            return { timestamp: t, position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 } };
        }

        if (this.lastTimestamp === 0) {
            this.lastTimestamp = t;
            return { timestamp: t, position: { ...this.position }, rotation: { ...this.q } };
        }

        // Use constant DT to avoid timestamp jump issues
        // (timestamps can be inconsistent when unpacking 20 samples at once)
        const dt = this.DT;
        this.lastTimestamp = t;

        // 1. Convert units
        // 1. Convert units
        // Gyro: dps -> rad/s (Apply Bias Correction)
        const gx = (sample.gx - this.gyroBias.x) * (Math.PI / 180);
        const gy = (sample.gy - this.gyroBias.y) * (Math.PI / 180);
        const gz = (sample.gz - this.gyroBias.z) * (Math.PI / 180);

        // Accel: g -> m/s^2
        const ax = sample.ax * this.GRAVITY;
        const ay = sample.ay * this.GRAVITY;
        const az = sample.az * this.GRAVITY;

        // SANITY CHECK: Detect sensor saturation or invalid data
        // If values are near +/- 8g (limit), ignoring them to prevent flying into space.
        const SATURATION_LIMIT = 7.5 * this.GRAVITY; // 7.5g (safe margin below 8g)
        if (Math.abs(ax) > SATURATION_LIMIT || Math.abs(ay) > SATURATION_LIMIT || Math.abs(az) > SATURATION_LIMIT) {
            console.warn('Sensor Saturation Detected! Ignoring sample.', { ax, ay, az });
            // Returns the last point (effectively pausing)
            if (this.path.length > 0) return this.path[this.path.length - 1];
            // If first sample, return zero
            return { timestamp: t, position: { ...this.position }, rotation: { ...this.q } };
        }

        // 2. Orientation Estimation (Complementary Filter mainly, simplified)
        // Rate of change of quaternion from gyro
        // 2. Orientation estimation (Madgwick-like)
        // Integrate gyro to update orientation
        const q = this.q;
        const qDotW = 0.5 * (-q.x * gx - q.y * gy - q.z * gz);
        const qDotX = 0.5 * (q.w * gx + q.y * gz - q.z * gy);
        const qDotY = 0.5 * (q.w * gy - q.x * gz + q.z * gx);
        const qDotZ = 0.5 * (q.w * gz + q.x * gy - q.y * gx);

        // Pre-normalize accelerometer for correction
        const accNorm = Math.sqrt(ax * ax + ay * ay + az * az);
        let ex = 0, ey = 0, ez = 0;
        if (accNorm > 0) {
            // Normalised accelerometer direction
            const axn = ax / accNorm;
            const ayn = ay / accNorm;
            const azn = az / accNorm;
            // Estimated gravity from current quaternion
            const vx = 2 * (q.x * q.z - q.w * q.y);
            const vy = 2 * (q.w * q.x + q.y * q.z);
            const vz = q.w * q.w - q.x * q.x - q.y * q.y + q.z * q.z;
            // Error between measured and estimated gravity
            ex = (ayn * vz - azn * vy);
            ey = (azn * vx - axn * vz);
            ez = (axn * vy - ayn * vx);
        }
        // Apply feedback (Madgwick beta)
        const beta = this.MADGWICK_BETA;
        this.q.w += (qDotW - beta * (ex * q.x + ey * q.y + ez * q.z)) * dt;
        this.q.x += (qDotX + beta * (ex * q.w + ey * q.z - ez * q.y)) * dt;
        this.q.y += (qDotY + beta * (ey * q.w - ex * q.z + ez * q.x)) * dt;
        this.q.z += (qDotZ + beta * (ez * q.w + ex * q.y - ey * q.x)) * dt;

        // Normalize quaternion
        const norm = Math.sqrt(this.q.w ** 2 + this.q.x ** 2 + this.q.y ** 2 + this.q.z ** 2);
        this.q.w /= norm; this.q.x /= norm; this.q.y /= norm; this.q.z /= norm;

        // 3. Rotate Accel to World Frame
        // a_world = q * a_body * q_conj
        // Simplified rotation logic
        const q00 = 2 * this.q.w * this.q.w; // Actually this formula is complex, let's use standard rotation matrix

        // Quaternion to Rotation Matrix applied to vector (ax, ay, az)
        // https://en.wikipedia.org/wiki/Quaternions_and_spatial_rotation
        const x = this.q.x, y = this.q.y, z = this.q.z, w = this.q.w;

        const worldAx = ax * (1 - 2 * y * y - 2 * z * z) + ay * (2 * x * y - 2 * z * w) + az * (2 * x * z + 2 * y * w);
        const worldAy = ax * (2 * x * y + 2 * z * w) + ay * (1 - 2 * x * x - 2 * z * z) + az * (2 * y * z - 2 * x * w);
        const worldAz = ax * (2 * x * z - 2 * y * w) + ay * (2 * y * z + 2 * x * w) + az * (1 - 2 * x * x - 2 * y * y);

        // 4. Remove Gravity (Using Quaternion)
        // Calculate gravity vector in world frame using current orientation
        // Gravity in sensor frame is [0, 0, -1g] (pointing down)
        // Rotate to world frame using quaternion
        const gWorldX = 2 * (x * z - w * y) * this.GRAVITY;
        const gWorldY = 2 * (w * x + y * z) * this.GRAVITY;
        const gWorldZ = (w * w - x * x - y * y + z * z) * this.GRAVITY;

        // Linear acceleration = measured acceleration - gravity
        const linAccX = worldAx - gWorldX;
        const linAccY = worldAy - gWorldY;
        const linAccZ = worldAz - gWorldZ;

        // 5. Advanced ZUPT with Temporal Filtering
        const gyroMag = Math.sqrt(gx * gx + gy * gy + gz * gz);
        const accelMag = Math.sqrt(sample.ax * sample.ax + sample.ay * sample.ay + sample.az * sample.az);

        // Add to buffers for moving average
        this.gyroMagBuffer.push(gyroMag);
        this.accelMagBuffer.push(accelMag);

        // Keep buffer size limited
        if (this.gyroMagBuffer.length > this.ZUPT_BUFFER_SIZE) {
            this.gyroMagBuffer.shift();
            this.accelMagBuffer.shift();
        }

        // Calculate moving averages
        const avgGyroMag = this.gyroMagBuffer.reduce((a, b) => a + b, 0) / this.gyroMagBuffer.length;
        const avgAccelMag = this.accelMagBuffer.reduce((a, b) => a + b, 0) / this.accelMagBuffer.length;

        // Check if CURRENT sample meets rest criteria
        const currentSampleIsRest = gyroMag < this.REST_THRESHOLD && Math.abs(accelMag - 1.0) < this.ACCEL_REST_WINDOW;

        // Increment or reset consecutive counter
        if (currentSampleIsRest) {
            this.zuptConsecutiveCount++;
        } else {
            this.zuptConsecutiveCount = 0;
        }

        // ZUPT triggers only after ZUPT_MIN_CONSECUTIVE samples of rest
        const isStationary = this.zuptConsecutiveCount >= this.ZUPT_MIN_CONSECUTIVE;

        // Debug logging (every 100 samples)
        if (this.path.length % 100 === 0) {
            console.log(`[DEBUG] gyroMag=${gyroMag.toFixed(3)}, accelMag=${accelMag.toFixed(3)}, avgGyro=${avgGyroMag.toFixed(3)}, avgAccel=${avgAccelMag.toFixed(3)}, consecutive=${this.zuptConsecutiveCount}, isStationary=${isStationary}, isMoving=${this.isMoving}`);
        }

        if (isStationary) {
            if (this.isMoving) {
                // --- Transition: Moving -> Stationary (STOP Detected) ---
                // Calculate the Velocity Drift (Error)
                const vDriftX = this.velocity.x;
                const vDriftY = this.velocity.y;
                const vDriftZ = this.velocity.z;

                // Retroactive Quadratic Correction
                // Distribute the drift correction across the movement segment
                if (this.segmentStartIndex !== -1 && this.segmentStartIndex < this.path.length) {
                    const numSamples = this.path.length - this.segmentStartIndex;
                    if (numSamples > 1) {
                        const T = numSamples * this.DT;
                        // Apply quadratic correction: position error grows as 0.5 * v_drift * r^2 * T
                        for (let i = 1; i < numSamples; i++) {
                            const idx = this.segmentStartIndex + i;
                            const r = i / (numSamples - 1); // Normalized time [0, 1]
                            const corr = 0.5 * r * r * T; // Quadratic factor
                            this.path[idx].position.x -= vDriftX * corr;
                            this.path[idx].position.y -= vDriftY * corr;
                            this.path[idx].position.z -= vDriftZ * corr;
                        }
                        console.log(`[ZUPT] Corrected ${numSamples} samples with quadratic drift removal`);
                    }
                }

                console.log(`[ZUPT] STOP detected. Velocity drift: [${vDriftX.toFixed(3)}, ${vDriftY.toFixed(3)}, ${vDriftZ.toFixed(3)}] m/s`);

                this.isMoving = false;
                this.velocity = { x: 0, y: 0, z: 0 }; // Strong Zero
                console.log("ZUPT: Velocity reset to zero.");

            } else {
                // Already stationary, keep velocity at zero
                this.velocity = { x: 0, y: 0, z: 0 };
            }
        } else {
            // Not stationary
            if (!this.isMoving) {
                // Transition: Stationary -> Moving (START)
                this.isMoving = true;
                this.segmentStartIndex = this.path.length; // Start recording index
                this.segmentStartTime = t;
                console.log("[ZUPT] START detected. Movement begins.");
            }

            // Integrate Velocity
            this.velocity.x += linAccX * dt;
            this.velocity.y += linAccY * dt;
            this.velocity.z += linAccZ * dt;

            // Integrate Position
            this.position.x += this.velocity.x * dt;
            this.position.y += this.velocity.y * dt;
            this.position.z += this.velocity.z * dt;

            // Limit to 3x3m area (Clamping)
            // Floor Clamping: Z >= 0
            if (this.position.z < 0) this.position.z = 0;

            // Wall/Ceiling Clamping (3m box)
            const LIMIT = 1.5; // [-1.5, 1.5] for X/Y
            const CEILING = 3.0; // [0, 3.0] for Z
            this.position.x = Math.max(-LIMIT, Math.min(LIMIT, this.position.x));
            this.position.y = Math.max(-LIMIT, Math.min(LIMIT, this.position.y));
            this.position.z = Math.min(CEILING, this.position.z);
        }

        // --- Apply Lever Arm Correction --- (DISABLED FOR NOW)
        // Lever arm adds false vertical movement when sensor rotates
        // Re-enable once base trajectory is working
        /*
        const r = this.LEVER_ARM;
        const qL = this.q;
        const xL = qL.x, yL = qL.y, zL = qL.z, wL = qL.w;
        const worldRx = r.x * (1 - 2 * yL * yL - 2 * zL * zL) + r.y * (2 * xL * yL - 2 * zL * wL) + r.z * (2 * xL * zL + 2 * yL * wL);
        const worldRy = r.x * (2 * xL * yL + 2 * zL * wL) + r.y * (1 - 2 * xL * xL - 2 * zL * zL) + r.z * (2 * yL * zL - 2 * xL * wL);
        const worldRz = r.x * (2 * xL * zL - 2 * yL * wL) + r.y * (2 * yL * zL + 2 * xL * wL) + r.z * (1 - 2 * xL * xL - 2 * yL * yL);
        const centerX = this.position.x - worldRx;
        const centerY = this.position.y - worldRy;
        const centerZ = this.position.z - worldRz;
        */

        // Use sensor position directly (no lever arm)
        const centerX = this.position.x;
        const centerY = this.position.y;
        const centerZ = this.position.z;

        // --- Relative Orientation (Visually useful) ---
        // q_rel = q * q0_conj
        const q0 = this.initialQ;
        const q0Conj = { w: q0.w, x: -q0.x, y: -q0.y, z: -q0.z };
        // Hamilton product
        const qRel = {
            w: q.w * q0Conj.w - q.x * q0Conj.x - q.y * q0Conj.y - q.z * q0Conj.z,
            x: q.w * q0Conj.x + q.x * q0Conj.w + q.y * q0Conj.z - q.z * q0Conj.y,
            y: q.w * q0Conj.y - q.x * q0Conj.z + q.y * q0Conj.w + q.z * q0Conj.x,
            z: q.w * q0Conj.z + q.x * q0Conj.y - q.y * q0Conj.x + q.z * q0Conj.w
        };

        const point: TrajectoryPoint = {
            timestamp: this.lastTimestamp,
            position: { x: centerX, y: centerY, z: centerZ }, // Sensor position (no lever arm)
            rotation: qRel // Return Relative Orientation
        };

        this.path.push(point);
        return point;
    }

    /**
     * Get the current path points
     */
    getPath(): TrajectoryPoint[] {
        return this.path;
    }

    getOrientation() { return this.q; }
    getVelocity() { return this.velocity; }

    // Snapshot Management (Manual - triggered by Stream ON/OFF)
    createSnapshot(): void {
        this.liftSnapshot = [...this.path];
        console.log(`[SNAPSHOT] Created with ${this.liftSnapshot.length} points`);
    }

    getLiftSnapshot(): TrajectoryPoint[] { return this.liftSnapshot; }
    hasLiftSnapshot(): boolean { return this.liftSnapshot.length > 0; }
    clearLiftSnapshot(): void {
        this.liftSnapshot = [];
        console.log('[SNAPSHOT] Cleared');
    }

    /**
     * Extract vertical component from position based on detected axis
     */
    private getVerticalComponent(pos: Vector3): number {
        const val = this.verticalAxis === 0 ? pos.x : (this.verticalAxis === 1 ? pos.y : pos.z);
        return val * this.verticalSign;
    }

    /**
     * Extract horizontal deviation (perpendicular to vertical)
     * For simplicity, use X if vertical is Y/Z, or Y if vertical is X
     */
    private getHorizontalComponent(pos: Vector3): number {
        return this.verticalAxis === 0 ? pos.y : pos.x;
    }

    /**
     * Calibrate the sensor (Calculate Gyro Bias)
     * Keeps the sensor stationary for 'durationMs' and averages the gyro readings.
     */
    async calibrateAsync(durationMs: number = 2000): Promise<void> {
        console.log('Starting Calibration...');
        this.isCalibrating = true;
        this.calibrationBuffer = [];

        // Wait for samples to collect
        await new Promise(resolve => setTimeout(resolve, durationMs));

        this.isCalibrating = false;

        if (this.calibrationBuffer.length > 0) {
            // Calculate Average Gyro Bias
            let sumX = 0, sumY = 0, sumZ = 0;
            this.calibrationBuffer.forEach(s => sumX += s.gx);
            this.calibrationBuffer.forEach(s => sumY += s.gy);
            this.calibrationBuffer.forEach(s => sumZ += s.gz); // Correct summing

            // Re-looping is inefficient but clarity > perf for 2k samples. 
            // Better: loop once.
            sumX = 0; sumY = 0; sumZ = 0;
            for (const s of this.calibrationBuffer) {
                sumX += s.gx;
                sumY += s.gy;
                sumZ += s.gz;
            }

            const count = this.calibrationBuffer.length;
            this.gyroBias = {
                x: sumX / count,
                y: sumY / count,
                z: sumZ / count
            };


            // Auto-detect Vertical Axis
            // Calculate average acceleration magnitude for each axis
            let sumAx = 0, sumAy = 0, sumAz = 0;
            for (const s of this.calibrationBuffer) {
                sumAx += s.ax;
                sumAy += s.ay;
                sumAz += s.az;
            }
            const avgAx = sumAx / count;
            const avgAy = sumAy / count;
            const avgAz = sumAz / count;

            // Find which axis is closest to ±1g
            const absX = Math.abs(avgAx);
            const absY = Math.abs(avgAy);
            const absZ = Math.abs(avgAz);

            if (absX > absY && absX > absZ) {
                this.verticalAxis = 0; // X is vertical
                this.verticalSign = avgAx > 0 ? 1 : -1;
            } else if (absY > absX && absY > absZ) {
                this.verticalAxis = 1; // Y is vertical
                this.verticalSign = avgAy > 0 ? 1 : -1;
            } else {
                this.verticalAxis = 2; // Z is vertical
                this.verticalSign = avgAz > 0 ? 1 : -1;
            }

            // Capture Initial Orientation (q0)
            this.initialQ = { ...this.q };

            const axisNames = ['X', 'Y', 'Z'];
            console.log(`Calibration Complete. Vertical: ${axisNames[this.verticalAxis]}${this.verticalSign > 0 ? '+' : '-'}, Bias: ${JSON.stringify(this.gyroBias)}`);
        }

        // Reset trajectory state after calibration
        this.reset();
    }
}

// Singleton
export const trajectoryService = new TrajectoryService();
