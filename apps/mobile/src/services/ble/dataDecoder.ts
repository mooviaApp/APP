/**
 * BLE Data Decoder Utilities
 * 
 * Functions for decoding BLE notification data from the MOOVIA sensor.
 * Handles int16 little-endian conversion and physical unit conversion.
 * 
 * Updated for firmware v2: 15 samples per packet at 1 kHz ODR
 */

import { decode as base64Decode } from 'base-64';
import {
    IMUSample,
    LogMessage,
    WHOAMIResponse,
    MESSAGE_TYPES,
    SENSOR_CONFIG,
} from './constants';

// ============================================================================
// Low-level Data Conversion
// ============================================================================

/**
 * Decode a base64 string to a Uint8Array
 */
export function decodeBase64ToBytes(base64: string): Uint8Array {
    const binaryString = base64Decode(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

/**
 * Read a signed 16-bit integer in little-endian format
 * @param bytes - Byte array
 * @param offset - Starting offset
 * @returns Signed int16 value
 */
export function readInt16LE(bytes: Uint8Array, offset: number): number {
    const low = bytes[offset];
    const high = bytes[offset + 1];
    const value = (high << 8) | low;

    // Convert to signed (two's complement)
    return value > 0x7FFF ? value - 0x10000 : value;
}

/**
 * Read an unsigned 16-bit integer in little-endian format
 * @param bytes - Byte array
 * @param offset - Starting offset
 * @returns Unsigned uint16 value
 */
export function readUint16LE(bytes: Uint8Array, offset: number): number {
    const low = bytes[offset];
    const high = bytes[offset + 1];
    return (high << 8) | low;
}

// ============================================================================
// Physical Unit Conversion
// ============================================================================

/**
 * Convert raw gyroscope value to dps (degrees per second)
 * ICM-42688-P Datasheet: ±1000 dps range → 32.8 LSB/dps
 * 
 * @param raw - Raw int16 value from sensor
 * @returns Gyroscope value in dps
 */
export function rawToGyro(raw: number): number {
    // ICM-42688-P specific: GYRO_FS_SEL=1 (±1000 dps) → 32.8 LSB/dps
    const GYRO_LSB_PER_DPS = 32.8;
    return raw / GYRO_LSB_PER_DPS;
}

/**
 * Convert raw accelerometer value to g
 * ICM-42688-P Datasheet: ±8g range → 4096 LSB/g
 * 
 * @param raw - Raw int16 value from sensor
 * @returns Accelerometer value in g
 */
export function rawToAccel(raw: number): number {
    // ICM-42688-P specific: ACCEL_FS_SEL=1 (±8g) → 4096 LSB/g
    const ACC_LSB_PER_G = 4096;
    return raw / ACC_LSB_PER_G;
}

// ============================================================================
// Message Decoders
// ============================================================================

/**
 * Decode IMU sample data packet with 20 aggregated samples
 * 
 * Packet structure (181 bytes):
 * - Byte 0: Message type (0x02)
 * - Bytes 1-12: Sample 1 (ax, ay, az, gx, gy, gz as int16 LE)
 * - Bytes 13-24: Sample 2
 * - ... (continues for 15 samples total)
 * - Bytes 169-180: Sample 15
 * 
 * @param bytes - Raw byte array from BLE notification
 * @returns Array of 15 decoded IMU samples with physical units
 */
export function decodeIMUPacket(bytes: Uint8Array): IMUSample[] {
    // Dynamic Packet Size Handling
    const payloadSize = bytes.length - 1;
    const BYTES_PER_SAMPLE = 14; // Updated for V2 (includes timestamp)

    // Check payload validity
    if (payloadSize % BYTES_PER_SAMPLE !== 0) {
        console.warn(`[BLE-ERR] Invalid IMU packet length: ${bytes.length} (Payload ${payloadSize} not multiple of ${BYTES_PER_SAMPLE})`);
        return [];
    }

    const sampleCount = payloadSize / BYTES_PER_SAMPLE;

    if (bytes[0] !== MESSAGE_TYPES.SAMPLE) {
        console.warn(`[BLE-ERR] Invalid message type: 0x${bytes[0].toString(16)} (expected 0x02)`);
        return [];
    }

    // Temporary storage for parsed raw values
    const parsedRaw: {
        ax: number; ay: number; az: number;
        gx: number; gy: number; gz: number;
        hwTs: number;
    }[] = [];

    // 1. Parse Bytes
    for (let i = 0; i < sampleCount; i++) {
        const offset = 1 + (i * BYTES_PER_SAMPLE);

        const rawAx = readInt16LE(bytes, offset + 0);
        const rawAy = readInt16LE(bytes, offset + 2);
        const rawAz = readInt16LE(bytes, offset + 4);
        const rawGx = readInt16LE(bytes, offset + 6);
        const rawGy = readInt16LE(bytes, offset + 8);
        const rawGz = readInt16LE(bytes, offset + 10);
        const hwTs = readUint16LE(bytes, offset + 12); // New: Timestamp

        parsedRaw.push({
            ax: rawToAccel(rawAx),
            ay: rawToAccel(rawAy),
            az: rawToAccel(rawAz),
            gx: rawToGyro(rawGx),
            gy: rawToGyro(rawGy),
            gz: rawToGyro(rawGz),
            hwTs
        });
    }

    // 2. Reconstruct Relative Timing
    // Strategy: Anchor last sample to Date.now(), back-calculate others using hwTs deltas
    const samples: IMUSample[] = new Array(sampleCount);
    const now = Date.now();

    // Initialize last sample
    if (sampleCount > 0) {
        const lastIdx = sampleCount - 1;
        const lastRaw = parsedRaw[lastIdx];

        samples[lastIdx] = {
            timestamp: new Date(now).toISOString(),
            timestampMs: now,
            ax: lastRaw.ax, ay: lastRaw.ay, az: lastRaw.az,
            gx: lastRaw.gx, gy: lastRaw.gy, gz: lastRaw.gz,
        };

        // Back-fill previous samples
        for (let i = lastIdx - 1; i >= 0; i--) {
            const curr = parsedRaw[i];
            const next = parsedRaw[i + 1]; // We know next is valid because we go backwards
            const nextTime = samples[i + 1].timestampMs;

            // Calculate delta ticks (handling 16-bit wrap-around)
            let deltaTicks = (next.hwTs - curr.hwTs);
            if (deltaTicks < 0) deltaTicks += 65536;

            // Convert to ms using V3 scaling factor
            // deltaMs = ticks * (32/30 ns/tick) / 1000 us/ms ... wait.
            // SENSOR_CONFIG.TIMESTAMP_TICK_US is in MICROSECONDS.
            // So deltaTicks * tick_us = total_us.
            // total_us / 1000 = total_ms.
            const deltaMs = (deltaTicks * SENSOR_CONFIG.TIMESTAMP_TICK_US) / 1000.0;

            // Compute time: next - delta
            const currTime = nextTime - deltaMs;

            samples[i] = {
                timestamp: new Date(currTime).toISOString(),
                timestampMs: currTime,
                ax: curr.ax, ay: curr.ay, az: curr.az,
                gx: curr.gx, gy: curr.gy, gz: curr.gz,
            };
        }
    }

    return samples;
}

/**
 * Decode log message
 * 
 * Packet structure:
 * - Byte 0: Message type (0x03)
 * - Bytes 1+: ASCII text
 * 
 * @param bytes - Raw byte array from BLE notification
 * @returns Decoded log message
 */
export function decodeLogMessage(bytes: Uint8Array): LogMessage {
    if (bytes.length < 2) {
        throw new Error(`Invalid log message length: ${bytes.length}`);
    }

    if (bytes[0] !== MESSAGE_TYPES.LOG) {
        throw new Error(`Invalid message type: 0x${bytes[0].toString(16)} (expected 0x03)`);
    }

    // Extract ASCII text (skip first byte)
    const textBytes = bytes.slice(1);
    const message = String.fromCharCode(...textBytes).trim();

    return {
        timestamp: new Date().toISOString(),
        message,
    };
}

/**
 * Decode WHO_AM_I response
 * 
 * Packet structure:
 * - Byte 0: Message type (0x04)
 * - Byte 1: WHO_AM_I register value
 * 
 * @param bytes - Raw byte array from BLE notification
 * @returns Decoded WHO_AM_I response
 */
export function decodeWHOAMI(bytes: Uint8Array): WHOAMIResponse {
    if (bytes.length < 2) {
        throw new Error(`Invalid WHO_AM_I response length: ${bytes.length}`);
    }

    if (bytes[0] !== MESSAGE_TYPES.WHO_AM_I_RESPONSE) {
        throw new Error(`Invalid message type: 0x${bytes[0].toString(16)} (expected 0x04)`);
    }

    const value = bytes[1];
    const isValid = value === SENSOR_CONFIG.EXPECTED_WHO_AM_I;

    return {
        timestamp: new Date().toISOString(),
        value,
        isValid,
    };
}

/**
 * Decode any BLE notification based on message type
 * 
 * @param base64Data - Base64-encoded data from BLE notification
 * @returns Decoded message object (array of samples for SAMPLE type, single object for others)
 */
export function decodeNotification(base64Data: string): IMUSample[] | LogMessage | WHOAMIResponse | null {
    try {
        const bytes = decodeBase64ToBytes(base64Data);

        if (bytes.length === 0) {
            console.warn('Received empty notification');
            return null;
        }

        const messageType = bytes[0];

        switch (messageType) {
            case MESSAGE_TYPES.SAMPLE:
                return decodeIMUPacket(bytes);

            case MESSAGE_TYPES.LOG:
                return decodeLogMessage(bytes);

            case MESSAGE_TYPES.WHO_AM_I_RESPONSE:
                return decodeWHOAMI(bytes);

            default:
                console.warn(`[BLE-DEBUG] Unknown message type: 0x${messageType.toString(16)}`);
                return null;
        }
    } catch (error) {
        console.error('Error decoding notification:', error);
        return null;
    }
}

// ============================================================================
// Command Encoding
// ============================================================================

/**
 * Encode a command byte for sending to the device
 * 
 * @param command - Command code (0x01-0x04)
 * @returns Base64-encoded command
 */
export function encodeCommand(command: number): string {
    const bytes = new Uint8Array([command]);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}
