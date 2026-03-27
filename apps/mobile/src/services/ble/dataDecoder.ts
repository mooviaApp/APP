/**
 * BLE Data Decoder Utilities
 *
 * Functions for decoding BLE notification data from the MOOVIA sensor.
 * Handles int16 little-endian conversion and physical unit conversion.
 *
 * Firmware-aligned packet format:
 * - byte 0: type (0x02)
 * - bytes 1..2: seq16 little-endian
 * - bytes 3..212: 15 samples x 14 bytes
 */

import { decode as base64Decode, encode as base64Encode } from 'base-64';
import {
    IMUSample,
    LogMessage,
    WHOAMIResponse,
    MESSAGE_TYPES,
    SENSOR_CONFIG,
} from './constants';

export interface DecodedImuPacket {
    seq16: number;
    samples: IMUSample[];
}

let lastHwTimestamp16: number | null = null;
let lastAbsTimestampMs: number | null = null;

export function resetIMUTimestampContinuity() {
    lastHwTimestamp16 = null;
    lastAbsTimestampMs = null;
}

function deltaTicks16(prev: number, curr: number) {
    return (curr - prev + 0x10000) & 0xffff;
}

export function decodeBase64ToBytes(base64: string): Uint8Array {
    const binaryString = base64Decode(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

export function encodeBytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return base64Encode(binary);
}

export function readInt16LE(bytes: Uint8Array, offset: number): number {
    const low = bytes[offset];
    const high = bytes[offset + 1];
    const value = (high << 8) | low;
    return value > 0x7FFF ? value - 0x10000 : value;
}

export function readUint16LE(bytes: Uint8Array, offset: number): number {
    const low = bytes[offset];
    const high = bytes[offset + 1];
    return (high << 8) | low;
}

export function rawToGyro(raw: number): number {
    return raw / 32.8;
}

export function rawToAccel(raw: number): number {
    return raw / 4096;
}

export function decodeIMUPacket(bytes: Uint8Array): DecodedImuPacket | null {
    if (bytes.length !== SENSOR_CONFIG.PACKET_SIZE_BYTES) {
        console.warn(`[BLE-ERR] Invalid IMU packet length: ${bytes.length} (expected ${SENSOR_CONFIG.PACKET_SIZE_BYTES})`);
        return null;
    }

    if (bytes[0] !== MESSAGE_TYPES.SAMPLE) {
        console.warn(`[BLE-ERR] Invalid message type: 0x${bytes[0].toString(16)} (expected 0x02)`);
        return null;
    }

    const seq16 = readUint16LE(bytes, 1);
    const parsedRaw: Array<{
        ax: number; ay: number; az: number;
        gx: number; gy: number; gz: number;
        hwTs: number;
    }> = [];

    for (let i = 0; i < SENSOR_CONFIG.SAMPLES_PER_PACKET; i++) {
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

    const samples: IMUSample[] = new Array(parsedRaw.length);
    const now = Date.now();

    let anchorMs: number;
    if (lastHwTimestamp16 === null || lastAbsTimestampMs === null) {
        anchorMs = now;
        console.log('[Decoder] Timestamp anchor: wall-clock (continuity reset)');
    } else {
        const lastRaw = parsedRaw[parsedRaw.length - 1];
        const dTicks = deltaTicks16(lastHwTimestamp16, lastRaw.hwTs);
        const dMs = (dTicks * SENSOR_CONFIG.TIMESTAMP_TICK_US) / 1000.0;
        if (dMs > 1000) {
            anchorMs = now;
            console.log('[Decoder] Timestamp anchor: wall-clock (large gap)');
        } else {
            anchorMs = lastAbsTimestampMs + dMs;
        }
    }

    const lastIdx = parsedRaw.length - 1;
    const lastRaw = parsedRaw[lastIdx];
    samples[lastIdx] = {
        timestamp: new Date(anchorMs).toISOString(),
        timestampMs: anchorMs,
        ax: lastRaw.ax,
        ay: lastRaw.ay,
        az: lastRaw.az,
        gx: lastRaw.gx,
        gy: lastRaw.gy,
        gz: lastRaw.gz,
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
            ax: curr.ax,
            ay: curr.ay,
            az: curr.az,
            gx: curr.gx,
            gy: curr.gy,
            gz: curr.gz,
            hwTs16: curr.hwTs,
            packetSeq16: seq16,
        };
    }

    lastHwTimestamp16 = lastRaw.hwTs;
    lastAbsTimestampMs = anchorMs;

    return { seq16, samples };
}

export function decodeLogMessage(bytes: Uint8Array): LogMessage {
    if (bytes.length < 2) {
        throw new Error(`Invalid log message length: ${bytes.length}`);
    }

    if (bytes[0] !== MESSAGE_TYPES.LOG) {
        throw new Error(`Invalid message type: 0x${bytes[0].toString(16)} (expected 0x03)`);
    }

    const textBytes = bytes.slice(1);
    const message = String.fromCharCode(...textBytes).trim();

    return {
        timestamp: new Date().toISOString(),
        message,
    };
}

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

export function decodeNotification(base64Data: string): DecodedImuPacket | LogMessage | WHOAMIResponse | null {
    try {
        const bytes = decodeBase64ToBytes(base64Data);

        if (bytes.length === 0) {
            console.warn('Received empty notification');
            return null;
        }

        switch (bytes[0]) {
            case MESSAGE_TYPES.SAMPLE:
                return decodeIMUPacket(bytes);
            case MESSAGE_TYPES.LOG:
                return decodeLogMessage(bytes);
            case MESSAGE_TYPES.WHO_AM_I_RESPONSE:
                return decodeWHOAMI(bytes);
            default:
                console.warn(`[BLE-DEBUG] Unknown message type: 0x${bytes[0].toString(16)}`);
                return null;
        }
    } catch (error) {
        console.error('Error decoding notification:', error);
        return null;
    }
}

export function encodeCommand(command: number): string {
    return encodeBytesToBase64(new Uint8Array([command]));
}
