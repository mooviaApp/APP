/**
 * Sensor Data Card Component
 * 
 * Displays real-time sensor readings from the MOOVIA IMU.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Svg, { Line, Circle, Polyline, G, Text as SvgText } from 'react-native-svg';
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

    // Snapshot State
    const liftSnapshot = trajectoryService.getLiftSnapshot();
    const hasSnapshot = trajectoryService.hasLiftSnapshot();

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

            {/* Trajectory Viz (SVG) - LIVE VIEW */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Live Trajectory</Text>
                <View style={{ width: GRAPH_SIZE, height: GRAPH_SIZE, backgroundColor: '#2E2E3E', borderRadius: 8, alignSelf: 'center', marginVertical: 10 }}>
                    <Svg height={GRAPH_SIZE} width={GRAPH_SIZE}>
                        {/* Grid & Reference Lines */}
                        <Line x1={CENTER} y1="0" x2={CENTER} y2={GRAPH_SIZE} stroke="#444" strokeWidth="1" strokeDasharray="4 4" />
                        <Line x1="0" y1={CENTER} x2={GRAPH_SIZE} y2={CENTER} stroke="#444" strokeWidth="1" />
                        <SvgText x={GRAPH_SIZE - 5} y={CENTER + 12} fill="#666" fontSize="10" textAnchor="end">Z=0 (Start)</SvgText>

                        {/* Trajectory Path (Last 150 points for performance) */}
                        <Polyline
                            points={path.slice(-150).map(p => {
                                // Use auto-detected vertical axis for height
                                const vertAxis = (trajectoryService as any).verticalAxis || 2;
                                const vertSign = (trajectoryService as any).verticalSign || 1;
                                const height = vertAxis === 0 ? p.position.x * vertSign :
                                    (vertAxis === 1 ? p.position.y * vertSign : p.position.z * vertSign);
                                const deviation = vertAxis === 0 ? p.position.y : p.position.x;

                                const x = CENTER + (deviation * SCALE);
                                const y = CENTER - (height * SCALE); // Height is vertical
                                return `${x},${y}`;
                            }).join(' ')}
                            fill="none"
                            stroke="#1DF09F"
                            strokeWidth="2"
                        />

                        {/* Head Indicator */}
                        <Circle
                            cx={CENTER + (((trajectoryService as any).verticalAxis === 0 ? position.y : position.x) * SCALE)}
                            cy={CENTER - ((((trajectoryService as any).verticalAxis || 2) === 0 ? position.x :
                                (((trajectoryService as any).verticalAxis || 2) === 1 ? position.y : position.z)) *
                                (((trajectoryService as any).verticalSign || 1)) * SCALE)}
                            r="4"
                            fill="#FF6B6B"
                            stroke="#FFF"
                            strokeWidth="1"
                        />
                    </Svg>
                </View>
                <Text style={styles.timestamp}>Pos: [{position.x.toFixed(2)}, {position.y.toFixed(2)}, {position.z.toFixed(2)}] m</Text>
            </View>

            {/* Snapshot View - Only shown after lift completes */}
            {hasSnapshot && (
                <View style={styles.section}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={styles.sectionTitle}>Last Lift Snapshot</Text>
                        <Text
                            style={styles.clearButton}
                            onPress={() => trajectoryService.clearLiftSnapshot()}
                        >
                            Clear
                        </Text>
                    </View>
                    <View style={{ width: GRAPH_SIZE, height: GRAPH_SIZE, backgroundColor: '#2E2E3E', borderRadius: 8, alignSelf: 'center', marginVertical: 10 }}>
                        <Svg height={GRAPH_SIZE} width={GRAPH_SIZE}>
                            {/* Grid */}
                            <Line x1={CENTER} y1="0" x2={CENTER} y2={GRAPH_SIZE} stroke="#444" strokeWidth="1" strokeDasharray="4 4" />
                            <Line x1="0" y1={CENTER} x2={GRAPH_SIZE} y2={CENTER} stroke="#666" strokeWidth="2" />
                            <SvgText x={GRAPH_SIZE - 5} y={CENTER + 12} fill="#888" fontSize="10" textAnchor="end">Floor</SvgText>

                            {/* Snapshot Trajectory (Downsampled for performance) */}
                            <Polyline
                                points={liftSnapshot.filter((_, i) => i % 2 === 0).map(p => {
                                    const vertAxis = (trajectoryService as any).verticalAxis || 2;
                                    const vertSign = (trajectoryService as any).verticalSign || 1;
                                    const height = vertAxis === 0 ? p.position.x * vertSign :
                                        (vertAxis === 1 ? p.position.y * vertSign : p.position.z * vertSign);
                                    const deviation = vertAxis === 0 ? p.position.y : p.position.x;

                                    const x = CENTER + (deviation * SCALE);
                                    const y = CENTER - (height * SCALE);
                                    return `${x},${y}`;
                                }).join(' ')}
                                fill="none"
                                stroke="#FFD700"
                                strokeWidth="2"
                            />
                        </Svg>
                    </View>
                    <Text style={styles.timestamp}>
                        Duration: {(liftSnapshot.length / 1000).toFixed(2)}s | Points: {liftSnapshot.length}
                    </Text>
                </View>
            )}

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
        color: '#666',
        fontSize: 11,
        marginTop: 4,
        textAlign: 'center',
        fontFamily: 'monospace',
    },
    statusBadge: {
        fontSize: 11,
        color: '#888',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
        backgroundColor: '#333',
    },
    statusActive: {
        color: '#FF6B6B',
        backgroundColor: '#3E2020',
    },
    clearButton: {
        fontSize: 12,
        color: '#1DF09F',
        paddingHorizontal: 8,
        paddingVertical: 4,
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
