import { BottomNav } from "./BottomNav";

interface PageShellProps {
    title: string;
    subtitle?: string;
    children: React.ReactNode;
}

export function PageShell({ title, subtitle, children }: PageShellProps) {
    return (
        <div className="flex flex-col min-h-screen">
            {/* Fixed Header */}
            <header className="sticky top-0 z-10 bg-[#05060A]/90 backdrop-blur-sm border-b border-slate-800 px-4 py-3">
                <h1 className="text-lg font-bold text-slate-100">{title}</h1>
                {subtitle && (
                    <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>
                )}
            </header>

            {/* Main Content */}
            <main className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                {children}
            </main>

            {/* Bottom Navigation */}
            <BottomNav />
        </div>
    );
}
