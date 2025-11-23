import { SensorPacket } from './SensorPacket';

export interface Set {
    id: string;
    sessionId: string;
    exerciseName: string;
    weight: number;
    reps: number;
    rpe?: number; // Rate of Perceived Exertion (1-10)
    packets: SensorPacket[];
}
