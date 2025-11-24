import Link from "next/link";
import { MetricChip } from "./MetricChip";

interface SessionSummaryCardProps {
    sessionId: string;
    title: string;
    dateLabel: string;
    exerciseSummary: string;
    totalSets: number;
    totalReps: number;
    avgPeakVelocity?: number;
}

export function SessionSummaryCard({
    sessionId,
    title,
    dateLabel,
    exerciseSummary,
    totalSets,
    totalReps,
    avgPeakVelocity,
}: SessionSummaryCardProps) {
    return (
        <Link
            href={`/workouts/${sessionId}`}
            className="block rounded-2xl bg-slate-900/70 border border-slate-800 p-4 transition-colors hover:border-[#1DF09F]"
        >
            <div className="flex items-start justify-between gap-4">
                {/* Left Side */}
                <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-base text-slate-100 truncate">{title}</h3>
                    <p className="text-xs text-slate-400 mt-0.5">{dateLabel}</p>
                    <p className="text-sm text-slate-300 mt-1">{exerciseSummary}</p>
                </div>

                {/* Right Side - Metrics */}
                <div className="flex flex-col gap-1.5 items-end">
                    <MetricChip label="Sets" value={totalSets.toString()} />
                    <MetricChip label="Reps" value={totalReps.toString()} />
                    {avgPeakVelocity !== undefined && (
                        <MetricChip
                            label="Avg Peak"
                            value={`${avgPeakVelocity.toFixed(2)} m/s`}
                            tone="positive"
                        />
                    )}
                </div>
            </div>
        </Link>
    );
}
