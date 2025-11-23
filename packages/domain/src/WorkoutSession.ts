import { Set } from './Set';

export interface WorkoutSession {
    id: string;
    userId: string;
    startTime: Date;
    endTime?: Date;
    sets: Set[];
}
