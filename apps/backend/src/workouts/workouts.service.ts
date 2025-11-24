import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GetSensorDataResponseDto } from './dto/sensor-sample.dto';
import { SetMetricsDto, RepMetricDto } from './dto/set-metrics.dto';

@Injectable()
export class WorkoutsService {
    constructor(private readonly prisma: PrismaService) { }

    async createSession(userId: string, exercise: string) {
        return this.prisma.workoutSession.create({
            data: { userId, exercise },
        });
    }

    async addSet(sessionId: string, weight: number, reps: number) {
        return this.prisma.set.create({
            data: { sessionId, weight, reps },
        });
    }

    async findSession(id: string) {
        return this.prisma.workoutSession.findUnique({
            where: { id },
            include: { sets: true },
        });
    }

    async getSensorDataForSet(
        sessionId: string,
        setId: string,
    ): Promise<GetSensorDataResponseDto> {
        // 1) Verificar que el set existe y pertenece a la sesión
        const set = await this.prisma.set.findFirst({
            where: {
                id: setId,
                sessionId,
            },
        });

        if (!set) {
            throw new NotFoundException('Set not found for this session');
        }

        // 2) Obtener las muestras ordenadas por timestamp
        const samples = await this.prisma.sensorPacket.findMany({
            where: { setId: set.id },
            orderBy: { timestamp: 'asc' },
        });

        return {
            status: 'ok',
            sessionId,
            setId,
            count: samples.length,
            samples: samples.map((s) => ({
                id: s.id,
                timestamp: s.timestamp.toISOString(),
                ax: s.ax,
                ay: s.ay,
                az: s.az,
                gx: s.gx,
                gy: s.gy,
                gz: s.gz,
            })),
        };
    }

    async getSetMetrics(sessionId: string, setId: string): Promise<SetMetricsDto> {
        // 1) Verificamos que el set existe y pertenece a la sesión
        const set = await this.prisma.set.findFirst({
            where: {
                id: setId,
                sessionId,
            },
        });

        if (!set) {
            throw new NotFoundException('Set not found for this session');
        }

        // 2) Obtenemos las muestras
        const samples = await this.prisma.sensorPacket.findMany({
            where: { setId: set.id },
            orderBy: { timestamp: 'asc' },
        });

        const sampleCount = samples.length;

        if (sampleCount === 0) {
            return {
                status: 'ok',
                sessionId,
                setId,
                sampleCount: 0,
                durationSec: 0,
                repCount: 0,
                reps: [],
            };
        }

        // 3) Preparamos arrays de trabajo
        const g = 9.81; // m/s²
        const t: number[] = [];       // tiempo relativo en segundos
        const aZ: number[] = [];      // aceleración vertical neta (az - g)
        const v: number[] = [];       // velocidad integrando aZ

        const t0 = samples[0].timestamp.getTime();

        samples.forEach((s, i) => {
            const ti = (s.timestamp.getTime() - t0) / 1000; // ms → s
            t.push(ti);
            aZ.push(s.az - g);
            if (i === 0) {
                v.push(0); // velocidad inicial 0
            } else {
                const dt = t[i] - t[i - 1];
                // integración trapezoidal simple
                const vi = v[i - 1] + ((aZ[i - 1] + aZ[i]) / 2) * dt;
                v.push(vi);
            }
        });

        const durationSec = t[t.length - 1] - t[0];

        // 4) Detección sencilla de repeticiones por umbral de velocidad
        const VELOCITY_THRESHOLD = 0.3; // m/s, ajustable
        const MIN_REP_DURATION = 0.15;  // s, descartamos picos muy cortos

        const reps: RepMetricDto[] = [];
        let inRep = false;
        let repStartIndex = 0;

        for (let i = 0; i < sampleCount; i++) {
            const speedAbs = Math.abs(v[i]);

            if (!inRep && speedAbs > VELOCITY_THRESHOLD) {
                // empieza rep
                inRep = true;
                repStartIndex = i;
            }

            if (inRep && speedAbs <= VELOCITY_THRESHOLD) {
                // termina rep
                const repEndIndex = i - 1 >= repStartIndex ? i - 1 : repStartIndex;
                const repDuration = t[repEndIndex] - t[repStartIndex];

                if (repDuration >= MIN_REP_DURATION) {
                    // calculamos métricas de la rep
                    let peakVel = 0;
                    let sumVel = 0;
                    let countVel = 0;

                    for (let k = repStartIndex; k <= repEndIndex; k++) {
                        const velAbs = Math.abs(v[k]);
                        if (velAbs > peakVel) {
                            peakVel = velAbs;
                        }
                        sumVel += velAbs;
                        countVel++;
                    }

                    const meanVel = countVel > 0 ? sumVel / countVel : 0;

                    reps.push({
                        index: reps.length + 1,
                        startTimestamp: samples[repStartIndex].timestamp.toISOString(),
                        endTimestamp: samples[repEndIndex].timestamp.toISOString(),
                        durationSec: repDuration,
                        peakVelocity: peakVel,
                        meanVelocity: meanVel,
                    });
                }

                inRep = false;
            }
        }

        // Si el set termina en mitad de una rep, la cerramos al final
        if (inRep) {
            const repEndIndex = sampleCount - 1;
            const repDuration = t[repEndIndex] - t[repStartIndex];

            if (repDuration >= MIN_REP_DURATION) {
                let peakVel = 0;
                let sumVel = 0;
                let countVel = 0;

                for (let k = repStartIndex; k <= repEndIndex; k++) {
                    const velAbs = Math.abs(v[k]);
                    if (velAbs > peakVel) {
                        peakVel = velAbs;
                    }
                    sumVel += velAbs;
                    countVel++;
                }

                const meanVel = countVel > 0 ? sumVel / countVel : 0;

                reps.push({
                    index: reps.length + 1,
                    startTimestamp: samples[repStartIndex].timestamp.toISOString(),
                    endTimestamp: samples[repEndIndex].timestamp.toISOString(),
                    durationSec: repDuration,
                    peakVelocity: peakVel,
                    meanVelocity: meanVel,
                });
            }
        }

        return {
            status: 'ok',
            sessionId,
            setId,
            sampleCount,
            durationSec,
            repCount: reps.length,
            reps,
        };
    }
}
