import {
    CaptureHealthStats,
    IMUSample,
    RawPacketRecord,
    SENSOR_CONFIG,
} from './types';

const GAP_THRESHOLD_MS = 4;

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
    if (!samples || samples.length < 2) {
        return {
            avgRateHz: 0,
            medianDtMs: 0,
            maxDtMs: 0,
            gapsPct: 0,
            maxGapMs: 0,
            totalPackets: rawPackets.length,
            invalidPackets: 0,
            estimatedMissingSamples: 0,
            droppedPackets: 0,
            durationMs: 0,
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

    let maxPacketGapMs = 0;
    let invalidPackets = 0;
    let droppedPackets = 0;
    rawPackets.forEach((packet, index) => {
        if (packet.length !== SENSOR_CONFIG.PACKET_SIZE_BYTES) invalidPackets++;
        if (packet.sampleCount === 0) droppedPackets++;
        if (index > 0) {
            const gap = packet.receivedAt - rawPackets[index - 1].receivedAt;
            if (gap > maxPacketGapMs) maxPacketGapMs = gap;
        }
    });

    const expectedSamples = durationMs > 0 ? Math.round((durationMs / 1000) * expectedHz) : 0;
    const estimatedMissingSamples = Math.max(0, expectedSamples - sortedSamples.length);

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
        durationMs,
    };
}
