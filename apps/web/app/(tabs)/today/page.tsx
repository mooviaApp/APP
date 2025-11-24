"use client";

import { PageShell } from "@/components/layout/PageShell";
import { SessionSummaryCard } from "@/components/workouts/SessionSummaryCard";
import { SetCard } from "@/components/workouts/SetCard";

// TODO: Replace with real API call to ${process.env.API_BASE_URL}/workouts/today or /workouts?status=active
const mockTodaySession = {
    sessionId: "mock-session-today",
    title: "Snatch Technique",
    dateLabel: "Today · 14:30",
    exerciseSummary: "Working on technique with lighter weights",
    totalSets: 3,
    totalReps: 9,
    avgPeakVelocity: 1.85,
    sets: [
        {
            setId: "mock-set-1",
            label: "Set 1 · Snatch 50 kg",
            reps: 3,
            peakVelocity: 1.92,
            meanVelocity: 1.65,
        },
        {
            setId: "mock-set-2",
            label: "Set 2 · Snatch 55 kg",
            reps: 3,
            peakVelocity: 1.88,
            meanVelocity: 1.58,
        },
        {
            setId: "mock-set-3",
            label: "Set 3 · Snatch 60 kg",
            reps: 3,
            peakVelocity: 1.75,
            meanVelocity: 1.52,
        },
    ],
};

export default function TodayPage() {
    return (
        <PageShell title="Today" subtitle="Your current workout session">
            {/* Current Session Summary */}
            <SessionSummaryCard
                sessionId={mockTodaySession.sessionId}
                title={mockTodaySession.title}
                dateLabel={mockTodaySession.dateLabel}
                exerciseSummary={mockTodaySession.exerciseSummary}
                totalSets={mockTodaySession.totalSets}
                totalReps={mockTodaySession.totalReps}
                avgPeakVelocity={mockTodaySession.avgPeakVelocity}
            />

            {/* Sets List */}
            <div className="space-y-3">
                <h2 className="text-sm font-semibold text-slate-300 px-1">Sets</h2>
                {mockTodaySession.sets.map((set) => (
                    <SetCard
                        key={set.setId}
                        sessionId={mockTodaySession.sessionId}
                        setId={set.setId}
                        label={set.label}
                        reps={set.reps}
                        peakVelocity={set.peakVelocity}
                        meanVelocity={set.meanVelocity}
                    />
                ))}
            </div>

            {/* Floating Add Button */}
            <button
                className="fixed bottom-20 right-6 w-14 h-14 rounded-full bg-[#1DF09F] text-[#05060A] font-bold text-2xl shadow-lg shadow-[#1DF09F]/20 hover:bg-[#1DF09F]/90 transition-colors flex items-center justify-center"
                aria-label="Add new set"
            >
                +
            </button>
        </PageShell>
    );
}
