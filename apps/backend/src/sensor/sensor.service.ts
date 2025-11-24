// apps/backend/src/sensor/sensor.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SensorBatchDto } from './dto/sensor-batch.dto';

@Injectable()
export class SensorService {
    constructor(private readonly prisma: PrismaService) { }

    /**
     * Guarda un batch de datos inerciales para un set concreto.
     */
    async saveSensorBatch(
        sessionId: string,
        setId: string,
        batch: SensorBatchDto,
    ) {
        try {
            // 1) Verificar que el set existe y pertenece a la sesión indicada
            const set = await this.prisma.set.findFirst({
                where: {
                    id: setId,
                    sessionId,
                },
            });

            if (!set) {
                throw new NotFoundException(
                    `Set ${setId} no encontrado para la sesión ${sessionId}`,
                );
            }

            // 2) Preparar datos para createMany
            // IMPORTANTE: deviceId se pone a null porque el schema espera una FK a Device
            // Si quieres guardar el string deviceId, necesitarías crear primero un Device
            const data = batch.samples.map((sample) => ({
                setId: set.id,
                deviceId: null, // No vinculamos a Device por ahora
                timestamp: new Date(sample.timestamp),
                ax: sample.ax,
                ay: sample.ay,
                az: sample.az,
                gx: sample.gx,
                gy: sample.gy,
                gz: sample.gz,
            }));

            if (data.length === 0) {
                // No tiene sentido insertar un batch vacío
                return { inserted: 0 };
            }

            // 3) Insertar en bloque (más eficiente que uno a uno)
            const result = await this.prisma.sensorPacket.createMany({
                data,
            });

            return {
                inserted: result.count,
            };
        } catch (error) {
            // Log del error para debugging
            console.error('Error in saveSensorBatch:', error);

            // Re-lanzar si ya es una excepción de Nest
            if (error instanceof NotFoundException) {
                throw error;
            }

            // Convertir otros errores a InternalServerErrorException
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Failed to save sensor data: ${message}`);
        }
    }
}
