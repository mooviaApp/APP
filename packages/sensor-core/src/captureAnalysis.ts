import {
    CaptureHealthStats,
    IMUSample,
    RawPacketRecord,
    SENSOR_CONFIG,
} from './types';

const GAP_THRESHOLD_MS = 4;

function classifyTimebaseConfidence(
    avgRateHz: number,
    expectedHz: number,
    observedTickUs: number | null,
): 'high' | 'medium' | 'low' {
    const rateError = expectedHz > 0
        ? Math.abs(avgRateHz - expectedHz) / expectedHz
        : 1;
    const tickError = observedTickUs === null
        ? 1
        : Math.abs(observedTickUs - SENSOR_CONFIG.TIMESTAMP_TICK_US) / SENSOR_CONFIG.TIMESTAMP_TICK_US;

    if (rateError <= 0.03 && tickError <= 0.03) {
        return 'high';
    }
    if (rateError <= 0.12 && tickError <= 0.08) {
        return 'medium';
    }
    return 'low';
}

function deltaTicks16(prev: number, curr: number) {
    return (curr - prev + 0x10000) & 0xFFFF;
}

function median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
}

export function analyzeCaptureHealth(
    samples: IMUSample[],
    rawPackets: RawPacketRecord[] = [],
    expectedHz: number = SENSOR_CONFIG.ODR_HZ,
): CaptureHealthStats {
    let maxPacketGapMs = 0;
    let invalidPackets = 0;
    let droppedPackets = 0;
    let missingPackets = 0;
    let duplicatePackets = 0;
    let reorderedPackets = 0;
    let lastSeq16: number | null = null;
    let effectiveTickUs: number | null = null;

    rawPackets.forEach((packet, index) => {
        if (packet.length !== SENSOR_CONFIG.PACKET_SIZE_BYTES) {
            invalidPackets++;
        }
        if (packet.sampleCount < SENSOR_CONFIG.SAMPLES_PER_PACKET) {
            droppedPackets++;
        }
        if (index > 0) {
            const gap = packet.receivedAt - rawPackets[index - 1].receivedAt;
            if (gap > maxPacketGapMs) maxPacketGapMs = gap;
        }

        if (typeof packet.seq16 !== 'number') {
            return;
        }

        if (lastSeq16 === null) {
            lastSeq16 = packet.seq16;
            return;
        }

        const delta = (packet.seq16 - lastSeq16 + 0x10000) & 0xFFFF;
        if (delta === 1) {
            lastSeq16 = packet.seq16;
            return;
        }
        if (delta === 0) {
            duplicatePackets++;
            return;
        }
        if (delta > 1 && delta < 0x8000) {
            missingPackets += delta - 1;
            lastSeq16 = packet.seq16;
            return;
        }

        reorderedPackets++;
    });

    if (!samples || samples.length < 2) {
        return {
            avgRateHz: 0,
            medianDtMs: 0,
            maxDtMs: 0,
            gapsPct: 0,
            maxGapMs: 0,
            totalPackets: rawPackets.length,
            invalidPackets,
            estimatedMissingSamples: missingPackets * SENSOR_CONFIG.SAMPLES_PER_PACKET,
            droppedPackets,
            missingPackets,
            duplicatePackets,
            reorderedPackets,
            durationMs: 0,
            effectiveTickUs,
            configuredTickUs: SENSOR_CONFIG.TIMESTAMP_TICK_US,
            configuredSampleIntervalUs: expectedHz > 0 ? 1_000_000 / expectedHz : 0,
            timebaseConfidence: 'low',
        };
    }

    const sortedSamples = [...samples].sort((a, b) => a.timestampMs - b.timestampMs);
    const dts: number[] = [];
    for (let i = 0; i < sortedSamples.length - 1; i++) {
        dts.push(sortedSamples[i + 1].timestampMs - sortedSamples[i].timestampMs);
    }

    const durationMs = sortedSamples[sortedSamples.length - 1].timestampMs - sortedSamples[0].timestampMs;
    const avgRateHz = durationMs > 0 ? sortedSamples.length / (durationMs / 1000) : 0;
    const medianDtMs = median(dts);
    const maxDtMs = dts.length > 0 ? Math.max(...dts) : 0;
    const gapsPct = dts.length > 0
        ? (dts.filter((dt) => dt > GAP_THRESHOLD_MS).length / dts.length) * 100
        : 0;

    const expectedSamples = durationMs > 0 ? Math.round((durationMs / 1000) * expectedHz) : 0;
    const estimatedFromRate = Math.max(0, expectedSamples - sortedSamples.length);
    const estimatedMissingSamples = missingPackets > 0
        ? missingPackets * SENSOR_CONFIG.SAMPLES_PER_PACKET
        : estimatedFromRate;

    const hwTickDeltas: number[] = [];
    for (let i = 0; i < sortedSamples.length - 1; i++) {
        const prev = sortedSamples[i].hwTs16;
        const curr = sortedSamples[i + 1].hwTs16;
        if (typeof prev !== 'number' || typeof curr !== 'number') continue;
        const delta = deltaTicks16(prev, curr);
        if (delta > 0) hwTickDeltas.push(delta);
    }
    if (hwTickDeltas.length > 0 && expectedHz > 0) {
        const medianTickDelta = median(hwTickDeltas);
        const expectedSampleIntervalUs = 1_000_000 / expectedHz;
        effectiveTickUs = expectedSampleIntervalUs / medianTickDelta;
    }

    const timebaseConfidence = classifyTimebaseConfidence(avgRateHz, expectedHz, effectiveTickUs);

    return {
        avgRateHz,
        medianDtMs,
        maxDtMs,
        gapsPct,
        maxGapMs: Math.max(maxPacketGapMs, maxDtMs),
        totalPackets: rawPackets.length,
        invalidPackets,
        estimatedMissingSamples,
        droppedPackets,
        missingPackets,
        duplicatePackets,
        reorderedPackets,
        durationMs,
        effectiveTickUs,
        configuredTickUs: SENSOR_CONFIG.TIMESTAMP_TICK_US,
        configuredSampleIntervalUs: expectedHz > 0 ? 1_000_000 / expectedHz : 0,
        timebaseConfidence,
    };
}
