import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { WorkoutsService } from './workouts.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { AddSetDto } from './dto/add-set.dto';
import { GetSensorDataResponseDto } from './dto/sensor-sample.dto';
import { SetMetricsDto } from './dto/set-metrics.dto';

@Controller('workouts')
export class WorkoutsController {
    constructor(private readonly workoutsService: WorkoutsService) { }

    @Post()
    async create(@Body() dto: CreateSessionDto) {
        return this.workoutsService.createSession(dto.userId, dto.exercise);
    }

    @Post(':id/sets')
    async addSet(@Param('id') id: string, @Body() dto: AddSetDto) {
        return this.workoutsService.addSet(id, dto.weight, dto.reps);
    }

    @Get(':id')
    async get(@Param('id') id: string) {
        return this.workoutsService.findSession(id);
    }

    @Get(':sessionId/sets/:setId/sensor')
    async getSensorData(
        @Param('sessionId') sessionId: string,
        @Param('setId') setId: string,
    ): Promise<GetSensorDataResponseDto> {
        return this.workoutsService.getSensorDataForSet(sessionId, setId);
    }

    @Get(':sessionId/sets/:setId/metrics')
    async getSetMetrics(
        @Param('sessionId') sessionId: string,
        @Param('setId') setId: string,
    ): Promise<SetMetricsDto> {
        return this.workoutsService.getSetMetrics(sessionId, setId);
    }
}
