// apps/backend/src/sensor/sensor.controller.ts
import {
    Body,
    Controller,
    Param,
    Post,
} from '@nestjs/common';
import { SensorService } from './sensor.service';
import { SensorBatchDto } from './dto/sensor-batch.dto';

@Controller('workouts')
export class SensorController {
    constructor(private readonly sensorService: SensorService) { }

    /**
     * Endpoint para recibir datos del sensor para un set concreto.
     *
     * Ejemplo de URL:
     * POST /workouts/:sessionId/sets/:setId/sensor
     */
    @Post(':sessionId/sets/:setId/sensor')
    async uploadSensorData(
        @Param('sessionId') sessionId: string,
        @Param('setId') setId: string,
        @Body() batch: SensorBatchDto,
    ) {
        const result = await this.sensorService.saveSensorBatch(
            sessionId,
            setId,
            batch,
        );

        return {
            status: 'ok',
            sessionId,
            setId,
            inserted: result.inserted,
        };
    }
}
