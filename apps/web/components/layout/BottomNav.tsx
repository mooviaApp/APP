"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

export function BottomNav() {
    const pathname = usePathname();

    const tabs = [
        { href: "/today", label: "Today", icon: "🏋️" },
        { href: "/history", label: "History", icon: "📊" },
        { href: "/device", label: "Device", icon: "📡" },
    ];

    return (
        <nav className="h-14 border-t border-slate-800 bg-[#05060A]/90 backdrop-blur-sm">
            <div className="flex h-full">
                {tabs.map((tab) => {
                    const isActive = pathname === tab.href || pathname?.startsWith(tab.href + "/");

                    return (
                        <Link
                            key={tab.href}
                            href={tab.href}
                            className={`flex-1 flex flex-col items-center justify-center text-[11px] font-medium transition-colors ${isActive ? "text-[#1DF09F]" : "text-slate-400 hover:text-slate-300"
                                }`}
                        >
                            <span className="text-base mb-0.5">{tab.icon}</span>
                            <span>{tab.label}</span>
                        </Link>
                    );
                })}
            </div>
        </nav>
    );
}
