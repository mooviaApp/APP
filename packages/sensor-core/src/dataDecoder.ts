/**
 * Data Decoder Utilities
 * 
 * Pure conversion functions for MOOVIA IMU sensor data.
 * No BLE dependencies — works with raw byte arrays.
 */

import { IMUSample, SENSOR_CONFIG, MESSAGE_TYPES } from './types';

// ============================================================================
// Low-level Data Conversion
// ============================================================================

/**
 * Read a signed 16-bit integer in little-endian format
 */
export function readInt16LE(bytes: Uint8Array | number[], offset: number): number {
    const low = bytes[offset];
    const high = bytes[offset + 1];
    const value = (high << 8) | low;
    return value > 0x7FFF ? value - 0x10000 : value;
}

/**
 * Read an unsigned 16-bit integer in little-endian format
 */
export function readUint16LE(bytes: Uint8Array | number[], offset: number): number {
    const low = bytes[offset];
    const high = bytes[offset + 1];
    return (high << 8) | low;
}

// ============================================================================
// Physical Unit Conversion
// ============================================================================

/**
 * Convert raw accelerometer value to g
 * ICM-42688-P: ±8g range → 4096 LSB/g
 */
export function rawToAccel(raw: number): number {
    return raw / SENSOR_CONFIG.ACC_LSB_PER_G;
}

/**
 * Convert raw gyroscope value to dps
 * ICM-42688-P: ±1000 dps range → 32.8 LSB/dps
 */
export function rawToGyro(raw: number): number {
    return raw / SENSOR_CONFIG.GYRO_LSB_PER_DPS;
}

// ============================================================================
// Packet Decoder
// ============================================================================

// Timestamp continuity state (cross-packet)
let lastHwTimestamp16: number | null = null;
let lastAbsTimestampMs: number | null = null;

/**
 * Reset the hardware timestamp continuity state.
 */
export function resetIMUTimestampContinuity() {
    lastHwTimestamp16 = null;
    lastAbsTimestampMs = null;
}

function deltaTicks16(prev: number, curr: number) {
    return (curr - prev + 0x10000) & 0xffff;
}

export interface DecodedImuPacket {
    seq16: number;
    samples: IMUSample[];
}

/**
 * Decode IMU sample data packet.
 * Firmware format:
 * - byte 0: message type (0x02)
 * - bytes 1..2: seq16 little-endian
 * - bytes 3..212: 15 samples x 14 bytes
 */
export function decodeIMUPacket(bytes: Uint8Array | number[]): DecodedImuPacket | null {
    if (bytes.length !== SENSOR_CONFIG.PACKET_SIZE_BYTES) {
        console.warn(`[Decoder] Invalid IMU packet length: ${bytes.length}`);
        return null;
    }

    if (bytes[0] !== MESSAGE_TYPES.SAMPLE) {
        console.warn(`[Decoder] Invalid message type: 0x${bytes[0].toString(16)}`);
        return null;
    }

    const seq16 = readUint16LE(bytes, 1);
    const sampleCount = SENSOR_CONFIG.SAMPLES_PER_PACKET;

    const parsedRaw: {
        ax: number; ay: number; az: number;
        gx: number; gy: number; gz: number;
        hwTs: number;
    }[] = [];

    for (let i = 0; i < sampleCount; i++) {
        const offset = SENSOR_CONFIG.PACKET_HEADER_BYTES + (i * SENSOR_CONFIG.BYTES_PER_SAMPLE);
        parsedRaw.push({
            ax: rawToAccel(readInt16LE(bytes, offset + 0)),
            ay: rawToAccel(readInt16LE(bytes, offset + 2)),
            az: rawToAccel(readInt16LE(bytes, offset + 4)),
            gx: rawToGyro(readInt16LE(bytes, offset + 6)),
            gy: rawToGyro(readInt16LE(bytes, offset + 8)),
            gz: rawToGyro(readInt16LE(bytes, offset + 10)),
            hwTs: readUint16LE(bytes, offset + 12),
        });
    }

    const samples: IMUSample[] = new Array(sampleCount);
    const now = Date.now();

    let anchorMs: number;
    if (lastHwTimestamp16 === null || lastAbsTimestampMs === null) {
        anchorMs = now;
    } else {
        const lastRaw = parsedRaw[sampleCount - 1];
        const dTicks = deltaTicks16(lastHwTimestamp16, lastRaw.hwTs);
        const dMs = (dTicks * SENSOR_CONFIG.TIMESTAMP_TICK_US) / 1000.0;
        anchorMs = dMs > 1000 ? now : lastAbsTimestampMs + dMs;
    }

    const lastIdx = sampleCount - 1;
    const lastRaw = parsedRaw[lastIdx];
    samples[lastIdx] = {
        timestamp: new Date(anchorMs).toISOString(),
        timestampMs: anchorMs,
        ax: lastRaw.ax, ay: lastRaw.ay, az: lastRaw.az,
        gx: lastRaw.gx, gy: lastRaw.gy, gz: lastRaw.gz,
        hwTs16: lastRaw.hwTs,
        packetSeq16: seq16,
    };

    for (let i = lastIdx - 1; i >= 0; i--) {
        const curr = parsedRaw[i];
        const next = parsedRaw[i + 1];
        const nextTime = samples[i + 1].timestampMs;
        const dTicks = deltaTicks16(curr.hwTs, next.hwTs);
        const dMs = (dTicks * SENSOR_CONFIG.TIMESTAMP_TICK_US) / 1000.0;
        const currTime = nextTime - dMs;

        samples[i] = {
            timestamp: new Date(currTime).toISOString(),
            timestampMs: currTime,
            ax: curr.ax, ay: curr.ay, az: curr.az,
            gx: curr.gx, gy: curr.gy, gz: curr.gz,
            hwTs16: curr.hwTs,
            packetSeq16: seq16,
        };
    }

    lastHwTimestamp16 = lastRaw.hwTs;
    lastAbsTimestampMs = anchorMs;

    return { seq16, samples };
}
