// apps/backend/src/workouts/dto/set-metrics.dto.ts

export class RepMetricDto {
    index: number; // rep 1, 2, 3...
    startTimestamp: string;
    endTimestamp: string;
    durationSec: number;
    peakVelocity: number; // m/s
    meanVelocity: number; // m/s
}

export class SetMetricsDto {
    status: string;
    sessionId: string;
    setId: string;
    sampleCount: number;
    durationSec: number;
    repCount: number;
    reps: RepMetricDto[];
}
