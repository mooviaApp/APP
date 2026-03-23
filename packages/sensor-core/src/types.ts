/**
 * Sensor Core Types & Constants
 * 
 * Shared types and configuration for MOOVIA IMU sensor data.
 * Platform-agnostic: used by both mobile app and web test tool.
 */

// ============================================================================
// Sensor Configuration
// ============================================================================

export const SENSOR_CONFIG = {
    DEVICE_NAME: 'MOOVIA',
    EXPECTED_WHO_AM_I: 0x47,
    GYRO_RANGE_DPS: 1000,
    ACCEL_RANGE_G: 8,
    ODR_HZ: 1000,
    SAMPLES_PER_PACKET: 15,
    BYTES_PER_SAMPLE: 14,
    PACKET_SIZE_BYTES: 211,
    SAMPLE_INTERVAL_MS: 1,
    PACKET_INTERVAL_MS: 15,
    TIMESTAMP_TICK_US: 32.0 / 30.0,
    /** LSB/g for ±8g range */
    ACC_LSB_PER_G: 4096,
    /** LSB/dps for ±1000 dps range */
    GYRO_LSB_PER_DPS: 32.8,
} as const;

export const MESSAGE_TYPES = {
    SAMPLE: 0x02,
    LOG: 0x03,
    WHO_AM_I_RESPONSE: 0x04,
} as const;

// ============================================================================
// Type Definitions
// ============================================================================

export interface IMUSample {
    /** Accelerometer X-axis (g) */
    ax: number;
    /** Accelerometer Y-axis (g) */
    ay: number;
    /** Accelerometer Z-axis (g) */
    az: number;
    /** Gyroscope X-axis (dps) */
    gx: number;
    /** Gyroscope Y-axis (dps) */
    gy: number;
    /** Gyroscope Z-axis (dps) */
    gz: number;
    /** Timestamp in ISO 8601 format (Legacy) */
    timestamp?: string;
    /** Monotonic timestamp in milliseconds (Preferred) */
    timestampMs: number;
}

export interface RawIMUPacket {
    /** Raw packet bytes as number array */
    bytes: number[];
    /** Timestamp when packet was received */
    receivedAt: number;
    /** Number of samples decoded from this packet */
    sampleCount: number;
}

export interface TrajectoryRecord {
    timestamp: number;
    acc_net: { x: number; y: number; z: number };
    q: { w: number; x: number; y: number; z: number };
    p_raw: { x: number; y: number; z: number };
    v_raw: { x: number; y: number; z: number };
}

/** Full session data export format (JSON) */
export interface SensorSessionExport {
    version: string;
    exportedAt: string;
    sensorConfig: typeof SENSOR_CONFIG;
    samples: IMUSample[];
    rawData: TrajectoryRecord[];
    metadata: {
        totalSamples: number;
        durationMs: number;
        avgSampleRateHz: number;
    };
}

export interface LogMessage {
    timestamp: string;
    message: string;
}

export interface WHOAMIResponse {
    timestamp: string;
    value: number;
    isValid: boolean;
}
