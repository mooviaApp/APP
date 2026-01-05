/**
 * BLE Service Constants for MOOVIA IMU Sensor
 * 
 * Defines UUIDs, commands, and message types for communication
 * with the WBZ351 microcontroller and ICM-42688-P sensor.
 */

// ============================================================================
// Service and Characteristic UUIDs
// ============================================================================

export const BLE_SERVICE_UUID = '78563412-7856-3412-7856-341278563412';

export const BLE_CHARACTERISTICS = {
    /** Characteristic 0: IMU Data (Read, Notify) */
    DATA: '01000000-7856-3412-7856-341278563412',

    /** Characteristic 1: Commands (Write Without Response) */
    COMMAND: '02000000-7856-3412-7856-341278563412',

    /** Characteristic 2: Logs and Responses (Read, Notify) */
    LOG: '03000000-7856-3412-7856-341278563412',
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
    /** IMU sample data packet (181 bytes: type + 15 samples × 12 bytes) */
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
    GYRO_RANGE_DPS: 1000,

    /** Accelerometer range in g */
    ACCEL_RANGE_G: 8,

    /** Output Data Rate in Hz (1 kHz = 1 sample per ms) */
    ODR_HZ: 1000,

    /** Number of samples per BLE packet from firmware */
    SAMPLES_PER_PACKET: 15,

    /** Bytes per sample (6 int16 values + 1 uint16 timestamp = 14 bytes) */
    BYTES_PER_SAMPLE: 14,

    /** Total packet size (1 byte type + 15 samples × 14 bytes) */
    PACKET_SIZE_BYTES: 211,

    /** Expected sample interval in ms (1 ms per sample) */
    SAMPLE_INTERVAL_MS: 1,

    /** Packet interval in ms (15 samples at 1 kHz = 15 ms) */
    PACKET_INTERVAL_MS: 15,

    /** Batch size for sending to backend (number of packets to accumulate) */
    BATCH_SIZE_PACKETS: 4, // 4 packets × 15 samples = 60 samples = 60 ms

    /** Total samples in a batch for backend */
    BATCH_SIZE_SAMPLES: 60, // 4 packets × 15 samples
} as const;

// ============================================================================
// BLE Configuration
// ============================================================================

export const BLE_CONFIG = {
    /** Required MTU size for 211-byte packets (211 + 3 bytes overhead + margin) */
    REQUIRED_MTU: 247,

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
    // Raw Data (15 samples per packet)
    ax: number;
    ay: number;
    az: number;
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

export interface LogMessage {
    timestamp: string;
    message: string;
}

export interface WHOAMIResponse {
    timestamp: string;
    value: number;
    isValid: boolean;
}
