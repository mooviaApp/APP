import { Module } from '@nestjs/common';
import { WorkoutsService } from './workouts.service';
import { WorkoutsController } from './workouts.controller';
import { PrismaService } from '../prisma/prisma.service';

@Module({
    providers: [WorkoutsService, PrismaService],
    controllers: [WorkoutsController],
    exports: [WorkoutsService],
})
export class WorkoutsModule { }
