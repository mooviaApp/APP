// apps/backend/src/workouts/dto/sensor-sample.dto.ts

export class SensorSampleDto {
    id: string;
    timestamp: string;
    ax: number;
    ay: number;
    az: number;
    gx: number;
    gy: number;
    gz: number;
}

export class GetSensorDataResponseDto {
    status: string;
    sessionId: string;
    setId: string;
    count: number;
    samples: SensorSampleDto[];
}
