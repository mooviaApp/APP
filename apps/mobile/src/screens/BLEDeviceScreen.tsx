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
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type { CaptureHealthStats, SessionAnalysisSummary } from '@moovia/sensor-core';

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
    const [maxLateral, setMaxLateral] = useState<number | null>(null);
    const [sessionAnalysis, setSessionAnalysis] = useState<SessionAnalysisSummary | null>(null);

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
        getRawSession,
        getCaptureStats,
    } = useBLE();
    const [captureStats, setCaptureStats] = useState<CaptureHealthStats | null>(null);
    const repAnalysis = sessionAnalysis?.repAnalysis ?? null;
    const bestRep = repAnalysis?.bestRepIndex != null
        ? repAnalysis.reps.find((rep) => rep.index === repAnalysis.bestRepIndex) ?? null
        : null;
    const meanPeakVerticalVelocity = repAnalysis && repAnalysis.reps.length > 0
        ? repAnalysis.reps.reduce((sum, rep) => sum + rep.metrics.peakVerticalVelocity, 0) / repAnalysis.reps.length
        : 0;
    const velocityLabel = sessionAnalysis?.movementMetrics.velocityBasis === 'rep-local'
        ? 'Velocidad local por rep'
        : sessionAnalysis?.movementMetrics.velocityBasis === 'session-global'
            ? 'Velocidad global integrada'
            : 'Velocidad estimada';
    const velocityConfidence = sessionAnalysis?.diagnostics.metricConfidence.velocity ?? 'low';
    const timebaseConfidence = captureStats?.timebaseConfidence ?? sessionAnalysis?.diagnostics.timebaseConfidence ?? 'low';

    const handleStartStreaming = async () => {
        setFinalPath([]); // Clear previous graph
        setPeakAcceleration(null); // Clear previous peak acceleration
        setMeanPropulsiveVelocity(null);
        setMaxHeight(null);
        setMaxLateral(null);
        setSessionAnalysis(null);
        await startStreaming();
    };

    const handleStopStreaming = async () => {
        try {
            await stopStreaming();
            const points = trajectoryService.getPath().length;
            console.log('[UI] Stream stopped. Updating graph path with ' + points + ' points');
            setFinalPath([...trajectoryService.getPath()]);
            const analysis = trajectoryService.getSessionAnalysis();

            // Obtener metricas despues del post-processing
            const peakAcc = analysis.movementMetrics.peakLinearAcc;
            const vmp = analysis.movementMetrics.meanPropulsiveVelocity;
            const height = analysis.movementMetrics.maxHeight;
            const lateral = analysis.movementMetrics.maxLateral;
            const capStats = getCaptureStats();

            setPeakAcceleration(peakAcc);
            setMeanPropulsiveVelocity(vmp);
            setMaxHeight(height);
            setMaxLateral(lateral);
            setCaptureStats(capStats);
            setSessionAnalysis(analysis);

            console.log(`[UI] Results -> Acc: ${peakAcc.toFixed(2)} m/s^2, Vel: ${vmp.toFixed(2)} m/s (${analysis.movementMetrics.velocityBasis}), Height: ${height.toFixed(2)} m, Lateral: ${lateral.toFixed(2)} m`);

            // DEBUG ALERT: Confirm data quantity to user
            Alert.alert(
                "Resultados del Levantamiento",
                `Velocidad (${analysis.movementMetrics.velocityBasis}): ${vmp.toFixed(2)} m/s\nConfianza velocidad: ${analysis.diagnostics.metricConfidence.velocity}\nAceleracion pico: ${peakAcc.toFixed(2)} m/s^2\nAltura maxima: ${height.toFixed(2)} m\nAltura asentada: ${analysis.movementMetrics.settledEndHeight.toFixed(2)} m\nLateral activa: ${analysis.movementMetrics.activeEndLateral.toFixed(2)} m\nLateral asentada: ${analysis.movementMetrics.settledEndLateral.toFixed(2)} m`
            );
        } catch (e: any) {
            Alert.alert('Error', 'No se pudo detener el stream: ' + e.message);
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
                <Text style={styles.deviceName}>{item.name || 'Dispositivo desconocido'}</Text>
                <Text style={styles.deviceId}>{item.id}</Text>
            </View>
            <Text style={styles.connectButton}>Conectar</Text>
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

    const handleExportSession = async () => {
        try {
            const exportData = getRawSession();
            if (exportData.samples.length === 0 && exportData.rawPackets.length === 0) {
                Alert.alert('Sin datos', 'No hay muestras registradas aun.');
                return;
            }

            const json = JSON.stringify(exportData, null, 2);
            const filename = `moovia-session-${Date.now()}.json`;
            const fileUri = FileSystem.cacheDirectory + filename;

            // Nota: omitir encoding para evitar accesos a EncodingType inexistente en algunas builds
            await FileSystem.writeAsStringAsync(fileUri, json);

            const canShare = await Sharing.isAvailableAsync();
            if (!canShare) {
                Alert.alert('Exportado en local', `Archivo guardado en cache:\n${fileUri}`);
                return;
            }

            await Sharing.shareAsync(fileUri, {
                mimeType: 'application/json',
                dialogTitle: 'Exportar sesion MOOVIA',
            });
        } catch (err: any) {
            console.error('Export failed', err);
            Alert.alert('Error', 'No se pudo exportar la sesion: ' + err.message);
        }
    };

    // ==========================================================================
    // Main Render
    // ==========================================================================

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <Text style={styles.headerTitle}>MOOVIA Sensor</Text>
                <Text style={styles.headerSubtitle}>Panel BLE</Text>
            </View>

            <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                {/* Error Display */}
                {error && (
                    <View style={styles.errorContainer}>
                        <Text style={styles.errorText}>{error}</Text>
                        <TouchableOpacity onPress={clearError}>
                            <Text style={styles.errorDismiss}>Cerrar</Text>
                        </TouchableOpacity>
                    </View>
                )}

                {/* Connection Status */}
                <View style={styles.statusCard}>
                    <View style={styles.statusRow}>
                        <Text style={styles.statusLabel}>Estado:</Text>
                        <View style={[styles.statusBadge, isConnected && styles.statusBadgeConnected]}>
                            <Text style={styles.statusText}>
                                {isConnected ? 'Conectado' : 'Desconectado'}
                            </Text>
                        </View>
                    </View>

                    {currentDevice && (
                        <Text style={styles.deviceInfo}>
                            Dispositivo: {currentDevice.name || currentDevice.id}
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
                                {whoAmI.isValid ? ' OK' : ' FAIL'}
                            </Text>
                        </View>
                    )}
                </View>

                {/* Scanner Section */}
                {!isConnected && (
                    <View style={styles.section}>
                        <Text style={styles.sectionTitle}>Escanear dispositivos</Text>

                        <TouchableOpacity
                            style={[styles.scanButton, isScanning && styles.scanButtonActive]}
                            onPress={isScanning ? stopScan : startScan}
                        >
                            {isScanning && <ActivityIndicator color="#FFFFFF" style={{ marginRight: 8 }} />}
                            <Text style={styles.scanButtonText}>
                                {isScanning ? 'Detener escaneo' : 'Escanear dispositivos'}
                            </Text>
                        </TouchableOpacity>

                        {devices.length > 0 && (
                            <View style={styles.deviceList}>
                                <Text style={styles.deviceListTitle}>
                                    Encontrados {devices.length} dispositivo(s)
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
                            <Text style={styles.scanningText}>Buscando dispositivos MOOVIA...</Text>
                        )}
                    </View>
                )}

                {/* Control Panel */}
                {isConnected && (
                    <>
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>Panel de control</Text>

                            <View style={styles.controlGrid}>
                                <ControlButton
                                    label="WHO AM I"
                                    onPress={sendWhoAmI}
                                    color={COLORS.primary}
                                    icon="ID"
                                />
                                <ControlButton
                                    label="Iniciar stream"
                                    onPress={handleStartStreaming}
                                    color={COLORS.success}
                                    icon="ON"
                                />
                            </View>

                            <View style={[styles.controlGrid, { marginTop: 12 }]}>
                                <ControlButton
                                    label="Detener stream"
                                    onPress={handleStopStreaming}
                                    color={COLORS.warning}
                                    icon="OFF"
                                />
                                <ControlButton
                                    label="Reset IMU"
                                    onPress={resetIMU}
                                    color={COLORS.danger}
                                    icon="RST"
                                />
                            </View>

                            <TouchableOpacity
                                style={[styles.controlButton, { width: '100%', marginTop: 12, backgroundColor: '#333' }]}
                                onPress={handleExportSession}
                            >
                                <Text style={styles.controlButtonText}>Exportar JSON RAW</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={styles.disconnectButton}
                                onPress={disconnect}
                            >
                                <Text style={styles.disconnectButtonText}>Desconectar</Text>
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
                                        <Text style={styles.metricLabel}>{velocityLabel}</Text>
                                        <Text style={[styles.metricValue, { color: COLORS.success }]}>
                                            {meanPropulsiveVelocity.toFixed(2)}
                                        </Text>
                                        <Text style={styles.metricUnit}>m/s</Text>
                                        <Text style={styles.metricHint}>confianza {velocityConfidence} | timebase {timebaseConfidence}</Text>
                                    </View>
                                )}

                                {maxHeight !== null && (
                                    <View style={[styles.metricCard, { borderColor: COLORS.primary }]}>
                                        <Text style={styles.metricLabel}>Altura maxima</Text>
                                        <Text style={[styles.metricValue, { color: COLORS.primary }]}>
                                            {maxHeight.toFixed(2)}
                                        </Text>
                                        <Text style={styles.metricUnit}>m</Text>
                                    </View>
                                )}
                                {maxLateral !== null && (
                                    <View style={[styles.metricCard, { borderColor: COLORS.warning }]}>
                                        <Text style={styles.metricLabel}>Desviacion lateral</Text>
                                        <Text style={[styles.metricValue, { color: COLORS.warning }]}>
                                            {maxLateral.toFixed(2)}
                                        </Text>
                                        <Text style={styles.metricUnit}>m</Text>
                                    </View>
                                )}
                                {peakAcceleration !== null && (
                                    <View style={[styles.metricCard, { borderColor: COLORS.accent }]}>
                                        <Text style={styles.metricLabel}>Aceleracion pico</Text>
                                        <Text style={[styles.metricValue, { color: COLORS.accent }]}>
                                            {peakAcceleration.toFixed(2)}
                                        </Text>
                                        <Text style={styles.metricUnit}>m/s^2</Text>
                                    </View>
                                )}
                            </View>
                        )}

                        {captureStats && (
                            <View style={styles.captureCard}>
                                <Text style={styles.sectionTitle}>Capture Health</Text>
                                <View style={styles.captureRow}>
                                    <Text style={styles.captureLabel}>avgRate</Text><Text style={styles.captureValue}>{captureStats.avgRateHz.toFixed(0)} Hz</Text>
                                </View>
                                <View style={styles.captureRow}>
                                    <Text style={styles.captureLabel}>medianDt</Text><Text style={styles.captureValue}>{captureStats.medianDtMs.toFixed(3)} ms</Text>
                                </View>
                                <View style={styles.captureRow}>
                                    <Text style={styles.captureLabel}>maxDt</Text><Text style={styles.captureValue}>{captureStats.maxDtMs.toFixed(3)} ms</Text>
                                </View>
                                <View style={styles.captureRow}>
                                    <Text style={styles.captureLabel}>%gaps&gt;4ms</Text><Text style={styles.captureValue}>{captureStats.gapsPct.toFixed(2)}%</Text>
                                </View>
                                <View style={styles.captureRow}>
                                    <Text style={styles.captureLabel}>maxGap</Text><Text style={styles.captureValue}>{captureStats.maxGapMs.toFixed(2)} ms</Text>
                                </View>
                                <View style={styles.captureRow}>
                                    <Text style={styles.captureLabel}>packets</Text><Text style={styles.captureValue}>{captureStats.totalPackets}</Text>
                                </View>
                                <View style={styles.captureRow}>
                                    <Text style={styles.captureLabel}>invalidLen</Text><Text style={styles.captureValue}>{captureStats.invalidPackets}</Text>
                                </View>
                                <View style={styles.captureRow}>
                                    <Text style={styles.captureLabel}>missingPackets</Text><Text style={styles.captureValue}>{captureStats.missingPackets}</Text>
                                </View>
                                <View style={styles.captureRow}>
                                    <Text style={styles.captureLabel}>missingSamples</Text><Text style={styles.captureValue}>{captureStats.estimatedMissingSamples.toFixed(0)}</Text>
                                </View>
                                <View style={styles.captureRow}>
                                    <Text style={styles.captureLabel}>duplicatePackets</Text><Text style={styles.captureValue}>{captureStats.duplicatePackets}</Text>
                                </View>
                                <View style={styles.captureRow}>
                                    <Text style={styles.captureLabel}>reorderedPackets</Text><Text style={styles.captureValue}>{captureStats.reorderedPackets}</Text>
                                </View>
                                <View style={styles.captureRow}>
                                    <Text style={styles.captureLabel}>droppedPackets</Text><Text style={styles.captureValue}>{captureStats.droppedPackets}</Text>
                                </View>
                                <View style={styles.captureRow}>
                                    <Text style={styles.captureLabel}>effectiveTick</Text><Text style={styles.captureValue}>{captureStats.effectiveTickUs ? `${captureStats.effectiveTickUs.toFixed(2)} us` : '--'}</Text>
                                </View>
                            </View>
                        )}

                        {sessionAnalysis?.movementSegment && (
                            <View style={styles.captureCard}>
                                <Text style={styles.sectionTitle}>Movement Window</Text>
                                <Text style={styles.captureHint}>
                                    La captura completa incluye colocacion y reposo; estas metricas usan solo el tramo activo.
                                </Text>
                                <View style={styles.captureRow}>
                                    <Text style={styles.captureLabel}>idle inicial</Text>
                                    <Text style={styles.captureValue}>{(sessionAnalysis.movementSegment.initialIdleMs / 1000).toFixed(2)} s</Text>
                                </View>
                                <View style={styles.captureRow}>
                                    <Text style={styles.captureLabel}>movimiento</Text>
                                    <Text style={styles.captureValue}>{(sessionAnalysis.movementSegment.activeDurationMs / 1000).toFixed(2)} s</Text>
                                </View>
                                <View style={styles.captureRow}>
                                    <Text style={styles.captureLabel}>idle final</Text>
                                    <Text style={styles.captureValue}>{(sessionAnalysis.movementSegment.finalIdleMs / 1000).toFixed(2)} s</Text>
                                </View>
                                <View style={styles.captureRow}>
                                    <Text style={styles.captureLabel}>trimmed tail</Text>
                                    <Text style={styles.captureValue}>{(sessionAnalysis.movementSegment.trimmedTailMs / 1000).toFixed(2)} s</Text>
                                </View>
                                <View style={styles.captureRow}>
                                    <Text style={styles.captureLabel}>end reason</Text>
                                    <Text style={styles.captureValue}>{sessionAnalysis.movementSegment.endReason}</Text>
                                </View>
                                <View style={styles.captureRow}>
                                    <Text style={styles.captureLabel}>confidence</Text>
                                    <Text style={styles.captureValue}>{sessionAnalysis.movementSegment.confidence}</Text>
                                </View>
                                <View style={styles.captureRow}>
                                    <Text style={styles.captureLabel}>velocidad base</Text>
                                    <Text style={styles.captureValue}>{sessionAnalysis.movementMetrics.velocityBasis}</Text>
                                </View>
                                <View style={styles.captureRow}>
                                    <Text style={styles.captureLabel}>velocidad global</Text>
                                    <Text style={styles.captureValue}>{sessionAnalysis.movementMetrics.globalMeanPropulsiveVelocity.toFixed(3)} m/s</Text>
                                </View>
                                <View style={styles.captureRow}>
                                    <Text style={styles.captureLabel}>velocidad local</Text>
                                    <Text style={styles.captureValue}>{sessionAnalysis.movementMetrics.localMeanPropulsiveVelocity.toFixed(3)} m/s</Text>
                                </View>
                                <View style={styles.captureRow}>
                                    <Text style={styles.captureLabel}>confianza velocidad</Text>
                                    <Text style={styles.captureValue}>{sessionAnalysis.diagnostics.metricConfidence.velocity}</Text>
                                </View>
                                <View style={styles.captureRow}>
                                    <Text style={styles.captureLabel}>residual speed</Text>
                                    <Text style={styles.captureValue}>{sessionAnalysis.movementMetrics.residualSpeedAtEnd.toFixed(3)} m/s</Text>
                                </View>
                            </View>
                        )}

                        {sessionAnalysis && (
                            <View style={styles.captureCard}>
                                <Text style={styles.sectionTitle}>Trajectory Summary</Text>
                                <Text style={styles.captureHint}>
                                    La trayectoria mostrada usa el tramo activo estabilizado; la posicion asentada final se reporta aparte.
                                </Text>
                                <View style={styles.captureRow}>
                                    <Text style={styles.captureLabel}>altura activa</Text>
                                    <Text style={styles.captureValue}>{sessionAnalysis.movementMetrics.activeEndHeight.toFixed(2)} m</Text>
                                </View>
                                <View style={styles.captureRow}>
                                    <Text style={styles.captureLabel}>altura asentada</Text>
                                    <Text style={styles.captureValue}>{sessionAnalysis.movementMetrics.settledEndHeight.toFixed(2)} m</Text>
                                </View>
                                <View style={styles.captureRow}>
                                    <Text style={styles.captureLabel}>lateral activa</Text>
                                    <Text style={styles.captureValue}>{sessionAnalysis.movementMetrics.activeEndLateral.toFixed(2)} m</Text>
                                </View>
                                <View style={styles.captureRow}>
                                    <Text style={styles.captureLabel}>lateral asentada</Text>
                                    <Text style={styles.captureValue}>{sessionAnalysis.movementMetrics.settledEndLateral.toFixed(2)} m</Text>
                                </View>
                                <View style={styles.captureRow}>
                                    <Text style={styles.captureLabel}>barAxis</Text>
                                    <Text style={styles.captureValue}>{sessionAnalysis.diagnostics.barAxisConfidence}</Text>
                                </View>
                                <View style={styles.captureRow}>
                                    <Text style={styles.captureLabel}>sample interval</Text>
                                    <Text style={styles.captureValue}>{sessionAnalysis.diagnostics.effectiveTickUs ? `${sessionAnalysis.diagnostics.effectiveTickUs.toFixed(2)} us` : '--'}</Text>
                                </View>
                                <View style={styles.captureRow}>
                                    <Text style={styles.captureLabel}>observed tick</Text>
                                    <Text style={styles.captureValue}>{sessionAnalysis.diagnostics.observedTickUs ? `${sessionAnalysis.diagnostics.observedTickUs.toFixed(3)} us` : '--'}</Text>
                                </View>
                                <View style={styles.captureRow}>
                                    <Text style={styles.captureLabel}>timebase confidence</Text>
                                    <Text style={styles.captureValue}>{timebaseConfidence}</Text>
                                </View>
                            </View>
                        )}

                        {repAnalysis && (
                            <View style={styles.captureCard}>
                                <Text style={styles.sectionTitle}>Repeticiones</Text>
                                <Text style={styles.captureHint}>
                                    El conteo se calcula offline sobre el tramo activo, usando ciclos locales en el eje Z. La velocidad por rep se interpreta como metrica local comparativa.
                                </Text>
                                <View style={styles.captureRow}>
                                    <Text style={styles.captureLabel}>reps completas</Text>
                                    <Text style={styles.captureValue}>{repAnalysis.repCount}</Text>
                                </View>
                                <View style={styles.captureRow}>
                                    <Text style={styles.captureLabel}>velocidad pico media</Text>
                                    <Text style={styles.captureValue}>{meanPeakVerticalVelocity.toFixed(3)} m/s</Text>
                                </View>
                                <View style={styles.captureRow}>
                                    <Text style={styles.captureLabel}>mejor rep</Text>
                                    <Text style={styles.captureValue}>{bestRep ? `Rep ${bestRep.index}` : '--'}</Text>
                                </View>
                                <View style={styles.captureRow}>
                                    <Text style={styles.captureLabel}>VMP media serie</Text>
                                    <Text style={styles.captureValue}>{repAnalysis.seriesMeanPropulsiveVelocity.toFixed(3)} m/s</Text>
                                </View>

                                {repAnalysis.reps.map((rep) => (
                                    <View key={`rep-${rep.index}`} style={styles.repCard}>
                                        <Text style={styles.repTitle}>Rep {rep.index}</Text>
                                        <View style={styles.captureRow}>
                                            <Text style={styles.captureLabel}>direccion</Text>
                                            <Text style={styles.captureValue}>{rep.direction}</Text>
                                        </View>
                                        <View style={styles.captureRow}>
                                            <Text style={styles.captureLabel}>duracion</Text>
                                            <Text style={styles.captureValue}>{(rep.durationMs / 1000).toFixed(2)} s</Text>
                                        </View>
                                        <View style={styles.captureRow}>
                                            <Text style={styles.captureLabel}>velocidad pico</Text>
                                            <Text style={styles.captureValue}>{rep.metrics.peakVerticalVelocity.toFixed(3)} m/s</Text>
                                        </View>
                                        <View style={styles.captureRow}>
                                            <Text style={styles.captureLabel}>VMP</Text>
                                            <Text style={styles.captureValue}>{rep.metrics.meanPropulsiveVelocity.toFixed(3)} m/s</Text>
                                        </View>
                                        <View style={styles.captureRow}>
                                            <Text style={styles.captureLabel}>aceleracion pico</Text>
                                            <Text style={styles.captureValue}>{rep.metrics.peakLinearAcc.toFixed(3)} m/s^2</Text>
                                        </View>
                                        <View style={styles.captureRow}>
                                            <Text style={styles.captureLabel}>altura max</Text>
                                            <Text style={styles.captureValue}>{rep.metrics.maxHeight.toFixed(3)} m</Text>
                                        </View>
                                        <View style={styles.captureRow}>
                                            <Text style={styles.captureLabel}>lateral max</Text>
                                            <Text style={styles.captureValue}>{rep.metrics.maxLateral.toFixed(3)} m</Text>
                                        </View>
                                        <View style={styles.captureRow}>
                                            <Text style={styles.captureLabel}>confidence</Text>
                                            <Text style={styles.captureValue}>{rep.confidence}</Text>
                                        </View>
                                    </View>
                                ))}

                                {repAnalysis.partialRep && (
                                    <View style={styles.repCard}>
                                        <Text style={styles.repTitle}>Rep incompleta</Text>
                                        <View style={styles.captureRow}>
                                            <Text style={styles.captureLabel}>direccion</Text>
                                            <Text style={styles.captureValue}>{repAnalysis.partialRep.direction}</Text>
                                        </View>
                                        <View style={styles.captureRow}>
                                            <Text style={styles.captureLabel}>duracion</Text>
                                            <Text style={styles.captureValue}>{(repAnalysis.partialRep.durationMs / 1000).toFixed(2)} s</Text>
                                        </View>
                                        <View style={styles.captureRow}>
                                            <Text style={styles.captureLabel}>velocidad pico</Text>
                                            <Text style={styles.captureValue}>{repAnalysis.partialRep.metrics.peakVerticalVelocity.toFixed(3)} m/s</Text>
                                        </View>
                                        <View style={styles.captureRow}>
                                            <Text style={styles.captureLabel}>altura max</Text>
                                            <Text style={styles.captureValue}>{repAnalysis.partialRep.metrics.maxHeight.toFixed(3)} m</Text>
                                        </View>
                                        <View style={styles.captureRow}>
                                            <Text style={styles.captureLabel}>confidence</Text>
                                            <Text style={styles.captureValue}>{repAnalysis.partialRep.confidence}</Text>
                                        </View>
                                    </View>
                                )}
                            </View>
                        )}

                        {/* Logs */}
                        {logs.length > 0 && (
                            <View style={styles.section}>
                                <Text style={styles.sectionTitle}>Logs del dispositivo</Text>
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
    metricHint: {
        fontSize: 10,
        color: COLORS.textMuted,
        marginTop: 6,
    },
    captureCard: {
        backgroundColor: COLORS.card,
        borderRadius: 16,
        padding: 16,
        marginTop: 12,
        borderWidth: 1,
        borderColor: '#333',
    },
    captureHint: {
        color: COLORS.textMuted,
        fontSize: 12,
        lineHeight: 18,
        marginBottom: 10,
    },
    captureRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 6,
    },
    captureLabel: {
        color: COLORS.textMuted,
        fontSize: 12,
    },
    captureValue: {
        color: COLORS.text,
        fontSize: 13,
        fontWeight: '700',
    },
    repCard: {
        marginTop: 12,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: '#333',
    },
    repTitle: {
        color: COLORS.text,
        fontSize: 14,
        fontWeight: '700',
        marginBottom: 8,
    },
});

