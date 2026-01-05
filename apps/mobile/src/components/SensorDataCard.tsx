import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { IMUSample } from '../services/ble/constants';
import { trajectoryService, TrajectoryPoint } from '../services/math/TrajectoryService';
import { OrientationViz } from './OrientationViz';
import { TrajectoryGraph } from './TrajectoryGraph';

interface SensorDataCardProps {
    data: IMUSample | null;
    isCalibrating: boolean;
    trajectoryPath?: TrajectoryPoint[];
}

// SIMPLIFIED: Only IDLE and CALIBRATING states for calibration testing
type LiftState = 'IDLE' | 'CALIBRATING';

export function SensorDataCard({ data, isCalibrating: isCalibratingProp, trajectoryPath }: SensorDataCardProps) {
    const [liftState, setLiftState] = useState<LiftState>('IDLE');

    // SIMPLIFIED State machine: IDLE ↔ CALIBRATING only
    useEffect(() => {

        if (isCalibratingProp && liftState !== 'CALIBRATING') {
            setLiftState('CALIBRATING');
            console.log('[UI] State: → CALIBRATING');
        }
        else if (!isCalibratingProp && liftState === 'CALIBRATING') {
            setLiftState('IDLE');
            console.log('[UI] State: CALIBRATING → IDLE');
        }
    }, [liftState, isCalibratingProp]);

    if (!data) {
        return (
            <View style={styles.container}>
                <Text style={styles.noDataText}>No sensor data available</Text>
                <Text style={styles.hintText}>Press "Stream On" to start</Text>
            </View>
        );
    }

    const isCalibrating = liftState === 'CALIBRATING';

    return (
        <View style={styles.container}>
            <View style={styles.headerRow}>
                <Text style={styles.title}>
                    {isCalibrating ? '⚙️ CALIBRATING...' : '🔧 Sensor Monitor'}
                </Text>
            </View>

            <Text style={styles.hintText}>
                {isCalibrating ? 'Stay perfectly still while we calculate sensor biases' : 'Sensor streaming and calibrated'}
            </Text>

            {/* Show orientation visualization when not calibrating */}
            {!isCalibrating && (
                <View style={styles.vizWrapper}>
                    <OrientationViz q={trajectoryService.getOrientation()} />
                </View>
            )}

            {/* Raw sensor data display for debugging */}
            <View style={styles.rawDataContainer}>
                <Text style={styles.rawDataTitle}>Raw Sensor Data</Text>
                <Text style={styles.rawDataText}>Accel: [{data.ax.toFixed(3)}, {data.ay.toFixed(3)}, {data.az.toFixed(3)}] g</Text>
                <Text style={styles.rawDataText}>Gyro: [{data.gx.toFixed(1)}, {data.gy.toFixed(1)}, {data.gz.toFixed(1)}] dps</Text>
            </View>

            {/* Trajectory Graph (Post-Processed) */}
            <TrajectoryGraph path={trajectoryPath ?? trajectoryService.getPath()} />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: '#1E1E2E',
        borderRadius: 16,
        padding: 20,
        marginVertical: 12,
        minHeight: 200,
        justifyContent: 'center'
    },
    liftingContainer: {
        borderColor: '#1DF09F',
        borderWidth: 3,
        shadowColor: '#1DF09F',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.5,
        shadowRadius: 10,
    },
    liftingTitle: {
        color: '#1DF09F',
        fontSize: 18,
        fontWeight: '900',
        textAlign: 'center',
        letterSpacing: 2,
        marginBottom: 30
    },
    bigMetric: {
        alignItems: 'center',
        marginVertical: 20
    },
    metricLabel: {
        color: '#888',
        fontSize: 14,
        fontWeight: '700',
        letterSpacing: 1,
        marginBottom: 8
    },
    metricValue: {
        color: '#1DF09F',
        fontSize: 72,
        fontWeight: '900',
        fontFamily: 'monospace'
    },
    metricUnit: {
        color: '#888',
        fontSize: 16,
        fontWeight: '600',
        marginTop: 4
    },
    graphContainer: {
        backgroundColor: '#252535',
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        marginBottom: 20,
        borderColor: '#333',
        borderWidth: 1
    },
    title: {
        fontSize: 18,
        fontWeight: '700',
        color: '#FFFFFF',
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16
    },
    newRepButton: {
        color: '#1DF09F',
        fontSize: 14,
        fontWeight: '700',
        letterSpacing: 1
    },
    statsRow: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        marginBottom: 20,
        paddingVertical: 15,
        backgroundColor: '#252535',
        borderRadius: 12
    },
    statBox: {
        alignItems: 'center'
    },
    statLabel: {
        color: '#888',
        fontSize: 11,
        fontWeight: '600',
        marginBottom: 5
    },
    statValue: {
        color: '#FFF',
        fontSize: 24,
        fontWeight: '700',
        fontFamily: 'monospace'
    },
    noDataText: {
        fontSize: 16,
        color: '#A0A0B0',
        textAlign: 'center',
        marginBottom: 8,
    },
    hintText: {
        fontSize: 14,
        color: '#707080',
        textAlign: 'center',
        marginTop: 10,
        marginBottom: 20
    },
    controlBar: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 20
    },
    miniButton: {
        flex: 1,
        paddingVertical: 15,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
    },
    taraButton: {
        backgroundColor: '#252535',
        borderColor: '#4ECDC4',
    },
    calibButton: {
        backgroundColor: '#252535',
        borderColor: '#FF6B35',
    },
    miniButtonText: {
        color: '#FFF',
        fontWeight: '800',
        fontSize: 13,
        letterSpacing: 1
    },
    newRepButtonText: {
        color: '#1DF09F',
        fontWeight: 'bold',
        fontSize: 14
    },
    vizWrapper: {
        marginTop: 10,
        alignItems: 'center'
    },
    rawDataContainer: {
        marginTop: 20,
        padding: 15,
        backgroundColor: '#252535',
        borderRadius: 12,
        borderColor: '#333',
        borderWidth: 1
    },
    rawDataTitle: {
        color: '#1DF09F',
        fontSize: 14,
        fontWeight: '700',
        marginBottom: 10,
        letterSpacing: 1
    },
    rawDataText: {
        color: '#FFF',
        fontSize: 12,
        fontFamily: 'monospace',
        marginBottom: 5
    }
});