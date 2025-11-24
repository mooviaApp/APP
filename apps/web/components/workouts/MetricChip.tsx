import { cn } from "@/lib/cn";

interface MetricChipProps {
    label: string;
    value: string;
    tone?: "default" | "positive" | "warning";
}

export function MetricChip({ label, value, tone = "default" }: MetricChipProps) {
    return (
        <div
            className={cn(
                "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium",
                tone === "default" && "bg-slate-800 text-slate-100",
                tone === "positive" && "bg-[#1DF09F]/10 text-[#1DF09F] border border-[#1DF09F]/40",
                tone === "warning" && "bg-[#F0DC1D]/10 text-[#F0DC1D] border border-[#F0DC1D]/40"
            )}
        >
            <span className="text-slate-400">{label}:</span>
            <span className="font-semibold">{value}</span>
        </div>
    );
}
