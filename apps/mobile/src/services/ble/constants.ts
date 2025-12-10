/**
 * BLE Service Constants for MOOVIA IMU Sensor
 * 
 * Defines UUIDs, commands, and message types for communication
 * with the WBZ351 microcontroller and ICM-42688-P sensor.
 */

// ============================================================================
// Service and Characteristic UUIDs
// ============================================================================

export const BLE_SERVICE_UUID = '12345678-1234-5678-1234-567812345678';

export const BLE_CHARACTERISTICS = {
    /** Characteristic 0: IMU Data (Read, Notify) */
    DATA: '12345678-1234-5678-1234-567800000001',

    /** Characteristic 1: Commands (Write Without Response) */
    COMMAND: '12345678-1234-5678-1234-567800000002',

    /** Characteristic 2: Logs and Responses (Read, Notify) */
    LOG: '12345678-1234-5678-1234-567800000003',
} as const;

// ============================================================================
// Command Codes (sent to Characteristic 1)
// ============================================================================

export const BLE_COMMANDS = {
    /** Request WHO_AM_I register value (should return 0x47) */
    WHO_AM_I: 0x01,

    /** Start streaming IMU data */
    STREAM_ON: 0x02,

    /** Stop streaming IMU data */
    STREAM_OFF: 0x03,

    /** Reset/reinitialize the IMU sensor */
    RESET_IMU: 0x04,
} as const;

// ============================================================================
// Message Types (received in notifications)
// ============================================================================

export const MESSAGE_TYPES = {
    /** IMU sample data packet (13 bytes: type + 6x int16) */
    SAMPLE: 0x02,

    /** Log message (ASCII text) */
    LOG: 0x03,

    /** WHO_AM_I response (1 byte value) */
    WHO_AM_I_RESPONSE: 0x04,
} as const;

// ============================================================================
// Sensor Configuration
// ============================================================================

export const SENSOR_CONFIG = {
    /** Device name to scan for */
    DEVICE_NAME: 'MOOVIA',

    /** Expected WHO_AM_I value for ICM-42688-P */
    EXPECTED_WHO_AM_I: 0x47,

    /** Gyroscope range in degrees per second */
    GYRO_RANGE_DPS: 2000,

    /** Accelerometer range in g */
    ACCEL_RANGE_G: 16,

    /** Output Data Rate in Hz */
    ODR_HZ: 1000,

    /** Expected sample interval in ms (~20ms based on firmware) */
    SAMPLE_INTERVAL_MS: 20,

    /** Batch size for sending to backend (samples per batch) */
    BATCH_SIZE: 50, // ~1 second of data
} as const;

// ============================================================================
// BLE Configuration
// ============================================================================

export const BLE_CONFIG = {
    /** Scan timeout in milliseconds */
    SCAN_TIMEOUT_MS: 10000,

    /** Connection timeout in milliseconds */
    CONNECTION_TIMEOUT_MS: 5000,

    /** Auto-reconnect on disconnection */
    AUTO_RECONNECT: true,

    /** Max reconnection attempts */
    MAX_RECONNECT_ATTEMPTS: 3,
} as const;

// ============================================================================
// Type Definitions
// ============================================================================

export type BLECommand = typeof BLE_COMMANDS[keyof typeof BLE_COMMANDS];
export type MessageType = typeof MESSAGE_TYPES[keyof typeof MESSAGE_TYPES];

export interface IMUSample {
    /** Timestamp in ISO 8601 format */
    timestamp: string;

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
