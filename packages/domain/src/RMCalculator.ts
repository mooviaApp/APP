export class RMCalculator {
    /**
     * Calculates 1RM using the Epley formula.
     * 1RM = weight * (1 + reps / 30)
     */
    static calculateEpley(weight: number, reps: number): number {
        if (reps === 1) return weight;
        return Math.round(weight * (1 + reps / 30));
    }

    /**
     * Calculates 1RM using the Brzycki formula.
     * 1RM = weight * (36 / (37 - reps))
     */
    static calculateBrzycki(weight: number, reps: number): number {
        if (reps === 1) return weight;
        return Math.round(weight * (36 / (37 - reps)));
    }
}
