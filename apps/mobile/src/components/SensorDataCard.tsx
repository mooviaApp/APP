/**
 * Sensor Data Card Component
 * 
 * Displays real-time sensor readings from the MOOVIA IMU.
 */

import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { IMUSample } from '../services/ble/constants';
import { trajectoryService, TrajectoryPoint } from '../services/math/TrajectoryService';
import { OrientationViz } from './OrientationViz';

interface SensorDataCardProps {
    data: IMUSample | null;
}

export function SensorDataCard({ data }: SensorDataCardProps) {
    if (!data) {
        return (
            <View style={styles.container}>
                <Text style={styles.noDataText}>No sensor data available</Text>
                <Text style={styles.hintText}>Start streaming to see real-time data</Text>
            </View>
        );
    }

    // Get current trajectory state direct from service (since it's singleton and sync)
    // In a real app we might want a hook/subscription, but for MVP this works since we re-render on 'data' change
    const path = trajectoryService.getPath();
    const lastPoint = path[path.length - 1];
    const position = lastPoint?.position || { x: 0, y: 0, z: 0 };

    // Simple 2D Path Visualization (Top-Down X-Y)
    // Responsive Path Visualization
    const screenWidth = Dimensions.get('window').width;
    const GRAPH_SIZE = screenWidth - 60; // Padding
    const CENTER = GRAPH_SIZE / 2;

    // Scale: Map 3m range [-1.5, 1.5] to graph size
    // 300px / 3m = 100 px/m
    const SCALE = GRAPH_SIZE / 3.0;

    return (
        <View style={styles.container}>
            <Text style={styles.title}>Real-Time Sensor Data</Text>

            {/* Trajectory Viz */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Lift Profile (Side View: Z vs X)</Text>
                <View style={{ width: GRAPH_SIZE, height: GRAPH_SIZE, backgroundColor: '#2E2E3E', borderRadius: 8, overflow: 'hidden', alignSelf: 'center', marginVertical: 10 }}>
                    {/* Grid Lines */}
                    <View style={{ position: 'absolute', left: CENTER, top: 0, bottom: 0, width: 1, backgroundColor: '#444', borderStyle: 'dashed' }} />
                    <View style={{ position: 'absolute', top: CENTER, left: 0, right: 0, height: 1, backgroundColor: '#444' }} />
                    <Text style={{ position: 'absolute', right: 5, top: CENTER + 5, color: '#666', fontSize: 10 }}>Z=0 (Start)</Text>

                    {/* Path */}
                    {path.slice(-150).map((p, i) => (
                        <View
                            key={i}
                            style={{
                                position: 'absolute',
                                left: CENTER + (p.position.x * SCALE),
                                top: CENTER - (p.position.z * SCALE), // Plot Z (Height) on Vertical Axis
                                width: 2,
                                height: 2,
                                backgroundColor: i === path.length - 1 || i === 99 ? '#FFF' : '#4ECDC4',
                                borderRadius: 1,
                            }}
                        />
                    ))}
                    {/* Head */}
                    <View
                        style={{
                            position: 'absolute',
                            left: CENTER + (position.x * SCALE) - 3,
                            top: CENTER - (position.z * SCALE) - 3, // Profile View: Z is vertical
                            width: 6,
                            height: 6,
                            backgroundColor: '#FF6B6B',
                            borderRadius: 3,
                        }}
                    />
                </View>
                <Text style={styles.timestamp}>Pos: [{position.x.toFixed(2)}, {position.y.toFixed(2)}, {position.z.toFixed(2)}] m</Text>
            </View>

            {/* Accelerometer */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Accelerometer (g)</Text>
                <View style={styles.row}>
                    <DataValue label="X" value={data.ax} color="#FF6B6B" />
                    <DataValue label="Y" value={data.ay} color="#4ECDC4" />
                    <DataValue label="Z" value={data.az} color="#45B7D1" />
                </View>
            </View>

            {/* Gyroscope */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Gyroscope (dps)</Text>
                <View style={styles.row}>
                    <DataValue label="X" value={data.gx} color="#FF6B6B" />
                    <DataValue label="Y" value={data.gy} color="#4ECDC4" />
                    <DataValue label="Z" value={data.gz} color="#45B7D1" />
                </View>
            </View>

            {/* 3D Orientation Viz */}
            <OrientationViz q={trajectoryService.getOrientation()} />

            {/* Timestamp */}
            <Text style={styles.timestamp}>
                Last update: {new Date(data.timestamp).toLocaleTimeString()}
            </Text>
        </View>
    );
}

interface DataValueProps {
    label: string;
    value: number;
    color: string;
}

function DataValue({ label, value, color }: DataValueProps) {
    return (
        <View style={styles.dataValue}>
            <Text style={[styles.label, { color }]}>{label}</Text>
            <Text style={styles.value}>{value.toFixed(3)}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: '#1E1E2E',
        borderRadius: 16,
        padding: 20,
        marginVertical: 12,
    },
    title: {
        fontSize: 18,
        fontWeight: '700',
        color: '#FFFFFF',
        marginBottom: 16,
    },
    section: {
        marginBottom: 16,
    },
    sectionTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: '#A0A0B0',
        marginBottom: 8,
    },
    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    dataValue: {
        flex: 1,
        alignItems: 'center',
    },
    label: {
        fontSize: 12,
        fontWeight: '600',
        marginBottom: 4,
    },
    value: {
        fontSize: 20,
        fontWeight: '700',
        color: '#FFFFFF',
    },
    timestamp: {
        fontSize: 12,
        color: '#707080',
        textAlign: 'center',
        marginTop: 8,
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
    },
});
