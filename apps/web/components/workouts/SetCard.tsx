import Link from "next/link";
import { MetricChip } from "./MetricChip";

interface SetCardProps {
    sessionId: string;
    setId: string;
    label: string;
    reps: number;
    peakVelocity?: number;
    meanVelocity?: number;
}

export function SetCard({
    sessionId,
    setId,
    label,
    reps,
    peakVelocity,
    meanVelocity,
}: SetCardProps) {
    return (
        <Link
            href={`/workouts/${sessionId}/sets/${setId}`}
            className="block rounded-2xl bg-slate-900/70 border border-slate-800 p-4 transition-colors hover:border-[#227DA3]"
        >
            <div className="flex items-center justify-between gap-4">
                {/* Left Side */}
                <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-sm text-slate-100 truncate">{label}</h4>
                    <p className="text-xs text-slate-400 mt-0.5">Reps: {reps}</p>
                </div>

                {/* Right Side - Metrics */}
                <div className="flex flex-col gap-1.5 items-end">
                    {peakVelocity !== undefined && (
                        <MetricChip
                            label="Peak"
                            value={`${peakVelocity.toFixed(2)} m/s`}
                            tone="positive"
                        />
                    )}
                    {meanVelocity !== undefined && (
                        <MetricChip
                            label="Mean"
                            value={`${meanVelocity.toFixed(2)} m/s`}
                        />
                    )}
                </div>
            </div>
        </Link>
    );
}
