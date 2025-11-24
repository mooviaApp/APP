import { PageShell } from "@/components/layout/PageShell";
import { SetMetricsView } from "@/components/workouts/SetMetricsView";

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

// TODO: Replace with real API call to ${process.env.API_BASE_URL}/workouts/${sessionId}/sets/${setId}/metrics
async function fetchSetMetrics(
    sessionId: string,
    setId: string
): Promise<SetMetrics> {
    // Mocked data for now
    return {
        status: "ok",
        sessionId,
        setId,
        sampleCount: 450,
        durationSec: 4.5,
        repCount: 3,
        reps: [
            {
                index: 1,
                startTimestamp: "2025-11-23T17:00:00.100Z",
                endTimestamp: "2025-11-23T17:00:01.200Z",
                durationSec: 1.1,
                peakVelocity: 2.3,
                meanVelocity: 1.2,
            },
            {
                index: 2,
                startTimestamp: "2025-11-23T17:00:02.000Z",
                endTimestamp: "2025-11-23T17:00:03.100Z",
                durationSec: 1.1,
                peakVelocity: 2.1,
                meanVelocity: 1.15,
            },
            {
                index: 3,
                startTimestamp: "2025-11-23T17:00:04.000Z",
                endTimestamp: "2025-11-23T17:00:05.200Z",
                durationSec: 1.2,
                peakVelocity: 1.95,
                meanVelocity: 1.08,
            },
        ],
    };
}

export default async function SetDetailPage({
    params,
}: {
    params: Promise<{ sessionId: string; setId: string }>;
}) {
    const { sessionId, setId } = await params;
    const metrics = await fetchSetMetrics(sessionId, setId);

    // Shorten IDs for display
    const shortSessionId = sessionId.slice(0, 8);
    const shortSetId = setId.slice(0, 8);

    return (
        <PageShell
            title={`Set ${shortSetId}`}
            subtitle={`Session ${shortSessionId}`}
        >
            <SetMetricsView metrics={metrics} />
        </PageShell>
    );
}
