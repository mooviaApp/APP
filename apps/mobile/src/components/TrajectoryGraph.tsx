import React, { useMemo } from 'react';
import { View, StyleSheet, Dimensions, Text } from 'react-native';
import Svg, { Path, Line, Text as SvgText } from 'react-native-svg';
import { TrajectoryPoint } from '../services/math/TrajectoryService';

interface TrajectoryGraphProps {
    path: TrajectoryPoint[];
    height?: number;
    width?: number;
    color?: string;
}

export function TrajectoryGraph({
    path,
    height = 200,
    width = Dimensions.get('window').width - 40,
    color = '#1DF09F'
}: TrajectoryGraphProps) {

    const processedPath = useMemo(() => {
        if (!path || path.length < 2) return null;

        // Extract vertical position (Z usually, or Y depending on frame)
        // Based on VBT logs, Y seems to be the vertical axis detected, 
        // but let's assume we want to plot the dominant movement axis.
        // For simplicity in this graph, we'll plot the magnitude of displacement or just Z.
        // Given the logs showed Y as vertical, we'll try to plot Y.
        // Or better yet, plot the "vertical" component relative to start.

        // Let's iterate to find min/max for scaling
        let minVal = Infinity;
        let maxVal = -Infinity;
        let startTime = path[0].timestamp;
        let endTime = path[path.length - 1].timestamp;

        const points = path.map(p => {
            // Use Z as Vertical Axis (World Frame is Z-up)
            const val = p.position.z;
            if (val < minVal) minVal = val;
            if (val > maxVal) maxVal = val;
            return { t: p.timestamp, v: val };
        });

        // Add some padding
        const range = maxVal - minVal;
        const padding = range * 0.1 || 0.1; // fallback if range is 0
        const yMin = minVal - padding;
        const yMax = maxVal + padding;
        const yRange = yMax - yMin;

        const timeRange = endTime - startTime;
        if (timeRange <= 0) return null;

        // Create SVG Path command
        let d = `M 0,${height}`; // Start at bottom-left (approx)

        const svgPoints = points.map(p => {
            const x = ((p.t - startTime) / timeRange) * width;
            // SVM Y coordinates: 0 is top, height is bottom. 
            // We want positive values to go UP.
            // Normalized value (0 to 1): (val - yMin) / yRange
            // Screen Y: height - (norm * height)
            const normalizedY = (p.v - yMin) / yRange;
            const y = height - (normalizedY * height);
            return { x, y };
        });

        if (svgPoints.length > 0) {
            d = `M ${svgPoints[0].x},${svgPoints[0].y}`;
            for (let i = 1; i < svgPoints.length; i++) {
                d += ` L ${svgPoints[i].x},${svgPoints[i].y}`;
            }
        }

        return { d, yMin, yMax };
    }, [path, height, width]);

    if (!path || path.length === 0) {
        return (
            <View style={[styles.container, { height, width, justifyContent: 'center', alignItems: 'center' }]}>
                <Text style={styles.placeholderText}>No Valid Trajectory Data</Text>
            </View>
        );
    }

    if (!processedPath) {
        return (
            <View style={[styles.container, { height, width, justifyContent: 'center', alignItems: 'center' }]}>
                <Text style={styles.placeholderText}>Insufficient Data points</Text>
            </View>
        );
    }

    return (
        <View style={[styles.container, { height, width }]}>
            <Text style={styles.title}>Vertical Trajectory (Z)</Text>
            <Svg height={height} width={width} viewBox={`0 0 ${width} ${height}`}>
                {/* Zero Line (if within range) */}
                {/* We map 0 value to Y pixels */}

                {/* Grid lines or decoration could go here */}

                {/* The Trajectory Path */}
                <Path
                    d={processedPath.d}
                    stroke={color}
                    strokeWidth="3"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            </Svg>
            <View style={styles.labels}>
                <Text style={styles.label}>{processedPath.yMin.toFixed(2)}m</Text>
                <Text style={styles.label}>{processedPath.yMax.toFixed(2)}m</Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: '#151520',
        borderRadius: 12,
        overflow: 'hidden',
        marginTop: 16,
        padding: 10
    },
    title: {
        color: '#A0A0B0',
        fontSize: 12, // Small title
        marginBottom: 5,
        textAlign: 'center'
    },
    placeholderText: {
        color: '#555',
        fontSize: 14,
        fontStyle: 'italic'
    },
    labels: {
        position: 'absolute',
        right: 10,
        top: 10,
        bottom: 10,
        justifyContent: 'space-between',
        alignItems: 'flex-end'
    },
    label: {
        color: '#777',
        fontSize: 10
    }
});
