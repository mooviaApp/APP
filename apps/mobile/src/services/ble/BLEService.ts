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
} from './constants';
import {
    decodeNotification,
    encodeCommand,
    decodeBase64ToBytes,
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

            // 4. Request MTU (CRITICAL for 181-byte packets)
            console.log(`[BLE] Requesting MTU: ${BLE_CONFIG.REQUIRED_MTU}`);
            let negotiatedMTU = 23; // Default MTU if negotiation fails

            try {
                const updatedDevice = await device.requestMTU(BLE_CONFIG.REQUIRED_MTU);
                negotiatedMTU = updatedDevice.mtu || BLE_CONFIG.REQUIRED_MTU;

                // CRITICAL: Wait for MTU to be applied by firmware
                await new Promise(r => setTimeout(r, 100));

                console.log(`[BLE] ✅ MTU negotiated: ${negotiatedMTU} bytes`);

                if (negotiatedMTU < 185) {
                    const errorMsg = `CRITICAL: MTU ${negotiatedMTU} < 185. Cannot receive 181-byte packets!`;
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

                // Add all samples to buffer
                this.sampleBuffer.push(...samples);

                // Process samples for trajectory (All samples needed for integration)
                samples.forEach(sample => {
                    trajectoryService.processSample(sample);
                });

                // Emit only the last sample for real-time display
                if (samples.length > 0) {
                    this.emit({
                        type: 'dataReceived',
                        data: { sample: samples[samples.length - 1] },
                    });
                }

                // Check if buffer is full (ready to send to backend)
                if (this.sampleBuffer.length >= SENSOR_CONFIG.BATCH_SIZE_SAMPLES) {
                    // Note: Backend transmission will be handled by the hook/component
                    // We just keep the buffer here
                }
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
        this.sampleBuffer = []; // Clear buffer
        await this.sendCommand(BLE_COMMANDS.STREAM_ON);
    }

    /**
     * Stop streaming data
     */
    async stopStreaming(): Promise<void> {
        await this.sendCommand(BLE_COMMANDS.STREAM_OFF);
    }

    /**
     * Reset the IMU sensor
     */
    async resetIMU(): Promise<void> {
        await this.sendCommand(BLE_COMMANDS.RESET_IMU);
    }

    // ==========================================================================
    // Data Access
    // ==========================================================================

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
