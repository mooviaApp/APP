// apps/backend/src/sensor/sensor.module.ts
import { Module } from '@nestjs/common';
import { SensorService } from './sensor.service';
import { SensorController } from './sensor.controller';
import { PrismaService } from '../prisma/prisma.service';

@Module({
    controllers: [SensorController],
    providers: [SensorService, PrismaService],
})
export class SensorModule { }
