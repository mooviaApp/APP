/**
 * Sensor Data Card Component
 * 
 * Displays real-time sensor readings from the MOOVIA IMU.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { IMUSample } from '../services/ble/constants';

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

    return (
        <View style={styles.container}>
            <Text style={styles.title}>Real-Time Sensor Data</Text>

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
