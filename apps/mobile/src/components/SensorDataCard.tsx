import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Dimensions, TouchableOpacity } from 'react-native';
import Svg, { Line, Circle, Polyline } from 'react-native-svg';
import { IMUSample } from '../services/ble/constants';
import { trajectoryService } from '../services/math/TrajectoryService';
import { OrientationViz } from './OrientationViz';

interface SensorDataCardProps {
    data: IMUSample | null;
}

type LiftState = 'IDLE' | 'LIFTING' | 'RESULT';

export function SensorDataCard({ data }: SensorDataCardProps) {
    const [liftState, setLiftState] = useState<LiftState>('IDLE');
    const [snapshotPath, setSnapshotPath] = useState<any[]>([]);

    // Use robust ZUPT-based detection instead of simple velocity threshold
    const isStationary = trajectoryService.isStationary();
    const isMoving = !isStationary;

    // State machine: IDLE → LIFTING → RESULT
    useEffect(() => {
        if (liftState === 'IDLE' && isMoving) {
            setLiftState('LIFTING');
            console.log('[UI] State: IDLE → LIFTING');
        }
        else if (liftState === 'LIFTING' && !isMoving) {
            // Movement stopped → Save snapshot and show result
            trajectoryService.createSnapshot();
            const correctedPath = trajectoryService.getLiftSnapshot();
            setSnapshotPath(correctedPath);
            setLiftState('RESULT');
            console.log('[UI] State: LIFTING → RESULT');
        }
    }, [isMoving, liftState]);

    if (!data) {
        return (
            <View style={styles.container}>
                <Text style={styles.noDataText}>No sensor data available</Text>
                <Text style={styles.hintText}>Start streaming to see real-time data</Text>
            </View>
        );
    }

    // --- STATE: LIFTING (Only numbers, no graph) ---
    if (liftState === 'LIFTING') {
        const path = trajectoryService.getPath();
        const currentPoint = path.length > 0 ? path[path.length - 1] : null;
        const height = currentPoint?.relativePosition.z || 0;
        const velocity = trajectoryService.getVelocity();

        return (
            <View style={[styles.container, styles.liftingContainer]}>
                <Text style={styles.liftingTitle}>⚡ RECORDING LIFT</Text>

                <View style={styles.bigMetric}>
                    <Text style={styles.metricLabel}>HEIGHT</Text>
                    <Text style={styles.metricValue}>{height.toFixed(2)}</Text>
                    <Text style={styles.metricUnit}>meters</Text>
                </View>

                <View style={styles.bigMetric}>
                    <Text style={styles.metricLabel}>VELOCITY</Text>
                    <Text style={styles.metricValue}>{velocity.z.toFixed(2)}</Text>
                    <Text style={styles.metricUnit}>m/s</Text>
                </View>
            </View>
        );
    }

    // --- STATE: RESULT (Show graph) ---
    if (liftState === 'RESULT') {
        const screenWidth = Dimensions.get('window').width;
        const GRAPH_SIZE = screenWidth - 60;
        const SCALE = 200;
        const CENTER_X = GRAPH_SIZE / 2;
        const CENTER_Y = GRAPH_SIZE;

        const toScreen = (relP: { x: number, y: number, z: number }) => {
            return {
                x: CENTER_X + (relP.x * SCALE),
                y: CENTER_Y - (relP.z * SCALE)
            };
        };

        const polylinePoints = snapshotPath.map(p => {
            const s = toScreen(p.relativePosition);
            return `${s.x},${s.y}`;
        }).join(' ');

        // Calculate max height
        const maxHeight = Math.max(...snapshotPath.map(p => p.relativePosition.z), 0);

        return (
            <View style={styles.container}>
                <View style={styles.headerRow}>
                    <Text style={styles.title}>Lift Complete</Text>
                    <TouchableOpacity onPress={() => {
                        trajectoryService.resetKinematics();
                        setLiftState('IDLE');
                        console.log('[UI] State: RESULT → IDLE');
                    }}>
                        <Text style={styles.newRepButton}>🔄 NEW REP</Text>
                    </TouchableOpacity>
                </View>

                <View style={styles.statsRow}>
                    <View style={styles.statBox}>
                        <Text style={styles.statLabel}>Max Height</Text>
                        <Text style={styles.statValue}>{maxHeight.toFixed(2)} m</Text>
                    </View>
                    <View style={styles.statBox}>
                        <Text style={styles.statLabel}>Points</Text>
                        <Text style={styles.statValue}>{snapshotPath.length}</Text>
                    </View>
                </View>

                <View style={styles.graphContainer}>
                    <Svg height={GRAPH_SIZE} width={GRAPH_SIZE}>
                        <Line x1="0" y1={CENTER_Y} x2={GRAPH_SIZE} y2={CENTER_Y} stroke="#666" strokeWidth="2" />
                        <Line x1={CENTER_X} y1="0" x2={CENTER_X} y2={GRAPH_SIZE} stroke="#444" strokeWidth="1" strokeDasharray="5,5" />

                        {polylinePoints && (
                            <Polyline
                                points={polylinePoints}
                                fill="none"
                                stroke="#1DF09F"
                                strokeWidth="4"
                            />
                        )}

                        <Circle cx={CENTER_X} cy={CENTER_Y} r="6" fill="white" stroke="#1DF09F" strokeWidth="2" />
                    </Svg>
                </View>

                <Text style={styles.hintText}>Tap NEW REP to start again</Text>
            </View>
        );
    }

    // --- STATE: IDLE (Waiting) ---
    return (
        <View style={styles.container}>
            <Text style={styles.title}>Ready to Lift</Text>
            <Text style={styles.hintText}>Start your movement when ready</Text>

            <TouchableOpacity
                style={styles.calibrateButton}
                onPress={() => {
                    trajectoryService.calibrateAsync(5000);
                    console.log('[UI] User pressed CALIBRATE');
                }}
            >
                <Text style={styles.calibrateButtonText}>⚙️ CALIBRATE SENSOR</Text>
                <Text style={styles.calibrateHint}>Place sensor still for 5 seconds</Text>
            </TouchableOpacity>

            <OrientationViz q={trajectoryService.getOrientation()} />
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
        marginTop: 10
    },
    calibrateButton: {
        backgroundColor: '#333',
        paddingVertical: 20,
        paddingHorizontal: 30,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#555',
        marginVertical: 20,
        alignItems: 'center'
    },
    calibrateButtonText: {
        color: '#FFF',
        fontWeight: '700',
        fontSize: 16,
        marginBottom: 4
    },
    calibrateHint: {
        color: '#888',
        fontSize: 12,
        fontWeight: '500'
    }
});