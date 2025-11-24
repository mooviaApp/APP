import { MetricChip } from "./MetricChip";

interface RepMetric {
    index: number;
    startTimestamp: string;
    endTimestamp: string;
    durationSec: number;
    peakVelocity: number;
    meanVelocity: number;
}

interface SetMetrics {
    status: string;
    sessionId: string;
    setId: string;
    sampleCount: number;
    durationSec: number;
    repCount: number;
    reps: RepMetric[];
}

interface SetMetricsViewProps {
    metrics: SetMetrics;
}

export function SetMetricsView({ metrics }: SetMetricsViewProps) {
    // Find best rep by peak velocity
    const bestRep = metrics.reps.length > 0
        ? metrics.reps.reduce((best, current) =>
            current.peakVelocity > best.peakVelocity ? current : best
        )
        : null;

    return (
        <div className="space-y-4">
            {/* Summary Card */}
            <div className="rounded-2xl bg-slate-900/70 border border-slate-800 p-4">
                <h3 className="font-bold text-sm text-slate-100 mb-3">Resumen del set</h3>
                <div className="flex flex-wrap gap-2">
                    <MetricChip label="Reps" value={metrics.repCount.toString()} />
                    <MetricChip
                        label="Duración"
                        value={`${metrics.durationSec.toFixed(1)}s`}
                    />
                    <MetricChip label="Samples" value={metrics.sampleCount.toString()} />
                    {bestRep && (
                        <MetricChip
                            label="Mejor rep"
                            value={`${bestRep.peakVelocity.toFixed(2)} m/s`}
                            tone="positive"
                        />
                    )}
                </div>
            </div>

            {/* Reps Card */}
            <div className="rounded-2xl bg-slate-900/70 border border-slate-800 p-4">
                <h3 className="font-bold text-sm text-slate-100 mb-3">Repeticiones</h3>

                {metrics.reps.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-4">
                        No se han detectado repeticiones en este set.
                    </p>
                ) : (
                    <div className="space-y-2">
                        {metrics.reps.map((rep) => (
                            <div
                                key={rep.index}
                                className="flex items-center justify-between p-2 rounded-lg bg-slate-800/50 border border-slate-700/50"
                            >
                                <div className="flex-1">
                                    <span className="text-xs font-semibold text-slate-100">
                                        Rep {rep.index}
                                    </span>
                                    <span className="text-xs text-slate-400 ml-2">
                                        {rep.durationSec.toFixed(2)}s
                                    </span>
                                </div>
                                <div className="flex gap-2">
                                    <MetricChip
                                        label="Peak"
                                        value={`${rep.peakVelocity.toFixed(2)}`}
                                        tone={rep === bestRep ? "positive" : "default"}
                                    />
                                    <MetricChip
                                        label="Mean"
                                        value={`${rep.meanVelocity.toFixed(2)}`}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
