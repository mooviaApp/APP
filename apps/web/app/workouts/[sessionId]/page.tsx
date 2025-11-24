import { PageShell } from "@/components/layout/PageShell";
import { MetricChip } from "@/components/workouts/MetricChip";
import { SetCard } from "@/components/workouts/SetCard";

interface SessionSummary {
    sessionId: string;
    title: string;
    dateLabel: string;
    totalSets: number;
    totalReps: number;
    avgPeakVelocity: number;
    sets: Array<{
        setId: string;
        label: string;
        reps: number;
        peakVelocity?: number;
        meanVelocity?: number;
    }>;
}

// TODO: Replace with real API call to ${process.env.API_BASE_URL}/workouts/${sessionId}
async function fetchSessionSummary(sessionId: string): Promise<SessionSummary> {
    // Mocked data for now
    return {
        sessionId,
        title: "Snatch Technique Session",
        dateLabel: "Today · 14:30",
        totalSets: 3,
        totalReps: 9,
        avgPeakVelocity: 1.85,
        sets: [
            {
                setId: "set-1",
                label: "Set 1 · Snatch 50 kg",
                reps: 3,
                peakVelocity: 1.92,
                meanVelocity: 1.65,
            },
            {
                setId: "set-2",
                label: "Set 2 · Snatch 55 kg",
                reps: 3,
                peakVelocity: 1.88,
                meanVelocity: 1.58,
            },
            {
                setId: "set-3",
                label: "Set 3 · Snatch 60 kg",
                reps: 3,
                peakVelocity: 1.75,
                meanVelocity: 1.52,
            },
        ],
    };
}

export default async function SessionPage({
    params,
}: {
    params: Promise<{ sessionId: string }>;
}) {
    const { sessionId } = await params;
    const session = await fetchSessionSummary(sessionId);

    return (
        <PageShell title={session.title} subtitle={session.dateLabel}>
            {/* Summary Card */}
            <div className="rounded-2xl bg-slate-900/70 border border-slate-800 p-4">
                <h3 className="font-bold text-sm text-slate-100 mb-3">Resumen</h3>
                <div className="flex flex-wrap gap-2">
                    <MetricChip label="Sets" value={session.totalSets.toString()} />
                    <MetricChip label="Reps" value={session.totalReps.toString()} />
                    <MetricChip
                        label="Avg Peak"
                        value={`${session.avgPeakVelocity.toFixed(2)} m/s`}
                        tone="positive"
                    />
                </div>
            </div>

            {/* Sets List */}
            <div className="space-y-3">
                <h2 className="text-sm font-semibold text-slate-300 px-1">Sets</h2>
                {session.sets.map((set) => (
                    <SetCard
                        key={set.setId}
                        sessionId={sessionId}
                        setId={set.setId}
                        label={set.label}
                        reps={set.reps}
                        peakVelocity={set.peakVelocity}
                        meanVelocity={set.meanVelocity}
                    />
                ))}
            </div>
        </PageShell>
    );
}
