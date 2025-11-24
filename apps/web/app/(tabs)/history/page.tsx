"use client";

import { PageShell } from "@/components/layout/PageShell";
import { SessionSummaryCard } from "@/components/workouts/SessionSummaryCard";

// TODO: Replace with real API call to ${process.env.API_BASE_URL}/workouts?user=... with pagination
const mockHistorySessions = [
    {
        sessionId: "mock-session-1",
        title: "Snatch PR Attempt",
        dateLabel: "Yesterday · 16:00",
        exerciseSummary: "Heavy singles, hit new PR!",
        totalSets: 5,
        totalReps: 5,
        avgPeakVelocity: 2.15,
    },
    {
        sessionId: "mock-session-2",
        title: "Clean & Jerk Volume",
        dateLabel: "2 days ago · 15:30",
        exerciseSummary: "Volume work at 75%",
        totalSets: 4,
        totalReps: 12,
        avgPeakVelocity: 1.92,
    },
    {
        sessionId: "mock-session-3",
        title: "Snatch Technique",
        dateLabel: "3 days ago · 14:00",
        exerciseSummary: "Technique focus with lighter loads",
        totalSets: 6,
        totalReps: 18,
        avgPeakVelocity: 1.75,
    },
    {
        sessionId: "mock-session-4",
        title: "Clean Pulls",
        dateLabel: "5 days ago · 17:00",
        exerciseSummary: "Heavy pulls for strength",
        totalSets: 4,
        totalReps: 12,
        avgPeakVelocity: 2.05,
    },
];

export default function HistoryPage() {
    return (
        <PageShell title="History" subtitle="Your previous sessions">
            <div className="space-y-3">
                {mockHistorySessions.map((session) => (
                    <SessionSummaryCard
                        key={session.sessionId}
                        sessionId={session.sessionId}
                        title={session.title}
                        dateLabel={session.dateLabel}
                        exerciseSummary={session.exerciseSummary}
                        totalSets={session.totalSets}
                        totalReps={session.totalReps}
                        avgPeakVelocity={session.avgPeakVelocity}
                    />
                ))}
            </div>
        </PageShell>
    );
}
