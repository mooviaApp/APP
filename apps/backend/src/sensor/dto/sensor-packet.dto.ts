// apps/backend/src/sensor/dto/sensor-packet.dto.ts
import { IsISO8601, IsNumber } from 'class-validator';

export class SensorPacketDto {
    // ISO string desde el móvil (se convertirá a Date en el backend)
    @IsISO8601()
    timestamp: string;

    @IsNumber()
    ax: number;

    @IsNumber()
    ay: number;

    @IsNumber()
    az: number;

    @IsNumber()
    gx: number;

    @IsNumber()
    gy: number;

    @IsNumber()
    gz: number;
}
