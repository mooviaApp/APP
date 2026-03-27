/**
 * BLE Service for MOOVIA IMU Sensor
 * 
 * Manages Bluetooth Low Energy communication with the WBZ351 microcontroller
 * and ICM-42688-P inertial sensor.
 */

import { BleManager, ConnectionPriority, Device, State, Subscription } from 'react-native-ble-plx';
import {
    BLE_SERVICE_UUID,
    BLE_SERVICE_UUID_ALIASES,
    BLE_CHARACTERISTICS,
    BLE_CHARACTERISTIC_UUID_ALIASES,
    BLE_COMMANDS,
    BLE_CONFIG,
    SENSOR_CONFIG,
    MESSAGE_TYPES,
    IMUSample,
    LogMessage,
    WHOAMIResponse,
    RawPacketRecord,
    RawSessionExport,
    SessionTransportState,
} from './constants';
import {
    DecodedImuPacket,
    decodeNotification,
    encodeCommand,
    decodeBase64ToBytes,
    resetIMUTimestampContinuity,
} from './dataDecoder';
import { trajectoryService } from '../math/TrajectoryService';
import { analyzeCaptureHealth, CaptureHealthStats } from '@moovia/sensor-core';

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

interface ResolvedGattProfile {
    serviceUuid: string;
    dataUuid: string;
    commandUuid: string;
    logUuid: string;
}

function createEmptySessionState(): SessionTransportState {
    return {
        deviceName: null,
        deviceAddress: null,
        connectedAt: null,
        disconnectedAt: null,
        mtuRequested: BLE_CONFIG.REQUIRED_MTU,
        mtuNegotiated: 23,
        phyRequested: null,
        phyActualTx: null,
        phyActualRx: null,
        connectionPriorityRequested: null,
        packetsReceived: 0,
        samplesReceived: 0,
        missingPackets: 0,
        missingSamples: 0,
        duplicatePackets: 0,
        reorderedPackets: 0,
        whoAmI: null,
        firmwareSummaryLine: null,
        disconnectReasonFromFirmware: null,
    };
}

// ============================================================================
// BLE Service Class
// ============================================================================

export class BLEService {
    private manager: BleManager;
    private device: Device | null = null;
    private negotiatedMtu: number = 23;
    private sampleSubscription: Subscription | null = null;
    private logSubscription: Subscription | null = null;
    private listeners: BLEEventListener[] = [];
    private isScanning = false;
    private isConfigured = false;
    private isStreaming = false;
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
    private lastPacketSeq16: number | null = null;
    private sessionState: SessionTransportState = createEmptySessionState();
    private resolvedGatt: ResolvedGattProfile = {
        serviceUuid: BLE_SERVICE_UUID,
        dataUuid: BLE_CHARACTERISTICS.DATA,
        commandUuid: BLE_CHARACTERISTICS.COMMAND,
        logUuid: BLE_CHARACTERISTICS.LOG,
    };

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
        this.cleanupSubscriptions();
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

    private cleanupSubscriptions(): void {
        this.sampleSubscription?.remove();
        this.logSubscription?.remove();
        this.sampleSubscription = null;
        this.logSubscription = null;
    }

    private resetRuntimeState() {
        this.negotiatedMtu = 23;
        this.isConfigured = false;
        this.isStreaming = false;
        this.lastPacketSeq16 = null;
        this.resolvedGatt = {
            serviceUuid: BLE_SERVICE_UUID,
            dataUuid: BLE_CHARACTERISTICS.DATA,
            commandUuid: BLE_CHARACTERISTICS.COMMAND,
            logUuid: BLE_CHARACTERISTICS.LOG,
        };
        this.sampleBuffer = [];
        this.bufferingEnabled = false;
        this.cleanupSubscriptions();
    }

    private resetSessionCapture() {
        this.rawPackets = [];
        this.rawSamples = [];
        this.sessionStartMs = null;
        this.packetIndex = 0;
        this.lastPacketSeq16 = null;
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
            this.resetRuntimeState();
            this.sessionState = createEmptySessionState();
            this.sessionState.deviceAddress = deviceId;
            this.sessionState.connectedAt = new Date().toISOString();

            console.log(`Connecting to device: ${deviceId}`);

            const device = await this.manager.connectToDevice(deviceId, {
                autoConnect: false,
                timeout: BLE_CONFIG.CONNECTION_TIMEOUT_MS,
            });

            this.device = device;
            this.sessionState.deviceName = device.name ?? SENSOR_CONFIG.DEVICE_NAME;

            device.onDisconnected((error, disconnectedDevice) => {
                console.log('Device disconnected:', disconnectedDevice?.id);
                this.handleDisconnection(error);
            });

            try {
                await device.requestConnectionPriority(ConnectionPriority.High);
                this.sessionState.connectionPriorityRequested = 'HIGH';
                console.log('[BLE] ? Connection priority set to HIGH');
            } catch (error: any) {
                console.warn('[BLE] Connection priority request failed (non-critical):', error.message);
            }

            this.sessionState.phyRequested = '2M/2M';
            console.log('[BLE] Preferred PHY request is not exposed by react-native-ble-plx; waiting for firmware PHY log.');

            console.log(`[BLE] Requesting MTU: ${BLE_CONFIG.REQUIRED_MTU}`);
            this.sessionState.mtuRequested = BLE_CONFIG.REQUIRED_MTU;
            this.negotiatedMtu = 23;
            try {
                const updatedDevice = await device.requestMTU(BLE_CONFIG.REQUIRED_MTU);
                this.negotiatedMtu = updatedDevice.mtu || 23;
                this.sessionState.mtuNegotiated = this.negotiatedMtu;
                await new Promise((r) => setTimeout(r, 100));
                console.log(`[BLE] ? MTU negotiated: ${this.negotiatedMtu} bytes`);
            } catch (error: any) {
                this.sessionState.mtuNegotiated = this.negotiatedMtu;
                console.warn('[BLE] MTU negotiation failed, using default 23:', error.message);
            }

            if (this.negotiatedMtu < BLE_CONFIG.MIN_STREAM_MTU) {
                console.warn(`[BLE] MTU ${this.negotiatedMtu} < ${BLE_CONFIG.MIN_STREAM_MTU}; stream will remain blocked.`);
            }

            console.log('Discovering services...');
            await device.discoverAllServicesAndCharacteristics();
            const services = await device.services();
            console.log('Services discovered:', services.map((s) => s.uuid));
            await this.ensureRequiredGatt();
            await this.enableNotifications();

            const maxNotifPayload = this.negotiatedMtu - 3;
            if (SENSOR_CONFIG.PACKET_SIZE_BYTES > maxNotifPayload) {
                console.warn(`[BLE] Packet ${SENSOR_CONFIG.PACKET_SIZE_BYTES}B > payload ${maxNotifPayload}B. Expect fragmentation or drop.`);
            }

            this.isConfigured = true;
            this.reconnectAttempts = 0;
            this.emit({ type: 'connected', data: { device } });

            console.log('[BLE] ========================================');
            console.log('[BLE] ? CONNECTED AND CONFIGURED');
            console.log(`[BLE] MTU: ${this.negotiatedMtu} bytes`);
            console.log(`[BLE] Packet Size: ${SENSOR_CONFIG.PACKET_SIZE_BYTES} bytes`);
            console.log(`[BLE] Ready for streaming: ${this.isStreamReady() ? 'YES' : 'NO'}`);
            console.log('[BLE] ========================================');
        } catch (error: any) {
            console.error('Connection failed:', error);
            this.device = null;
            this.resetRuntimeState();
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
            if (!this.sessionState.disconnectedAt) {
                this.sessionState.disconnectedAt = new Date().toISOString();
            }
            await this.manager.cancelDeviceConnection(this.device.id);
        } catch (error: any) {
            console.error('Disconnect error:', error);
        }
    }

    /**
     * Handle disconnection event
     */
    private handleDisconnection(error: any): void {
        if (!this.sessionState.disconnectedAt) {
            this.sessionState.disconnectedAt = new Date().toISOString();
        }
        this.device = null;
        this.resetRuntimeState();
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

    private resolveUuid(candidates: readonly string[], available: readonly string[]): string | null {
        const normalized = new Map(available.map((uuid) => [uuid.toLowerCase(), uuid]));
        for (const candidate of candidates) {
            const match = normalized.get(candidate.toLowerCase());
            if (match) {
                return match;
            }
        }
        return null;
    }

    private async ensureRequiredGatt(): Promise<void> {
        if (!this.device) {
            throw new Error('No device connected');
        }

        const services = await this.device.services();
        const serviceUuid = this.resolveUuid(
            BLE_SERVICE_UUID_ALIASES,
            services.map((service) => service.uuid),
        );
        if (!serviceUuid) {
            throw new Error(`Required IMU service not found: ${BLE_SERVICE_UUID} (discovered: ${services.map((service) => service.uuid).join(', ')})`);
        }

        const characteristics = await this.device.characteristicsForService(serviceUuid);
        const characteristicUuids = characteristics.map((characteristic) => characteristic.uuid);
        const dataUuid = this.resolveUuid(BLE_CHARACTERISTIC_UUID_ALIASES.DATA, characteristicUuids);
        const commandUuid = this.resolveUuid(BLE_CHARACTERISTIC_UUID_ALIASES.COMMAND, characteristicUuids);
        const logUuid = this.resolveUuid(BLE_CHARACTERISTIC_UUID_ALIASES.LOG, characteristicUuids);

        if (!dataUuid || !commandUuid || !logUuid) {
            throw new Error(`Required characteristic not found on service ${serviceUuid}. Discovered: ${characteristicUuids.join(', ')}`);
        }

        this.resolvedGatt = {
            serviceUuid,
            dataUuid,
            commandUuid,
            logUuid,
        };
        console.log(`[BLE] Resolved GATT -> service=${serviceUuid}, data=${dataUuid}, command=${commandUuid}, log=${logUuid}`);
    }

    private isStreamReady(): boolean {
        return !!this.device
            && this.isConfigured
            && this.negotiatedMtu >= BLE_CONFIG.MIN_STREAM_MTU
            && !!this.sampleSubscription
            && !!this.logSubscription;
    }

    private startCharacteristicMonitor(characteristicUuid: string, handler: (base64Data: string) => void): Subscription {
        if (!this.device) {
            throw new Error('No device connected');
        }

        return this.device.monitorCharacteristicForService(
            this.resolvedGatt.serviceUuid,
            characteristicUuid,
            (error, characteristic) => {
                if (error) {
                    console.error(`[BLE] Notification error on ${characteristicUuid}:`, error);
                    return;
                }
                if (characteristic?.value) {
                    handler(characteristic.value);
                }
            },
            undefined,
            'notification',
        );
    }

    /**
     * Enable notifications on sample and log characteristics, serialized.
     */
    private async enableNotifications(): Promise<void> {
        if (!this.device) {
            throw new Error('No device connected');
        }

        try {
            this.cleanupSubscriptions();

            this.sampleSubscription = this.startCharacteristicMonitor(this.resolvedGatt.dataUuid, (value) => {
                this.handleDataNotification(value);
            });
            console.log('[BLE] Sample monitor registered (CCCD managed by react-native-ble-plx)');
            await new Promise((resolve) => setTimeout(resolve, 150));

            this.logSubscription = this.startCharacteristicMonitor(this.resolvedGatt.logUuid, (value) => {
                this.handleLogNotification(value);
            });
            console.log('[BLE] Log monitor registered (CCCD managed by react-native-ble-plx)');
            await new Promise((resolve) => setTimeout(resolve, 150));
        } catch (error: any) {
            console.error('Failed to enable notifications:', error);
            this.cleanupSubscriptions();
            throw error;
        }
    }

    private updatePacketCounters(seq16: number, sampleCount: number) {
        this.sessionState.packetsReceived += 1;
        this.sessionState.samplesReceived += sampleCount;

        if (this.lastPacketSeq16 === null) {
            this.lastPacketSeq16 = seq16;
            return;
        }

        const delta = (seq16 - this.lastPacketSeq16 + 0x10000) & 0xFFFF;
        if (delta === 1) {
            this.lastPacketSeq16 = seq16;
            return;
        }
        if (delta === 0) {
            this.sessionState.duplicatePackets += 1;
            return;
        }
        if (delta > 1 && delta < 0x8000) {
            const missingPackets = delta - 1;
            this.sessionState.missingPackets += missingPackets;
            this.sessionState.missingSamples += missingPackets * SENSOR_CONFIG.SAMPLES_PER_PACKET;
            this.lastPacketSeq16 = seq16;
            return;
        }

        this.sessionState.reorderedPackets += 1;
    }

    /**
     * Handle data characteristic notification (15 IMU samples + seq16)
     */
    private handleDataNotification(base64Data: string): void {
        try {
            const rawBytes = decodeBase64ToBytes(base64Data);
            const receivedAt = Date.now();
            const maxPayload = (this.negotiatedMtu || 23) - 3;
            if (rawBytes.length > maxPayload) {
                console.warn(`[BLE] Notification length ${rawBytes.length} exceeds MTU payload ${maxPayload}. Packet may be truncated/fragmented.`);
            }

            if (rawBytes.length !== SENSOR_CONFIG.PACKET_SIZE_BYTES) {
                console.warn(`[AI-LOG] WARNING: Unexpected packet length: ${rawBytes.length} (Expected ${SENSOR_CONFIG.PACKET_SIZE_BYTES})`);
            }

            const decoded = decodeNotification(base64Data);
            if (decoded && 'samples' in decoded) {
                const packet = decoded as DecodedImuPacket;
                const { seq16, samples } = packet;
                this.rawPackets.push({
                    base64: base64Data,
                    receivedAt,
                    length: rawBytes.length,
                    sampleCount: samples.length,
                    index: this.packetIndex++,
                    seq16,
                });
                this.updatePacketCounters(seq16, samples.length);
                this.rawSamples.push(...samples);

                samples.forEach((sample) => {
                    trajectoryService.processSample(sample);
                });

                if (this.bufferingEnabled) {
                    this.sampleBuffer.push(...samples);
                    if (this.sampleBuffer.length > this.MAX_BUFFER_SAMPLES) {
                        console.warn('[BLE] sampleBuffer overflow; stopping buffering to avoid growth.');
                        this.bufferingEnabled = false;
                        this.sampleBuffer = [];
                    }
                }

                if (samples.length > 0) {
                    this.emit({
                        type: 'dataReceived',
                        data: { sample: samples[samples.length - 1] },
                    });
                }
            } else {
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
                const logLine = decoded as LogMessage;
                this.applyFirmwareLogSideEffects(logLine.message);
                this.emit({
                    type: 'logReceived',
                    data: logLine,
                });
            } else if ('value' in decoded && 'isValid' in decoded) {
                const who = decoded as WHOAMIResponse;
                this.sessionState.whoAmI = who.value;
                this.emit({
                    type: 'whoAmIReceived',
                    data: who,
                });
            }
        } catch (error) {
            console.error('Error handling log notification:', error);
        }
    }

    private applyFirmwareLogSideEffects(message: string) {
        if (message.startsWith('MTU=')) {
            const mtu = Number(message.replace('MTU=', '').trim());
            if (!Number.isNaN(mtu)) {
                this.sessionState.mtuNegotiated = mtu;
            }
            return;
        }

        if (message.startsWith('PHY=')) {
            const match = message.match(/^PHY=([^/]+)\/([^\s]+).*$/);
            if (match) {
                this.sessionState.phyActualTx = match[1];
                this.sessionState.phyActualRx = match[2];
            }
            return;
        }

        if (message.startsWith('SUM ')) {
            this.sessionState.firmwareSummaryLine = message;
            const disconnectMatch = message.match(/disc=([^\s]+)/);
            if (disconnectMatch) {
                this.sessionState.disconnectReasonFromFirmware = disconnectMatch[1];
            }
            return;
        }

        if (message.startsWith('ERR_MTU_LOW:')) {
            this.sessionState.disconnectReasonFromFirmware = message;
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
                this.resolvedGatt.serviceUuid,
                this.resolvedGatt.commandUuid,
                encodedCommand
            );

            console.log(`Sent command: 0x${command.toString(16)} to ${this.resolvedGatt.commandUuid}`);

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
        if (!this.device) {
            throw new Error('No device connected');
        }
        if (!this.isConfigured) {
            throw new Error('BLE connection is not configured yet');
        }
        if (this.isStreaming) {
            console.warn('[BLE] STREAM_ON ignored: stream already active');
            return;
        }
        if (!this.isStreamReady()) {
            throw new Error(`Stream not ready. Check MTU >= ${BLE_CONFIG.MIN_STREAM_MTU} and notification setup.`);
        }

        this.bufferingEnabled = true;
        this.sampleBuffer = [];
        this.resetSessionCapture();
        this.sessionStartMs = Date.now();
        this.sessionState = {
            ...this.sessionState,
            packetsReceived: 0,
            samplesReceived: 0,
            missingPackets: 0,
            missingSamples: 0,
            duplicatePackets: 0,
            reorderedPackets: 0,
            firmwareSummaryLine: null,
            disconnectReasonFromFirmware: null,
        };
        resetIMUTimestampContinuity();
        trajectoryService.reset();
        trajectoryService.setRealtimeEnabled(true);
        await this.sendCommand(BLE_COMMANDS.STREAM_ON);
        this.isStreaming = true;
    }

    /**
     * Stop streaming data
     */
    async stopStreaming(): Promise<void> {
        this.bufferingEnabled = false;
        this.sampleBuffer = [];

        try {
            if (this.device && this.isStreaming) {
                await this.sendCommand(BLE_COMMANDS.STREAM_OFF);
                await new Promise((resolve) => setTimeout(resolve, 300));
            }
        } finally {
            this.isStreaming = false;
            trajectoryService.setRealtimeEnabled(false);
            if (this.device) {
                try {
                    await this.device.requestConnectionPriority(ConnectionPriority.Balanced);
                    this.sessionState.connectionPriorityRequested = 'BALANCED';
                    console.log('[BLE] Connection priority restored to BALANCED');
                } catch (error: any) {
                    console.warn('[BLE] Failed to restore BALANCED priority:', error.message);
                }
            }
        }
    }

    /**
     * Reset the IMU sensor
     */
    async resetIMU(): Promise<void> {
        this.bufferingEnabled = false;
        this.sampleBuffer = [];
        this.isStreaming = false;
        trajectoryService.setRealtimeEnabled(false);
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
                session: { ...this.sessionState },
            },
        };
    }

    /**
     * Capture quality stats for UI/debug.
     */
    getCaptureStats(): CaptureHealthStats {
        return analyzeCaptureHealth(this.rawSamples, this.rawPackets, SENSOR_CONFIG.ODR_HZ);
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
