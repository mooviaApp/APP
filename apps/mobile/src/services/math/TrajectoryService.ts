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

    // Constants
    private readonly SAMPLING_RATE = 1000; // 1 kHz
    private readonly DT = 1.0 / this.SAMPLING_RATE;
    private readonly ALPHA = 0.95; // Complementary filter weight (High trust in Gyro)
    private readonly GRAVITY = 9.81;
    private readonly REST_THRESHOLD = 0.08; // rad/s threshold for gyroscope to detect rest
    private readonly ACCEL_REST_WINDOW = 0.05; // g deviation from 1g allowed for rest

    // Buffer for simple moving average or calibration if needed
    private path: TrajectoryPoint[] = [];

    /**
     * Reset the trajectory state
     */
    reset() {
        this.q = { w: 1, x: 0, y: 0, z: 0 };
        this.velocity = { x: 0, y: 0, z: 0 };
        this.position = { x: 0, y: 0, z: 0 };
        this.path = [];
        this.lastTimestamp = 0;
    }

    /**
     * Process a single IMU sample
     */
    processSample(sample: IMUSample): TrajectoryPoint {
        const t = new Date(sample.timestamp).getTime();

        // Handle first sample
        if (this.lastTimestamp === 0) {
            this.lastTimestamp = t;
            return { timestamp: t, position: { ...this.position }, rotation: { ...this.q } };
        }

        // Calculate actual DT if timestamps are reliable, otherwise use fixed DT
        // const dt = (t - this.lastTimestamp) / 1000.0;
        const dt = this.DT; // Use fixed DT for stability with 1kHz streaming
        this.lastTimestamp = t;

        // 1. Convert units
        // Gyro: dps -> rad/s
        const gx = sample.gx * (Math.PI / 180);
        const gy = sample.gy * (Math.PI / 180);
        const gz = sample.gz * (Math.PI / 180);

        // Accel: g -> m/s^2
        const ax = sample.ax * this.GRAVITY;
        const ay = sample.ay * this.GRAVITY;
        const az = sample.az * this.GRAVITY;

        // 2. Orientation Estimation (Complementary Filter mainly, simplified)
        // Rate of change of quaternion from gyro
        // q_dot = 0.5 * q * omega
        // Implementation of standard quaternion integration

        const q = this.q;
        const qDotW = 0.5 * (-q.x * gx - q.y * gy - q.z * gz);
        const qDotX = 0.5 * (q.w * gx + q.y * gz - q.z * gy);
        const qDotY = 0.5 * (q.w * gy - q.x * gz + q.z * gx);
        const qDotZ = 0.5 * (q.w * gz + q.x * gy - q.y * gx);

        this.q.w += qDotW * dt;
        this.q.x += qDotX * dt;
        this.q.y += qDotY * dt;
        this.q.z += qDotZ * dt;

        // Normalize Quaternion
        const norm = Math.sqrt(this.q.w ** 2 + this.q.x ** 2 + this.q.y ** 2 + this.q.z ** 2);
        this.q.w /= norm;
        this.q.x /= norm;
        this.q.y /= norm;
        this.q.z /= norm;

        // 2.1 Corrección de Inclinación (Tilt Correction)
        // Solo corregimos si la fuerza total es cercana a 1g (estamos idealmente quietos o movimiento uniforme)
        // Esto evita que corrijamos con fuerzas de aceleración bruscas (correr, saltar)
        const accelMagSq = (ax / this.GRAVITY) ** 2 + (ay / this.GRAVITY) ** 2 + (az / this.GRAVITY) ** 2;

        if (Math.abs(accelMagSq - 1.0) < 0.2) { // Margen de ~10% de tolerancia
            // Normalizar aceleración medida
            const normAcc = 1.0 / Math.sqrt(accelMagSq);
            const ax_n = (ax / this.GRAVITY) * normAcc;
            const ay_n = (ay / this.GRAVITY) * normAcc;
            const az_n = (az / this.GRAVITY) * normAcc;

            // Dirección estimada de la gravedad (Vector "Abajo" relativo al cuerpo)
            // Matemáticamente: es la tercera columna de la matriz de rotación
            const vx = 2 * (this.q.x * this.q.z - this.q.w * this.q.y);
            const vy = 2 * (this.q.w * this.q.x + this.q.y * this.q.z);
            const vz = this.q.w * this.q.w - this.q.x * this.q.x - this.q.y * this.q.y + this.q.z * this.q.z;

            // Producto Cruz: Calculamos el error (ángulo) entre lo que "creemos" que es abajo (vx,vy,vz)
            // y lo que el acelerómetro "siente" que es abajo (ax_n, ay_n, az_n).
            const ex = ay_n * vz - az_n * vy;
            const ey = az_n * vx - ax_n * vz;
            const ez = ax_n * vy - ay_n * vx;

            // Aplicar corrección al Cuaternión
            // Usamos un factor pequeño (BETA) porque confiamos más en el Giroscopio a corto plazo
            const BETA = 0.1 * dt; // Factor de corrección suave

            this.q.w += BETA * (-this.q.x * ex - this.q.y * ey - this.q.z * ez);
            this.q.x += BETA * (this.q.w * ex + this.q.y * ez - this.q.z * ey);
            this.q.y += BETA * (this.q.w * ey - this.q.x * ez + this.q.z * ex);
            this.q.z += BETA * (this.q.w * ez + this.q.x * ey - this.q.y * ex);

            // Renormalizar para asegurar que sigue siendo una rotación válida
            const n = Math.sqrt(this.q.w ** 2 + this.q.x ** 2 + this.q.y ** 2 + this.q.z ** 2);
            this.q.w /= n; this.q.x /= n; this.q.y /= n; this.q.z /= n;
        }

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

        // 4. Remove Gravity
        // Assuming Z is up, Gravity is [0, 0, 9.81]
        // But wait, what is the initial orientation? 
        // We assume sensor starts flat. If not, we need calibration.
        // For MVP: Assume Z is Up.
        const linAccX = worldAx;
        const linAccY = worldAy;
        const linAccZ = worldAz - this.GRAVITY;

        // 5. Zero Velocity Update (ZUPT)
        // If gyro is very low and accel is close to 1g (magnitude), assume stationary
        const gyroMag = Math.sqrt(gx * gx + gy * gy + gz * gz);
        const accelMag = Math.sqrt(sample.ax * sample.ax + sample.ay * sample.ay + sample.az * sample.az); // in g

        const isStationary = gyroMag < this.REST_THRESHOLD && Math.abs(accelMag - 1.0) < this.ACCEL_REST_WINDOW;

        if (isStationary) {
            this.velocity.x = 0;
            this.velocity.y = 0;
            this.velocity.z = 0;
            // Optionally correct tilt here
        } else {
            // Integrate Velocity
            this.velocity.x += linAccX * dt;
            this.velocity.y += linAccY * dt;
            this.velocity.z += linAccZ * dt;

            // Integrate Position
            this.position.x += this.velocity.x * dt;
            this.position.y += this.velocity.y * dt;
            this.position.z += this.velocity.z * dt;
        }

        const point: TrajectoryPoint = {
            timestamp: this.lastTimestamp,
            position: { ...this.position },
            rotation: { ...this.q }
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
}

// Singleton
export const trajectoryService = new TrajectoryService();
