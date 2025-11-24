// apps/backend/src/sensor/dto/sensor-batch.dto.ts
import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';
import { SensorPacketDto } from './sensor-packet.dto';

export class SensorBatchDto {
    // Opcional pero útil para trazabilidad
    // IMPORTANTE: Este es solo un identificador de string, NO una FK a Device
    @IsOptional()
    @IsString()
    deviceId?: string;

    // Lista de muestras
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => SensorPacketDto)
    samples: SensorPacketDto[];
}
