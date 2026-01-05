/**
 * React Hook for BLE Functionality
 * 
 * Provides a convenient interface for using the BLE service in React components.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { PermissionsAndroid, Platform, Alert } from 'react-native';
import { Device } from 'react-native-ble-plx';
// type Device = any; // Mock type for Device since library is removed
import { getBLEService, BLEEvent } from '../services/ble/BLEService';
import { IMUSample, LogMessage, WHOAMIResponse, SENSOR_CONFIG } from '../services/ble/constants';
import { trajectoryService } from '../services/math/TrajectoryService';

// ============================================================================
// Types
// ============================================================================

export interface UseBLEResult {
    // State
    isScanning: boolean;
    isConnected: boolean;
    devices: Device[];
    currentDevice: Device | null;
    sensorData: IMUSample | null;
    logs: LogMessage[];
    whoAmI: WHOAMIResponse | null;
    error: string | null;

    // Actions
    startScan: () => Promise<void>;
    stopScan: () => void;
    connect: (deviceId: string) => Promise<void>;
    disconnect: () => Promise<void>;
    sendWhoAmI: () => Promise<void>;
    startStreaming: () => Promise<void>;
    stopStreaming: () => Promise<void>;
    resetIMU: () => Promise<void>;
    calibrateSensor: () => Promise<void>;
    clearError: () => void;
}

// ============================================================================
// Permission Handling
// ============================================================================

async function requestBluetoothPermissions(): Promise<boolean> {
    if (Platform.OS === 'android') {
        if (Platform.Version >= 31) {
            // Android 12+
            const granted = await PermissionsAndroid.requestMultiple([
                PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
                PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
                PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
            ]);

            return (
                granted['android.permission.BLUETOOTH_SCAN'] === PermissionsAndroid.RESULTS.GRANTED &&
                granted['android.permission.BLUETOOTH_CONNECT'] === PermissionsAndroid.RESULTS.GRANTED &&
                granted['android.permission.ACCESS_FINE_LOCATION'] === PermissionsAndroid.RESULTS.GRANTED
            );
        } else {
            // Android 11 and below
            const granted = await PermissionsAndroid.request(
                PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
            );

            return granted === PermissionsAndroid.RESULTS.GRANTED;
        }
    }

    // iOS permissions are handled via Info.plist
    return true;
}

// ============================================================================
// Hook
// ============================================================================

export function useBLE(): UseBLEResult {
    const bleService = useRef(getBLEService()).current;

    // State
    const [isScanning, setIsScanning] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [devices, setDevices] = useState<Device[]>([]);
    const [currentDevice, setCurrentDevice] = useState<Device | null>(null);
    const [sensorData, setSensorData] = useState<IMUSample | null>(null);
    const [logs, setLogs] = useState<LogMessage[]>([]);
    const [whoAmI, setWhoAmI] = useState<WHOAMIResponse | null>(null);
    const [error, setError] = useState<string | null>(null);



    // ==========================================================================
    // Event Handling
    // ==========================================================================

    useEffect(() => {
        const handleEvent = (event: BLEEvent) => {
            switch (event.type) {
                case 'stateChange':
                    console.log('BLE state changed:', event.data.state);
                    break;

                case 'deviceFound':
                    setDevices(prev => {
                        const exists = prev.some(d => d.id === event.data.device.id);
                        if (exists) return prev;
                        return [...prev, event.data.device];
                    });
                    break;

                case 'connected':
                    setIsConnected(true);
                    setCurrentDevice(event.data.device);
                    setError(null);
                    break;

                case 'disconnected':
                    setIsConnected(false);
                    setCurrentDevice(null);
                    setSensorData(null);
                    setSensorData(null);
                    break;

                case 'dataReceived':
                    setSensorData(event.data.sample);
                    break;

                case 'logReceived':
                    setLogs(prev => [...prev, event.data].slice(-50)); // Keep last 50 logs
                    break;

                case 'whoAmIReceived':
                    setWhoAmI(event.data);

                    if (!event.data.isValid) {
                        Alert.alert(
                            'Sensor Warning',
                            `WHO_AM_I returned 0x${event.data.value.toString(16)} (expected 0x${SENSOR_CONFIG.EXPECTED_WHO_AM_I.toString(16)}). Sensor may not be properly connected.`
                        );
                    } else {
                        Alert.alert(
                            'Sensor Verified',
                            `ICM-42688-P detected successfully (WHO_AM_I: 0x${event.data.value.toString(16)})`
                        );
                    }
                    break;

                case 'error':
                    setError(event.data.message);
                    break;
            }
        };

        const unsubscribe = bleService.addListener(handleEvent);

        return () => {
            unsubscribe();
        };
    }, [bleService]);

    // ==========================================================================
    // Initialization
    // ==========================================================================

    useEffect(() => {
        bleService.initialize();

        return () => {
            bleService.destroy();
        };
    }, [bleService]);

    // ==========================================================================
    // Actions
    // ==========================================================================

    const startScan = useCallback(async () => {
        try {
            const hasPermission = await requestBluetoothPermissions();

            if (!hasPermission) {
                setError('Bluetooth permissions not granted');
                Alert.alert(
                    'Permissions Required',
                    'Please grant Bluetooth and Location permissions to scan for devices.'
                );
                return;
            }

            setDevices([]);
            setError(null);
            setIsScanning(true);

            await bleService.startScan();

            // Auto-stop after scan timeout
            setTimeout(() => {
                setIsScanning(false);
            }, 10000);

        } catch (err: any) {
            setError(err.message);
            setIsScanning(false);
        }
    }, [bleService]);

    const stopScan = useCallback(() => {
        bleService.stopScan();
        setIsScanning(false);
    }, [bleService]);

    const connect = useCallback(async (deviceId: string) => {
        try {
            setError(null);
            await bleService.connect(deviceId);
        } catch (err: any) {
            setError(err.message);
        }
    }, [bleService]);

    const disconnect = useCallback(async () => {
        try {
            await bleService.disconnect();
        } catch (err: any) {
            setError(err.message);
        }
    }, [bleService]);

    const sendWhoAmI = useCallback(async () => {
        try {
            setError(null);
            await bleService.requestWhoAmI();
        } catch (err: any) {
            setError(err.message);
        }
    }, [bleService]);

    const startStreaming = useCallback(async () => {
        try {
            setError(null);

            console.log('[STREAM] ========================================');
            console.log('[STREAM] Starting Auto-Calibration Sequence');
            console.log('[STREAM] ========================================');

            // Step 1: Hardware Reset to ensure clean sensor state
            console.log('[STREAM] Step 1/5: Hardware & Software Reset...');
            trajectoryService.reset(); // Clear all previous state
            await bleService.sendCommand(0x04); // RESET command
            await new Promise(r => setTimeout(r, 800)); // Wait for sensor to reboot
            console.log('[STREAM] ✅ Sensor rebooted');

            // Step 2: Start Streaming
            console.log('[STREAM] Step 2/5: Enabling data stream...');
            await bleService.startStreaming();
            await new Promise(r => setTimeout(r, 200)); // Wait for notifications
            console.log('[STREAM] ✅ Stream active');

            // Step 3: Wait for initial data packets
            console.log('[STREAM] Step 3/5: Waiting for sensor data...');
            let samplesReceived = 0;
            const maxWaitTime = 3000; // 3 seconds max
            const startTime = Date.now();

            while (samplesReceived < 20 && (Date.now() - startTime) < maxWaitTime) {
                await new Promise(r => setTimeout(r, 50));
                samplesReceived = bleService.getAndClearBuffer().length;
            }

            if (samplesReceived < 20) {
                console.warn(`[STREAM] ⚠️  Only ${samplesReceived} samples received, proceeding anyway...`);
            } else {
                console.log(`[STREAM] ✅ Received ${samplesReceived} samples`);
            }

            // Step 4: Calibrate Sensor
            console.log('[STREAM] Step 4/5: Calibrating sensor biases...');
            try {
                await trajectoryService.calibrateAsync();
                console.log('[STREAM] ✅ Calibration complete');
            } catch (calibErr: any) {
                console.error('[STREAM] ❌ Calibration failed:', calibErr.message);
                // Continue streaming even if calibration fails
            }



            console.log('[STREAM] ========================================');
            console.log('[STREAM] ✅ Auto-Calibration Complete');
            console.log('[STREAM] System ready for tracking');
            console.log('[STREAM] ========================================');

        } catch (err: any) {
            console.error('[STREAM] ❌ Stream start failed:', err.message);
            setError(err.message);
        }
    }, [bleService]);

    const stopStreaming = useCallback(async () => {
        try {
            setError(null);
            await bleService.stopStreaming();



            // Apply post-processing corrections to captured raw data
            console.log('[STREAM] Applying post-processing corrections to captured data...');
            try {
                trajectoryService.applyPostProcessingCorrections();
                console.log('[STREAM] ✅ Post-processing complete - corrected trajectory ready');
            } catch (postErr: any) {
                console.error('[STREAM] ❌ Post-processing failed:', postErr.message);
                // Don't fail the stop operation if post-processing fails
            }
        } catch (err: any) {
            setError(err.message);
        }
    }, [bleService]);

    const resetIMU = useCallback(async () => {
        try {
            setError(null);
            await bleService.resetIMU();
            // Also reset software trajectory state
            trajectoryService.reset();
            Alert.alert('IMU Reset', 'Sensor hardware and software trajectory have been reset.');
        } catch (err: any) {
            setError(err.message);
        }
    }, [bleService]);

    const calibrateSensor = useCallback(async () => {
        try {
            setError(null);
            console.log('[CALIBRATE] Step 1: Requesting IMU Hardware Reset...');
            await bleService.resetIMU();

            // Wait for hardware to reboot and stabilize
            await new Promise(r => setTimeout(r, 800));

            console.log('[CALIBRATE] Step 2: Starting stream for calibration data...');
            await bleService.startStreaming();

            // Allow a small window for the first packets to arrive
            await new Promise(r => setTimeout(r, 200));

            console.log('[CALIBRATE] Step 3: Starting Software Bias Calculation (2s)...');
            await trajectoryService.calibrateAsync(2000);

            Alert.alert('Calibration Complete', 'Sensor bias calculated and orientation reset.');
        } catch (err: any) {
            setError(err.message);
            console.error('[CALIBRATE] Error during calibration:', err);
        }
    }, [bleService]);

    const clearError = useCallback(() => {
        setError(null);
    }, []);

    // ==========================================================================
    // Return
    // ==========================================================================

    return {
        // State
        isScanning,
        isConnected,
        devices,
        currentDevice,
        sensorData,
        logs,
        whoAmI,
        error,

        // Actions
        startScan,
        stopScan,
        connect,
        disconnect,
        sendWhoAmI,
        startStreaming,
        stopStreaming,
        resetIMU,
        calibrateSensor,
        clearError,
    };
}
