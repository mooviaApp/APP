/**
 * BLE Service for MOOVIA IMU Sensor
 * 
 * Manages Bluetooth Low Energy communication with the WBZ351 microcontroller
 * and ICM-42688-P inertial sensor.
 */

import { BleManager, Device, Characteristic, State } from 'react-native-ble-plx';
import {
    BLE_SERVICE_UUID,
    BLE_CHARACTERISTICS,
    BLE_COMMANDS,
    BLE_CONFIG,
    SENSOR_CONFIG,
    MESSAGE_TYPES,
    IMUSample,
    LogMessage,
    WHOAMIResponse,
    RawPacketRecord,
    RawSessionExport,
} from './constants';
import {
    decodeNotification,
    encodeCommand,
    decodeBase64ToBytes,
    resetIMUTimestampContinuity,
} from './dataDecoder';
import { trajectoryService } from '../math/TrajectoryService';

// ============================================================================
// Event Types
// ============================================================================

export type BLEEventType =
    | 'stateChange'
    | 'deviceFound'
    | 'connected'
    | 'disconnected'
    | 'dataReceived'
    | 'logReceived'
    | 'whoAmIReceived'
    | 'error';

export interface BLEEvent {
    type: BLEEventType;
    data?: any;
}

type BLEEventListener = (event: BLEEvent) => void;

// ============================================================================
// BLE Service Class
// ============================================================================

export class BLEService {
    private manager: BleManager;
    private device: Device | null = null;
    private listeners: BLEEventListener[] = [];
    private isScanning = false;
    private reconnectAttempts = 0;
    private sampleBuffer: IMUSample[] = [];
    private readonly MAX_BUFFER_SAMPLES = SENSOR_CONFIG.BATCH_SIZE_SAMPLES * 10;
    // Buffer is solo para el warmup inicial; después se desactiva para evitar crecimiento
    private bufferingEnabled = false;
    // Raw capture buffers (for export only, no processing)
    private rawPackets: RawPacketRecord[] = [];
    private rawSamples: IMUSample[] = [];
    private sessionStartMs: number | null = null;
    private packetIndex: number = 0;

    constructor() {
        this.manager = new BleManager();
        this.setupStateListener();
    }

    // ==========================================================================
    // Lifecycle
    // ==========================================================================

    /**
     * Initialize the BLE manager and check Bluetooth state
     */
    async initialize(): Promise<void> {
        const state = await this.manager.state();

        if (state !== State.PoweredOn) {
            this.emit({
                type: 'error',
                data: { message: 'Bluetooth is not powered on' },
            });
        }
    }

    /**
     * Clean up resources
     */
    destroy(): void {
        this.stopScan();
        this.disconnect();
        this.manager.destroy();
    }

    // ==========================================================================
    // Event Handling
    // ==========================================================================

    /**
     * Add event listener
     */
    addListener(listener: BLEEventListener): () => void {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    /**
     * Emit event to all listeners
     */
    private emit(event: BLEEvent): void {
        this.listeners.forEach(listener => listener(event));
    }

    /**
     * Setup Bluetooth state change listener
     */
    private setupStateListener(): void {
        this.manager.onStateChange((state) => {
            this.emit({ type: 'stateChange', data: { state } });

            if (state === State.PoweredOff) {
                this.disconnect();
            }
        }, true);
    }

    // ==========================================================================
    // Scanning
    // ==========================================================================

    /**
     * Start scanning for MOOVIA devices
     */
    async startScan(): Promise<void> {
        if (this.isScanning) {
            console.warn('Already scanning');
            return;
        }

        this.isScanning = true;

        try {
            // Stop any previous scan
            await this.manager.stopDeviceScan();

            // Start new scan (Relaxed filter to ensure we find it, regardless of advertised UUID format)
            this.manager.startDeviceScan(
                null,
                { allowDuplicates: false },
                (error, device) => {
                    if (error) {
                        console.error('Scan error:', error);
                        this.emit({ type: 'error', data: { message: error.message } });
                        this.isScanning = false;
                        return;
                    }

                    if (device) {
                        // Debug log for every device found (temporary)
                        // console.log(`Scanned: ${device.name} (${device.id}) - UUIDs: ${device.serviceUUIDs}`);

                        if (device.name === SENSOR_CONFIG.DEVICE_NAME) {
                            console.log(`FOUND MOOVIA! ID: ${device.id}`);
                            console.log(`Advertised Service UUIDs: ${JSON.stringify(device.serviceUUIDs)}`);

                            this.emit({
                                type: 'deviceFound',
                                data: { device },
                            });
                        }
                    }
                }
            );

            // Auto-stop after timeout
            setTimeout(() => {
                if (this.isScanning) {
                    this.stopScan();
                }
            }, BLE_CONFIG.SCAN_TIMEOUT_MS);

        } catch (error: any) {
            console.error('Failed to start scan:', error);
            this.isScanning = false;
            this.emit({ type: 'error', data: { message: error.message } });
        }
    }

    /**
     * Stop scanning
     */
    stopScan(): void {
        if (!this.isScanning) return;

        this.manager.stopDeviceScan();
        this.isScanning = false;
    }

    // ==========================================================================
    // Connection
    // ==========================================================================

    /**
     * Connect to a device
     */
    async connect(deviceId: string): Promise<void> {
        try {
            this.stopScan();

            console.log(`Connecting to device: ${deviceId}`);

            // 1. Connect
            const device = await this.manager.connectToDevice(deviceId, {
                timeout: BLE_CONFIG.CONNECTION_TIMEOUT_MS,
            });

            this.device = device;

            // Setup disconnection handler
            device.onDisconnected((error, disconnectedDevice) => {
                console.log('Device disconnected:', disconnectedDevice?.id);
                this.handleDisconnection(error);
            });

            // 2. Discover services and characteristics
            console.log('Discovering services...');
            await device.discoverAllServicesAndCharacteristics();
            const services = await device.services();
            console.log('Services discovered:', services.map(s => s.uuid));

            // 3. Enable notifications (Samples & Logs) BEFORE MTU/Start
            await this.enableNotifications();

            // 4. Request MTU (CRITICAL for large packets)
            console.log(`[BLE] Requesting MTU: ${BLE_CONFIG.REQUIRED_MTU}`);
            let negotiatedMTU = 23; // Default MTU if negotiation fails

            try {
                const updatedDevice = await device.requestMTU(BLE_CONFIG.REQUIRED_MTU);
                negotiatedMTU = updatedDevice.mtu || BLE_CONFIG.REQUIRED_MTU;

                // CRITICAL: Wait for MTU to be applied by firmware
                await new Promise(r => setTimeout(r, 100));

                console.log(`[BLE] ✅ MTU negotiated: ${negotiatedMTU} bytes`);

                const maxNotifPayload = negotiatedMTU - 3; // ATT notification overhead
                if (SENSOR_CONFIG.PACKET_SIZE_BYTES > maxNotifPayload) {
                    const errorMsg =
                        `CRITICAL: MTU ${negotiatedMTU} too small. ` +
                        `Max notif payload is ${maxNotifPayload}, need ${SENSOR_CONFIG.PACKET_SIZE_BYTES}.`;
                    console.error(`[BLE] ${errorMsg}`);
                    throw new Error(errorMsg);
                }
            } catch (error: any) {
                console.error('[BLE] MTU negotiation FAILED:', error.message);
                throw new Error(`MTU negotiation failed: ${error.message}`);
            }

            // 5. Request high connection priority for 1kHz streaming
            try {
                await device.requestConnectionPriority(2); // 2 = HIGH priority
                console.log('[BLE] ✅ Connection priority set to HIGH');
            } catch (error: any) {
                console.warn('[BLE] Connection priority request failed (non-critical):', error.message);
            }

            this.reconnectAttempts = 0;
            this.emit({ type: 'connected', data: { device } });

            console.log(`[BLE] ========================================`);
            console.log(`[BLE] ✅ CONNECTED AND CONFIGURED`);
            console.log(`[BLE] MTU: ${negotiatedMTU} bytes`);
            console.log(`[BLE] Packet Size: ${SENSOR_CONFIG.PACKET_SIZE_BYTES} bytes`);
            console.log(`[BLE] Ready for streaming`);
            console.log(`[BLE] ========================================`);

        } catch (error: any) {
            console.error('Connection failed:', error);
            this.device = null;
            this.emit({ type: 'error', data: { message: `Connection failed: ${error.message}` } });
            throw error;
        }
    }

    /**
     * Disconnect from device
     */
    async disconnect(): Promise<void> {
        if (!this.device) return;

        try {
            await this.manager.cancelDeviceConnection(this.device.id);
            this.device = null;
            this.emit({ type: 'disconnected' });
        } catch (error: any) {
            console.error('Disconnect error:', error);
        }
    }

    /**
     * Handle disconnection event
     */
    private handleDisconnection(error: any): void {
        this.device = null;
        this.emit({ type: 'disconnected', data: { error } });

        // Auto-reconnect if enabled
        if (BLE_CONFIG.AUTO_RECONNECT && this.reconnectAttempts < BLE_CONFIG.MAX_RECONNECT_ATTEMPTS) {
            this.reconnectAttempts++;
            console.log(`Attempting reconnection (${this.reconnectAttempts}/${BLE_CONFIG.MAX_RECONNECT_ATTEMPTS})...`);

            setTimeout(() => {
                this.startScan();
            }, 2000);
        }
    }

    /**
     * Check if connected
     */
    isConnected(): boolean {
        return this.device !== null;
    }

    // ==========================================================================
    // Notifications
    // ==========================================================================

    /**
     * Enable notifications on data and log characteristics
     */
    private async enableNotifications(): Promise<void> {
        if (!this.device) {
            throw new Error('No device connected');
        }

        try {
            // Enable notifications on Characteristic 0 (Data)
            await this.device.monitorCharacteristicForService(
                BLE_SERVICE_UUID,
                BLE_CHARACTERISTICS.DATA,
                (error, characteristic) => {
                    if (error) {
                        console.error('[BLE-DATA] Notification error:', error);
                        return;
                    }

                    if (characteristic?.value) {
                        // console.log('[BLE-DATA] ✅ Received packet!');
                        this.handleDataNotification(characteristic.value);
                    } else {
                        console.warn('[BLE-DATA] Received notification but no value');
                    }
                }
            );

            // Enable notifications on Characteristic 2 (Log)
            await this.device.monitorCharacteristicForService(
                BLE_SERVICE_UUID,
                BLE_CHARACTERISTICS.LOG,
                (error, characteristic) => {
                    if (error) {
                        console.error('Log notification error:', error);
                        return;
                    }

                    if (characteristic?.value) {
                        this.handleLogNotification(characteristic.value);
                    }
                }
            );

            // console.log('[BLE] ✅ Notifications enabled on DATA and LOG characteristics');
            // console.log('[BLE] Waiting for first packet...');

        } catch (error: any) {
            console.error('Failed to enable notifications:', error);
            throw error;
        }
    }

    /**
     * Handle data characteristic notification (IMU samples)
     * Now receives 15 samples per packet
     */
    private handleDataNotification(base64Data: string): void {
        try {
            const rawBytes = decodeBase64ToBytes(base64Data);
            const receivedAt = Date.now();

            // EXPLICIT LOGGING FOR FIRMWARE VERIFICATION (commented out for production)
            // const hexPreview = Array.from(rawBytes.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' ');
            // console.log(`[AI-LOG] t:${Date.now()} Len:${rawBytes.length} H:${rawBytes[0]?.toString(16).padStart(2, '0')} Bytes:[${hexPreview}...]`);

            if (rawBytes.length !== SENSOR_CONFIG.PACKET_SIZE_BYTES) {
                console.warn(`[AI-LOG] WARNING: Unexpected packet length: ${rawBytes.length} (Expected ${SENSOR_CONFIG.PACKET_SIZE_BYTES})`);
            }

            const decoded = decodeNotification(base64Data);

            if (decoded && Array.isArray(decoded)) {
                // It's an array of IMU samples (15 samples per packet)
                const samples = decoded as IMUSample[];
                // Capture raw packet + decoded samples for export (no processing)
                this.rawPackets.push({
                    base64: base64Data,
                    receivedAt,
                    length: rawBytes.length,
                    sampleCount: samples.length,
                    index: this.packetIndex++,
                });
                this.rawSamples.push(...samples);

                // Process samples for trajectory (All samples needed for integration)
                samples.forEach(sample => {
                    trajectoryService.processSample(sample);
                });

                // Buffer solo durante el warmup (para contar paquetes iniciales)
                if (this.bufferingEnabled) {
                    this.sampleBuffer.push(...samples);

                    // Prevent unbounded growth if warmup is not stopped by caller
                    if (this.sampleBuffer.length > this.MAX_BUFFER_SAMPLES) {
                        console.warn('[BLE] sampleBuffer overflow; stopping buffering to avoid growth.');
                        this.bufferingEnabled = false;
                        this.sampleBuffer = [];
                    }
                }

                // Emit only the last sample for real-time display
                if (samples.length > 0) {
                    this.emit({
                        type: 'dataReceived',
                        data: { sample: samples[samples.length - 1] },
                    });
                }
            } else {
                // Still log raw packet so export remains contiguous
                this.rawPackets.push({
                    base64: base64Data,
                    receivedAt,
                    length: rawBytes.length,
                    sampleCount: 0,
                    index: this.packetIndex++,
                });
            }
        } catch (error) {
            console.error('Error handling data notification:', error);
        }
    }

    /**
     * Handle log characteristic notification
     */
    private handleLogNotification(base64Data: string): void {
        try {
            const decoded = decodeNotification(base64Data);

            if (!decoded) return;

            if ('message' in decoded) {
                // It's a log message
                this.emit({
                    type: 'logReceived',
                    data: decoded as LogMessage,
                });
            } else if ('value' in decoded && 'isValid' in decoded) {
                // It's a WHO_AM_I response
                this.emit({
                    type: 'whoAmIReceived',
                    data: decoded as WHOAMIResponse,
                });
            }
        } catch (error) {
            console.error('Error handling log notification:', error);
        }
    }

    // ==========================================================================
    // Commands
    // ==========================================================================

    /**
     * Send a command to the device
     */
    async sendCommand(command: number): Promise<void> {
        if (!this.device) {
            throw new Error('No device connected');
        }

        try {
            const encodedCommand = encodeCommand(command);

            await this.device.writeCharacteristicWithoutResponseForService(
                BLE_SERVICE_UUID,
                BLE_CHARACTERISTICS.COMMAND,
                encodedCommand
            );

            console.log(`Sent command: 0x${command.toString(16)} to ${BLE_CHARACTERISTICS.COMMAND}`);

        } catch (error: any) {
            console.error('Failed to send command:', error);
            this.emit({ type: 'error', data: { message: `Command failed: ${error.message}` } });
            throw error;
        }
    }

    /**
     * Request WHO_AM_I value
     */
    async requestWhoAmI(): Promise<void> {
        await this.sendCommand(BLE_COMMANDS.WHO_AM_I);
    }

    /**
     * Start streaming data
     */
    async startStreaming(): Promise<void> {
        this.bufferingEnabled = true; // enable warm-up buffering
        this.sampleBuffer = []; // Clear buffer
        // Reset raw capture buffers
        this.rawPackets = [];
        this.rawSamples = [];
        this.sessionStartMs = Date.now();
        this.packetIndex = 0;
        // Reset timestamp continuity for a fresh streaming session
        resetIMUTimestampContinuity();
        // Clear any previous trajectory data
        trajectoryService.reset();
        // Enable realtime path updates
        trajectoryService.setRealtimeEnabled(true);
        await this.sendCommand(BLE_COMMANDS.STREAM_ON);
    }

    /**
     * Stop streaming data
     */
    async stopStreaming(): Promise<void> {
        this.bufferingEnabled = false;
        this.sampleBuffer = [];
        await this.sendCommand(BLE_COMMANDS.STREAM_OFF);
        trajectoryService.setRealtimeEnabled(false);
        trajectoryService.applyPostProcessingCorrections();
    }

    /**
     * Reset the IMU sensor
     */
    async resetIMU(): Promise<void> {
        this.bufferingEnabled = false;
        this.sampleBuffer = [];
        await this.sendCommand(BLE_COMMANDS.RESET_IMU);
    }

    // ==========================================================================
    // Data Access
    // ==========================================================================

    /**
     * Stop buffering samples to avoid growth once warmup is done.
     */
    stopBuffering() {
        this.bufferingEnabled = false;
        this.sampleBuffer = [];
    }

    /**
     * Build a raw-only session export (no processed trajectory).
     */
    getRawSessionExport(): RawSessionExport {
        const totalSamples = this.rawSamples.length;
        const totalPackets = this.rawPackets.length;
        let durationMs = 0;

        if (totalSamples > 1) {
            durationMs = this.rawSamples[totalSamples - 1].timestampMs - this.rawSamples[0].timestampMs;
        } else if (this.sessionStartMs) {
            durationMs = Date.now() - this.sessionStartMs;
        }

        const avgSampleRateHz = durationMs > 0 ? totalSamples / (durationMs / 1000) : 0;

        return {
            version: 'raw-1.0.0',
            exportedAt: new Date().toISOString(),
            sensorConfig: SENSOR_CONFIG,
            rawPackets: [...this.rawPackets],
            samples: [...this.rawSamples],
            metadata: {
                totalSamples,
                totalPackets,
                durationMs,
                avgSampleRateHz,
            },
        };
    }

    /**
     * Capture quality stats for UI/debug.
     */
    getCaptureStats() {
        const samples = this.rawSamples;
        const packets = this.rawPackets;
        if (!samples || samples.length < 2) {
            return {
                avgRateHz: 0,
                medianDtMs: 0,
                maxDtMs: 0,
                gapsPct: 0,
                maxGapMs: 0,
                totalPackets: packets?.length || 0,
                invalidPackets: 0,
                estimatedMissingSamples: 0,
                droppedPackets: 0,
            };
        }

        const sorted = [...samples].sort((a, b) => a.timestampMs - b.timestampMs);
        const dts: number[] = [];
        for (let i = 0; i < sorted.length - 1; i++) {
            dts.push(sorted[i + 1].timestampMs - sorted[i].timestampMs);
        }
        const durationMs = sorted[sorted.length - 1].timestampMs - sorted[0].timestampMs;
        const avgRateHz = durationMs > 0 ? sorted.length / (durationMs / 1000) : 0;
        const medianDtMs = this.median(dts);
        const maxDtMs = Math.max(...dts);
        const GAP_THRESHOLD_MS = 4;
        const gapsPct = dts.length > 0 ? (dts.filter(dt => dt > GAP_THRESHOLD_MS).length / dts.length) * 100 : 0;

        let maxGapMs = 0;
        let invalidPackets = 0;
        let droppedPackets = 0;
        if (packets && packets.length > 0) {
            let prev = packets[0];
            packets.forEach((p: any, idx: number) => {
                if (p.length && p.length !== SENSOR_CONFIG.PACKET_SIZE_BYTES) invalidPackets++;
                if (p.sampleCount === 0) droppedPackets++;
                if (idx > 0) {
                    const g = p.receivedAt - prev.receivedAt;
                    if (g > maxGapMs) maxGapMs = g;
                    prev = p;
                }
            });
        }
        const expectedSamples = durationMs > 0 ? Math.round((durationMs / 1000) * SENSOR_CONFIG.ODR_HZ) : 0;
        const estimatedMissingSamples = Math.max(0, expectedSamples - sorted.length);

        return {
            avgRateHz,
            medianDtMs,
            maxDtMs,
            gapsPct,
            maxGapMs: Math.max(maxGapMs, maxDtMs),
            totalPackets: packets?.length || 0,
            invalidPackets,
            estimatedMissingSamples,
            droppedPackets,
        };
    }

    private median(arr: number[]): number {
        if (!arr || arr.length === 0) return 0;
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    }

    /**
     * Get buffered samples and clear buffer
     */
    getAndClearBuffer(): IMUSample[] {
        const samples = [...this.sampleBuffer];
        this.sampleBuffer = [];
        return samples;
    }

    /**
     * Get current buffer size
     */
    getBufferSize(): number {
        return this.sampleBuffer.length;
    }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let bleServiceInstance: BLEService | null = null;

export function getBLEService(): BLEService {
    if (!bleServiceInstance) {
        bleServiceInstance = new BLEService();
    }
    return bleServiceInstance;
}
