/**
 * BLE Device Screen
 * 
 * Main screen for managing BLE connection to MOOVIA sensor.
 * Includes device scanner, connection status, control buttons, and data display.
 */

import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    FlatList,
    ActivityIndicator,
    ScrollView,
    Alert,
} from 'react-native';
import { Device } from 'react-native-ble-plx';
// type Device = any; // Mock type for Device since library is removed
import { useBLE } from '../hooks/useBLE';
import { SensorDataCard } from '../components/SensorDataCard';
import { trajectoryService, TrajectoryPoint } from '../services/math/TrajectoryService';

const COLORS = {
    primary: '#501FF0',
    accent: '#1DF09F',
    danger: '#F0411D',
    warning: '#F0DC1D',
    bg: '#0F0F1E',
    card: '#1E1E2E',
    text: '#FFFFFF',
    textMuted: '#A0A0B0',
    success: '#10B981',
};

export function BLEDeviceScreen() {
    const [finalPath, setFinalPath] = useState<TrajectoryPoint[]>([]);
    const [peakAcceleration, setPeakAcceleration] = useState<number | null>(null);
    const [meanPropulsiveVelocity, setMeanPropulsiveVelocity] = useState<number | null>(null);
    const [maxHeight, setMaxHeight] = useState<number | null>(null);

    const {
        isScanning,
        isConnected,
        devices,
        currentDevice,
        sensorData,
        logs,
        whoAmI,
        error,
        startScan,
        stopScan,
        connect,
        disconnect,
        sendWhoAmI,
        startStreaming,
        stopStreaming,
        resetIMU,
        clearError,
        calibrateSensor, // REMOVED - now automatic in Stream On
    } = useBLE();

    const handleStartStreaming = async () => {
        setFinalPath([]); // Clear previous graph
        setPeakAcceleration(null); // Clear previous peak acceleration
        setMeanPropulsiveVelocity(null);
        setMaxHeight(null);
        await startStreaming();
    };

    const handleStopStreaming = async () => {
        try {
            await stopStreaming();
            const points = trajectoryService.getPath().length;
            console.log('[UI] Stream stopped. Updating graph path with ' + points + ' points');
            setFinalPath([...trajectoryService.getPath()]);

            // Obtener métricas después del post-processing
            const peakAcc = trajectoryService.getPeakLinearAcceleration();
            const vmp = trajectoryService.getMeanPropulsiveVelocity();
            const height = trajectoryService.getMaxHeight();

            setPeakAcceleration(peakAcc);
            setMeanPropulsiveVelocity(vmp);
            setMaxHeight(height);

            console.log(`[UI] Results -> Acc: ${peakAcc.toFixed(2)} m/s², VMP: ${vmp.toFixed(2)} m/s, Height: ${height.toFixed(2)} m`);

            // DEBUG ALERT: Confirm data quantity to user
            Alert.alert(
                "Resultados del Levantamiento",
                `VMP: ${vmp.toFixed(2)} m/s\nAceleración Pico: ${peakAcc.toFixed(2)} m/s²\nAltura Máxima: ${height.toFixed(2)} m`
            );
        } catch (e: any) {
            Alert.alert("Error", "Failed to stop stream: " + e.message);
        }
    };

    // ==========================================================================
    // Render Functions
    // ==========================================================================

    const renderDeviceItem = ({ item }: { item: Device }) => (
        <TouchableOpacity
            style={styles.deviceItem}
            onPress={() => connect(item.id)}
            disabled={isConnected}
        >
            <View>
                <Text style={styles.deviceName}>{item.name || 'Unknown Device'}</Text>
                <Text style={styles.deviceId}>{item.id}</Text>
            </View>
            <Text style={styles.connectButton}>Connect</Text>
        </TouchableOpacity>
    );

    const renderLogItem = ({ item }: { item: { timestamp: string; message: string } }) => (
        <View style={styles.logItem}>
            <Text style={styles.logTimestamp}>
                {new Date(item.timestamp).toLocaleTimeString()}
            </Text>
            <Text style={styles.logMessage}>{item.message}</Text>
        </View>
    );

    // ==========================================================================
    // Main Render
    // ==========================================================================

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <Text style={styles.headerTitle}>MOOVIA Sensor</Text>
                <Text style={styles.headerSubtitle}>BLE Device Manager</Text>
            </View>

            <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                {/* Error Display */}
                {error && (
                    <View style={styles.errorContainer}>
                        <Text style={styles.errorText}>{error}</Text>
                        <TouchableOpacity onPress={clearError}>
                            <Text style={styles.errorDismiss}>Dismiss</Text>
                        </TouchableOpacity>
                    </View>
                )}

                {/* Connection Status */}
                <View style={styles.statusCard}>
                    <View style={styles.statusRow}>
                        <Text style={styles.statusLabel}>Status:</Text>
                        <View style={[styles.statusBadge, isConnected && styles.statusBadgeConnected]}>
                            <Text style={styles.statusText}>
                                {isConnected ? 'Connected' : 'Disconnected'}
                            </Text>
                        </View>
                    </View>

                    {currentDevice && (
                        <Text style={styles.deviceInfo}>
                            Device: {currentDevice.name || currentDevice.id}
                        </Text>
                    )}

                    {whoAmI && (
                        <View style={styles.whoAmIContainer}>
                            <Text style={styles.whoAmILabel}>WHO_AM_I:</Text>
                            <Text style={[
                                styles.whoAmIValue,
                                whoAmI.isValid ? styles.whoAmIValid : styles.whoAmIInvalid
                            ]}>
                                0x{whoAmI.value.toString(16).toUpperCase()}
                                {whoAmI.isValid ? ' ✓' : ' ✗'}
                            </Text>
                        </View>
                    )}
                </View>

                {/* Scanner Section */}
                {!isConnected && (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Scan for Devices</Text>

                        <TouchableOpacity
                            style={[styles.scanButton, isScanning && styles.scanButtonActive]}
                            onPress={isScanning ? stopScan : startScan}
                        >
                            {isScanning && <ActivityIndicator color="#FFFFFF" style={{ marginRight: 8 }} />}
                            <Text style={styles.scanButtonText}>
                                {isScanning ? 'Stop Scanning' : 'Start Scan'}
                            </Text>
                        </TouchableOpacity>

                        {devices.length > 0 && (
                            <View style={styles.deviceList}>
                                <Text style={styles.deviceListTitle}>
                                    Found {devices.length} device(s)
                                </Text>
                                <FlatList
                                    data={devices}
                                    keyExtractor={(item) => item.id}
                                    renderItem={renderDeviceItem}
                                    scrollEnabled={false}
                                />
                            </View>
                        )}

                        {isScanning && devices.length === 0 && (
                            <Text style={styles.scanningText}>Scanning for MOOVIA devices...</Text>
                        )}
                    </View>
                )}

                {/* Control Panel */}
                {isConnected && (
                    <>
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>Control Panel</Text>

                            <View style={styles.controlGrid}>
                                <ControlButton
                                    label="WHO AM I"
                                    onPress={sendWhoAmI}
                                    color={COLORS.primary}
                                    icon="?"
                                />
                                <ControlButton
                                    label="Stream On"
                                    onPress={handleStartStreaming}
                                    color={COLORS.success}
                                    icon="▶"
                                />
                            </View>

                            <View style={[styles.controlGrid, { marginTop: 12 }]}>
                                <ControlButton
                                    label="Stream Off"
                                    onPress={handleStopStreaming}
                                    color={COLORS.warning}
                                    icon="■"
                                />
                                <ControlButton
                                    label="Hard Reset"
                                    onPress={resetIMU}
                                    color={COLORS.danger}
                                    icon="🔌"
                                />
                            </View>

                            <TouchableOpacity
                                style={styles.disconnectButton}
                                onPress={disconnect}
                            >
                                <Text style={styles.disconnectButtonText}>Disconnect</Text>
                            </TouchableOpacity>
                        </View>

                        {/* Sensor Data Monitor */}
                        <SensorDataCard
                            data={sensorData}
                            isCalibrating={trajectoryService.getIsCalibrating()}
                            trajectoryPath={finalPath}
                        />

                        {/* Peak Results Cards */}
                        {(peakAcceleration !== null || meanPropulsiveVelocity !== null) && (
                            <View style={styles.resultsContainer}>
                                {meanPropulsiveVelocity !== null && (
                                    <View style={[styles.metricCard, { borderColor: COLORS.success }]}>
                                        <Text style={styles.metricLabel}>V. Media Propulsiva</Text>
                                        <Text style={[styles.metricValue, { color: COLORS.success }]}>
                                            {meanPropulsiveVelocity.toFixed(2)}
                                        </Text>
                                        <Text style={styles.metricUnit}>m/s</Text>
                                    </View>
                                )}

                                {maxHeight !== null && (
                                    <View style={[styles.metricCard, { borderColor: COLORS.primary }]}>
                                        <Text style={styles.metricLabel}>Altura Máxima</Text>
                                        <Text style={[styles.metricValue, { color: COLORS.primary }]}>
                                            {maxHeight.toFixed(2)}
                                        </Text>
                                        <Text style={styles.metricUnit}>m</Text>
                                    </View>
                                )}

                                {peakAcceleration !== null && (
                                    <View style={[styles.metricCard, { borderColor: COLORS.accent }]}>
                                        <Text style={styles.metricLabel}>Acel. Lineal Pico</Text>
                                        <Text style={[styles.metricValue, { color: COLORS.accent }]}>
                                            {peakAcceleration.toFixed(2)}
                                        </Text>
                                        <Text style={styles.metricUnit}>m/s²</Text>
                                    </View>
                                )}
                            </View>
                        )}

                        {/* Logs */}
                        {logs.length > 0 && (
                            <View style={styles.section}>
                                <Text style={styles.sectionTitle}>Device Logs</Text>
                                <View style={styles.logContainer}>
                                    <FlatList
                                        data={logs.slice().reverse()}
                                        keyExtractor={(item, index) => `${item.timestamp}-${index}`}
                                        renderItem={renderLogItem}
                                        scrollEnabled={false}
                                    />
                                </View>
                            </View>
                        )}
                    </>
                )}
            </ScrollView>
        </View >
    );
}

// ============================================================================
// Control Button Component
// ============================================================================

interface ControlButtonProps {
    label: string;
    onPress: () => void;
    color: string;
    icon: string;
}

function ControlButton({ label, onPress, color, icon }: ControlButtonProps) {
    return (
        <TouchableOpacity
            style={[styles.controlButton, { backgroundColor: color }]}
            onPress={onPress}
        >
            <Text style={styles.controlButtonIcon}>{icon}</Text>
            <Text style={styles.controlButtonText}>{label}</Text>
        </TouchableOpacity>
    );
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: COLORS.bg,
    },
    header: {
        backgroundColor: COLORS.primary,
        paddingHorizontal: 20,
        paddingTop: 60,
        paddingBottom: 24,
        borderBottomLeftRadius: 24,
        borderBottomRightRadius: 24,
    },
    headerTitle: {
        fontSize: 28,
        fontWeight: '800',
        color: COLORS.text,
        marginBottom: 4,
    },
    headerSubtitle: {
        fontSize: 14,
        color: '#E5E7EB',
    },
    content: {
        flex: 1,
        paddingHorizontal: 20,
    },
    errorContainer: {
        backgroundColor: COLORS.danger,
        borderRadius: 12,
        padding: 16,
        marginTop: 16,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    errorText: {
        color: COLORS.text,
        fontSize: 14,
        flex: 1,
    },
    errorDismiss: {
        color: COLORS.text,
        fontSize: 14,
        fontWeight: '700',
    },
    statusCard: {
        backgroundColor: COLORS.card,
        borderRadius: 16,
        padding: 20,
        marginTop: 16,
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    statusLabel: {
        fontSize: 16,
        color: COLORS.textMuted,
        marginRight: 12,
    },
    statusBadge: {
        backgroundColor: COLORS.danger,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 999,
    },
    statusBadgeConnected: {
        backgroundColor: COLORS.success,
    },
    statusText: {
        color: COLORS.text,
        fontSize: 14,
        fontWeight: '700',
    },
    deviceInfo: {
        fontSize: 14,
        color: COLORS.textMuted,
        marginTop: 8,
    },
    whoAmIContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 12,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: '#2E2E3E',
    },
    whoAmILabel: {
        fontSize: 14,
        color: COLORS.textMuted,
        marginRight: 8,
    },
    whoAmIValue: {
        fontSize: 16,
        fontWeight: '700',
    },
    whoAmIValid: {
        color: COLORS.success,
    },
    whoAmIInvalid: {
        color: COLORS.danger,
    },
    section: {
        marginTop: 24,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: COLORS.text,
        marginBottom: 12,
    },
    scanButton: {
        backgroundColor: COLORS.primary,
        borderRadius: 12,
        padding: 16,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
    },
    scanButtonActive: {
        backgroundColor: COLORS.danger,
    },
    scanButtonText: {
        color: COLORS.text,
        fontSize: 16,
        fontWeight: '700',
    },
    scanningText: {
        color: COLORS.textMuted,
        fontSize: 14,
        textAlign: 'center',
        marginTop: 16,
    },
    deviceList: {
        marginTop: 16,
    },
    deviceListTitle: {
        fontSize: 14,
        color: COLORS.textMuted,
        marginBottom: 8,
    },
    deviceItem: {
        backgroundColor: COLORS.card,
        borderRadius: 12,
        padding: 16,
        marginBottom: 8,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    deviceName: {
        fontSize: 16,
        fontWeight: '600',
        color: COLORS.text,
        marginBottom: 4,
    },
    deviceId: {
        fontSize: 12,
        color: COLORS.textMuted,
    },
    connectButton: {
        color: COLORS.accent,
        fontSize: 14,
        fontWeight: '700',
    },
    controlGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
    },
    controlButton: {
        width: '48%',
        borderRadius: 12,
        padding: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    controlButtonIcon: {
        fontSize: 24,
        color: COLORS.text,
        marginBottom: 8,
    },
    controlButtonText: {
        color: COLORS.text,
        fontSize: 14,
        fontWeight: '700',
    },
    disconnectButton: {
        backgroundColor: COLORS.danger,
        borderRadius: 12,
        padding: 16,
        marginTop: 16,
        alignItems: 'center',
    },
    disconnectButtonText: {
        color: COLORS.text,
        fontSize: 16,
        fontWeight: '700',
    },
    logContainer: {
        backgroundColor: COLORS.card,
        borderRadius: 12,
        padding: 16,
        maxHeight: 300,
    },
    logItem: {
        marginBottom: 12,
    },
    logTimestamp: {
        fontSize: 11,
        color: COLORS.textMuted,
        marginBottom: 4,
    },
    logMessage: {
        fontSize: 13,
        color: COLORS.text,
    },
    // Estilos para los resultados
    resultsContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        marginTop: 16,
        gap: 12,
    },
    metricCard: {
        backgroundColor: COLORS.card,
        borderRadius: 16,
        padding: 16,
        width: '48%',
        alignItems: 'center',
        borderWidth: 2,
    },
    metricLabel: {
        fontSize: 10,
        color: COLORS.textMuted,
        marginBottom: 8,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        textAlign: 'center',
    },
    metricValue: {
        fontSize: 32,
        fontWeight: '800',
    },
    metricUnit: {
        fontSize: 14,
        color: COLORS.text,
        marginTop: 2,
    },
});
