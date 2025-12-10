/**
 * BLE Data Decoder Utilities
 * 
 * Functions for decoding BLE notification data from the MOOVIA sensor.
 * Handles int16 little-endian conversion and physical unit conversion.
 * 
 * Updated for firmware v2: 20 samples per packet at 1 kHz ODR
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

// ============================================================================
// Physical Unit Conversion
// ============================================================================

/**
 * Convert raw gyroscope value to degrees per second
 * Formula: (raw / 32768.0) * range
 * 
 * @param raw - Raw int16 value from sensor
 * @returns Gyroscope value in dps
 */
export function rawToGyro(raw: number): number {
    return (raw / 32768.0) * SENSOR_CONFIG.GYRO_RANGE_DPS;
}

/**
 * Convert raw accelerometer value to g
 * Formula: (raw / 32768.0) * range
 * 
 * @param raw - Raw int16 value from sensor
 * @returns Accelerometer value in g
 */
export function rawToAccel(raw: number): number {
    return (raw / 32768.0) * SENSOR_CONFIG.ACCEL_RANGE_G;
}

// ============================================================================
// Message Decoders
// ============================================================================

/**
 * Decode IMU sample data packet with 20 aggregated samples
 * 
 * Packet structure (241 bytes):
 * - Byte 0: Message type (0x02)
 * - Bytes 1-12: Sample 1 (ax, ay, az, gx, gy, gz as int16 LE)
 * - Bytes 13-24: Sample 2
 * - ... (continues for 20 samples total)
 * - Bytes 229-240: Sample 20
 * 
 * @param bytes - Raw byte array from BLE notification
 * @returns Array of 20 decoded IMU samples with physical units
 */
export function decodeIMUPacket(bytes: Uint8Array): IMUSample[] {
    const expectedSize = SENSOR_CONFIG.PACKET_SIZE_BYTES;

    if (bytes.length < expectedSize) {
        throw new Error(`Invalid IMU packet length: ${bytes.length} (expected ${expectedSize})`);
    }

    if (bytes[0] !== MESSAGE_TYPES.SAMPLE) {
        throw new Error(`Invalid message type: 0x${bytes[0].toString(16)} (expected 0x02)`);
    }

    const samples: IMUSample[] = [];
    const baseTimestamp = Date.now();

    // Parse 20 samples starting from byte 1
    for (let i = 0; i < SENSOR_CONFIG.SAMPLES_PER_PACKET; i++) {
        const offset = 1 + (i * SENSOR_CONFIG.BYTES_PER_SAMPLE);

        // Read raw int16 values for this sample
        const rawAx = readInt16LE(bytes, offset + 0);
        const rawAy = readInt16LE(bytes, offset + 2);
        const rawAz = readInt16LE(bytes, offset + 4);
        const rawGx = readInt16LE(bytes, offset + 6);
        const rawGy = readInt16LE(bytes, offset + 8);
        const rawGz = readInt16LE(bytes, offset + 10);

        // Calculate timestamp for this sample
        // Each sample is 1ms apart (1 kHz ODR)
        const sampleTimestamp = new Date(baseTimestamp + i).toISOString();

        // Convert to physical units and add to array
        samples.push({
            timestamp: sampleTimestamp,
            ax: rawToAccel(rawAx),
            ay: rawToAccel(rawAy),
            az: rawToAccel(rawAz),
            gx: rawToGyro(rawGx),
            gy: rawToGyro(rawGy),
            gz: rawToGyro(rawGz),
        });
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
                console.warn(`Unknown message type: 0x${messageType.toString(16)}`);
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
