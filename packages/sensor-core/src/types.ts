/**
 * Sensor Core Types & Constants
 * 
 * Shared types and configuration for MOOVIA IMU sensor data.
 * Platform-agnostic: used by both mobile app and web test tool.
 */

import type { Vec3 } from './Vec3';
import type { Quaternion } from './QuaternionMath';

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
    /** Hardware 16-bit timestamp from packet (ticks), optional */
    hwTs16?: number;
    /** Packet sequence (uint16) from the BLE packet header, optional */
    packetSeq16?: number;
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
    acc_net: Vec3;
    q: Quaternion;
    p_raw: Vec3;
    v_raw: Vec3;
    hwTs16?: number;
    isStationary?: boolean;
    linAccMag?: number;
    gyroMagDps?: number;
    dtMs?: number;
}

export interface TrajectoryPoint {
    timestamp: number;
    position: Vec3;
    rotation: Quaternion;
    relativePosition: Vec3;
}

export interface MovementSegment {
    startIndex: number;
    endIndex: number;
    startTimeMs: number;
    endTimeMs: number;
    activeDurationMs: number;
    initialIdleMs: number;
    finalIdleMs: number;
    trimmedTailMs: number;
    endReason: 'final_idle' | 'quiet_tail' | 'fallback';
    residualVelocityAtEnd: {
        x: number;
        y: number;
        z: number;
        speed: number;
    };
    confidence: 'segmented' | 'fallback' | 'insufficient';
}

export interface SessionMovementMetrics {
    peakLinearAcc: number;
    meanPropulsiveVelocity: number;
    globalMeanPropulsiveVelocity: number;
    localMeanPropulsiveVelocity: number;
    meanPeakRepVelocity: number;
    velocityBasis: 'rep-local' | 'session-global' | 'unavailable';
    velocityConfidence: 'high' | 'medium' | 'low';
    maxHeight: number;
    finalHeight: number;
    maxLateral: number;
    finalLateral: number;
    activeEndHeight: number;
    settledEndHeight: number;
    activeEndLateral: number;
    settledEndLateral: number;
    residualSpeedAtEnd: number;
}

export interface SessionEndPoint {
    timestamp: number;
    position: Vec3;
    relativePosition: Vec3;
}

export interface RepetitionMetrics {
    meanPropulsiveVelocity: number;
    peakVerticalVelocity: number;
    peakLinearAcc: number;
    maxHeight: number;
    netHeight: number;
    maxLateral: number;
    finalLateral: number;
}

export interface RepetitionSummary {
    index: number;
    startIndex: number;
    apexIndex: number;
    endIndex: number;
    startTimeMs: number;
    apexTimeMs: number;
    endTimeMs: number;
    durationMs: number;
    direction: 'up-first' | 'down-first';
    completed: boolean;
    confidence: 'high' | 'low';
    metrics: RepetitionMetrics;
}

export interface RepAnalysisSummary {
    repCount: number;
    reps: RepetitionSummary[];
    partialRep: RepetitionSummary | null;
    seriesMeanPropulsiveVelocity: number;
    bestRepIndex: number | null;
    detectionMode: 'local-cycles';
    firstDirection: 'up-first' | 'down-first' | null;
    detrendWindowMs: number;
    detectedTurningPoints: number;
    cycleConfidence: 'high' | 'medium' | 'low';
}

export interface MetricConfidenceSummary {
    velocity: 'high' | 'medium' | 'low';
    height: 'high' | 'medium' | 'low';
    lateral: 'high' | 'medium' | 'low';
    acceleration: 'high' | 'medium' | 'low';
    repCount: 'high' | 'medium' | 'low';
    timebase: 'high' | 'medium' | 'low';
}

export interface SessionAnalysisDiagnostics {
    barAxisConfidence: 'high' | 'low' | 'unavailable';
    effectiveTickUs: number | null;
    observedTickUs: number | null;
    configuredTickUs: number;
    configuredSampleIntervalUs: number;
    timebaseConfidence: 'high' | 'medium' | 'low';
    metricConfidence: MetricConfidenceSummary;
}

export interface SessionAnalysisSummary {
    movementSegment: MovementSegment | null;
    movementMetrics: SessionMovementMetrics;
    repAnalysis: RepAnalysisSummary;
    activePath: TrajectoryPoint[];
    fullPath: TrajectoryPoint[];
    activeEndPoint: SessionEndPoint | null;
    settledEndPoint: SessionEndPoint | null;
    diagnostics: SessionAnalysisDiagnostics;
}

export interface CaptureHealthStats {
    avgRateHz: number;
    medianDtMs: number;
    maxDtMs: number;
    gapsPct: number;
    maxGapMs: number;
    totalPackets: number;
    invalidPackets: number;
    estimatedMissingSamples: number;
    droppedPackets: number;
    missingPackets: number;
    duplicatePackets: number;
    reorderedPackets: number;
    durationMs: number;
    effectiveTickUs: number | null;
    configuredTickUs: number;
    configuredSampleIntervalUs: number;
    timebaseConfidence: 'high' | 'medium' | 'low';
}

export interface RawPacketRecord {
    /** Base64 payload exactly as received from BLE notification */
    base64: string;
    /** Wall-clock timestamp (ms) when the packet was received */
    receivedAt: number;
    /** Packet length in bytes */
    length: number;
    /** Number of IMU samples decoded from this packet */
    sampleCount: number;
    /** Monotonic index of the packet within the session (starting at 0) */
    index: number;
    /** Packet sequence from the IMU packet header, if available */
    seq16?: number;
}

/** Raw-only export (no processed trajectory) */
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
        session?: SessionTransportState;
    };
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
