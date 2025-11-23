export interface AthleteProfile {
    userId: string;
    weight: number; // in kg
    height: number; // in cm
    birthDate: Date;
    gender: 'male' | 'female' | 'other';
}
