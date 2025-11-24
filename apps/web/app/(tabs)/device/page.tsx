"use client";

import { PageShell } from "@/components/layout/PageShell";
import { MetricChip } from "@/components/workouts/MetricChip";

// TODO: Replace with real API call to ${process.env.API_BASE_URL}/device or /user/devices
const mockDeviceData = {
    isConnected: true,
    deviceName: "moovia-device-001",
    lastSignal: "2 minutes ago",
    battery: 87,
};

export default function DevicePage() {
    return (
        <PageShell title="Device" subtitle="MOOVIA sensor status">
            {/* Connection Status Card */}
            <div className="rounded-2xl bg-slate-900/70 border border-slate-800 p-4">
                <h3 className="font-bold text-sm text-slate-100 mb-3">Connection Status</h3>
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-400">Status</span>
                        <MetricChip
                            label="Device"
                            value={mockDeviceData.isConnected ? "Connected" : "Disconnected"}
                            tone={mockDeviceData.isConnected ? "positive" : "warning"}
                        />
                    </div>

                    <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-400">Device Name</span>
                        <span className="text-xs font-medium text-slate-100">
                            {mockDeviceData.deviceName}
                        </span>
                    </div>

                    <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-400">Last Signal</span>
                        <span className="text-xs font-medium text-slate-100">
                            {mockDeviceData.lastSignal}
                        </span>
                    </div>

                    <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-400">Battery</span>
                        <div className="flex items-center gap-2">
                            <div className="w-12 h-2 bg-slate-700 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-[#1DF09F] transition-all"
                                    style={{ width: `${mockDeviceData.battery}%` }}
                                />
                            </div>
                            <span className="text-xs font-medium text-slate-100">
                                {mockDeviceData.battery}%
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Link New Device Card */}
            <div className="rounded-2xl bg-slate-900/70 border border-slate-800 p-4">
                <h3 className="font-bold text-sm text-slate-100 mb-2">Link a New Device</h3>
                <p className="text-xs text-slate-400 mb-3">
                    Connect a new MOOVIA sensor to start tracking your lifts. Make sure Bluetooth is enabled on your device.
                </p>
                <button className="w-full px-4 py-2 rounded-lg bg-[#227DA3] text-white text-sm font-medium hover:bg-[#227DA3]/90 transition-colors">
                    Scan for Devices
                </button>
            </div>

            {/* Device Info Card */}
            <div className="rounded-2xl bg-slate-900/70 border border-slate-800 p-4">
                <h3 className="font-bold text-sm text-slate-100 mb-2">About MOOVIA Sensor</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                    The MOOVIA sensor uses advanced IMU technology to track barbell velocity in real-time.
                    It measures acceleration and rotation to provide accurate metrics for velocity-based training.
                </p>
            </div>
        </PageShell>
    );
}
