/**
 * BLE Service Constants for MOOVIA IMU Sensor
 *
 * Defines UUIDs, commands, message types and session/export types used by the
 * mobile app when talking to the WBZ351 + ICM-42688-P firmware.
 */

// ============================================================================
// Service and Characteristic UUIDs
// ============================================================================

export const BLE_SERVICE_UUID = '78563412-3412-7856-1234-567812345678';
export const BLE_CCCD_UUID = '00002902-0000-1000-8000-00805f9b34fb';
export const BLE_SERVICE_UUID_ALIASES = [
    '78563412-3412-7856-1234-567812345678',
    '78563412-7856-3412-7856-341278563412',
] as const;

export const BLE_CHARACTERISTICS = {
    /** Characteristic 0: IMU Data (Notify) */
    DATA: '78563412-3412-7856-1234-567800000001',

    /** Characteristic 1: Commands (Write Without Response) */
    COMMAND: '78563412-3412-7856-1234-567800000002',

    /** Characteristic 2: Logs and Responses (Notify) */
    LOG: '78563412-3412-7856-1234-567800000003',
} as const;

export const BLE_CHARACTERISTIC_UUID_ALIASES = {
    DATA: [
        '78563412-3412-7856-1234-567800000001',
        '01000000-7856-3412-7856-341278563412',
    ],
    COMMAND: [
        '78563412-3412-7856-1234-567800000002',
        '02000000-7856-3412-7856-341278563412',
    ],
    LOG: [
        '78563412-3412-7856-1234-567800000003',
        '03000000-7856-3412-7856-341278563412',
    ],
} as const;

// ============================================================================
// Command Codes (sent to Characteristic 1)
// ============================================================================

export const BLE_COMMANDS = {
    WHO_AM_I: 0x01,
    STREAM_ON: 0x02,
    STREAM_OFF: 0x03,
    RESET_IMU: 0x04,
} as const;

// ============================================================================
// Message Types (received in notifications)
// ============================================================================

export const MESSAGE_TYPES = {
    SAMPLE: 0x02,
    LOG: 0x03,
    WHO_AM_I_RESPONSE: 0x04,
} as const;

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
    PACKET_HEADER_BYTES: 3,
    BYTES_PER_SAMPLE: 14,
    PACKET_SIZE_BYTES: 213,
    SAMPLE_INTERVAL_MS: 1,
    PACKET_INTERVAL_MS: 15,
    BATCH_SIZE_PACKETS: 4,
    BATCH_SIZE_SAMPLES: 60,
    TIMESTAMP_TICK_US: 32.0 / 30.0,
} as const;

// ============================================================================
// BLE Configuration
// ============================================================================

export const BLE_CONFIG = {
    REQUIRED_MTU: 247,
    MIN_STREAM_MTU: 216,
    SCAN_TIMEOUT_MS: 10000,
    CONNECTION_TIMEOUT_MS: 5000,
    AUTO_RECONNECT: true,
    MAX_RECONNECT_ATTEMPTS: 3,
} as const;

// ============================================================================
// Type Definitions
// ============================================================================

export type BLECommand = typeof BLE_COMMANDS[keyof typeof BLE_COMMANDS];
export type MessageType = typeof MESSAGE_TYPES[keyof typeof MESSAGE_TYPES];

export interface IMUSample {
    ax: number;
    ay: number;
    az: number;
    gx: number;
    gy: number;
    gz: number;
    timestamp?: string;
    timestampMs: number;
    hwTs16?: number;
    packetSeq16?: number;
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

export interface RawPacketRecord {
    base64: string;
    receivedAt: number;
    length: number;
    sampleCount: number;
    index: number;
    seq16?: number;
}

export interface SessionTransportState {
    deviceName: string | null;
    deviceAddress: string | null;
    connectedAt: string | null;
    disconnectedAt: string | null;
    mtuRequested: number;
    mtuNegotiated: number;
    phyRequested: string | null;
    phyActualTx: string | null;
    phyActualRx: string | null;
    connectionPriorityRequested: 'BALANCED' | 'HIGH' | 'LOW_POWER' | null;
    packetsReceived: number;
    samplesReceived: number;
    missingPackets: number;
    missingSamples: number;
    duplicatePackets: number;
    reorderedPackets: number;
    whoAmI: number | null;
    firmwareSummaryLine: string | null;
    disconnectReasonFromFirmware: string | null;
}

export interface RawSessionExport {
    version: string;
    exportedAt: string;
    sensorConfig: typeof SENSOR_CONFIG;
    rawPackets: RawPacketRecord[];
    samples: IMUSample[];
    metadata: {
        totalSamples: number;
        totalPackets: number;
        durationMs: number;
        avgSampleRateHz: number;
        session: SessionTransportState;
    };
}
