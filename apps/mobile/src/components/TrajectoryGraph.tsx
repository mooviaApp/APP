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

        // 1. Determine bounding box for X (lateral) and Z (vertical)
        let minX = Infinity, maxX = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;

        // We use X for lateral deviation and Z for vertical height
        const points = path.map(p => {
            const x = p.position.x; // Lateral deviation
            const z = p.position.z; // Vertical height

            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (z < minZ) minZ = z;
            if (z > maxZ) maxZ = z;

            return { x, z };
        });

        // 2. Add padding and center horizontally
        const zRange = maxZ - minZ || 0.1;
        const xRange = maxX - minX || 0.1;

        // Ensure aspect ratio is somewhat preserved or at least readable
        // We want 0 deviation to be in the CENTER of the width
        const maxAbsX = Math.max(Math.abs(minX), Math.abs(maxX));
        const limitX = Math.max(maxAbsX, 0.1); // at least 10cm width

        // Domain for X: [-limitX, +limitX] -> centered on 0
        const domainXMin = -limitX * 1.5;
        const domainXMax = limitX * 1.5;
        const domainXRange = domainXMax - domainXMin;

        // Domain for Z: [minZ, maxZ] plus padding
        const domainZMin = minZ - (zRange * 0.1);
        const domainZMax = maxZ + (zRange * 0.1);
        const domainZRange = domainZMax - domainZMin;

        // 3. Generate SVG Path
        const svgPoints = points.map(p => {
            // Map X to width (0..width)
            const normX = (p.x - domainXMin) / domainXRange;
            const screenX = normX * width;

            // Map Z to height (0..height), inverted (screen Y goes down)
            const normZ = (p.z - domainZMin) / domainZRange;
            const screenY = height - (normZ * height);

            return { x: screenX, y: screenY };
        });

        if (svgPoints.length === 0) return null;

        let d = `M ${svgPoints[0].x},${svgPoints[0].y}`;
        for (let i = 1; i < svgPoints.length; i++) {
            d += ` L ${svgPoints[i].x},${svgPoints[i].y}`;
        }

        // Calculate center line (x=0)
        const centerNormX = (0 - domainXMin) / domainXRange;
        const centerX = centerNormX * width;

        return { d, centerX, maxX: maxAbsX, maxZ };
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
            <Text style={styles.title}>Vista Frontal (Desviación vs Altura)</Text>

            {/* Overlay Info */}
            <View style={styles.statsOverlay}>
                <Text style={styles.statText}>Var. Lateral: ±{processedPath.maxX.toFixed(2)}m</Text>
                <Text style={styles.statText}>Altura Máx: {processedPath.maxZ.toFixed(2)}m</Text>
            </View>

            <Svg height={height} width={width} viewBox={`0 0 ${width} ${height}`}>
                {/* Center Reference Line (Vertical) */}
                <Line
                    x1={processedPath.centerX}
                    y1="0"
                    x2={processedPath.centerX}
                    y2={height}
                    stroke="#333"
                    strokeWidth="1"
                    strokeDasharray="5, 5"
                />

                {/* The Bar Path */}
                <Path
                    d={processedPath.d}
                    stroke={color}
                    strokeWidth="3"
                    fill="none"
                    strokeLinecap="round" // Round ends for cleaner look
                    strokeLinejoin="round" // Smooth corners
                />

                {/* Start Point Marker */}
                <Path
                    d={`M ${width / 2 - 4},${height - 5} L ${width / 2 + 4},${height - 5}`}
                    stroke="#555"
                    strokeWidth="2"
                />
            </Svg>
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
    statsOverlay: {
        position: 'absolute',
        right: 15,
        top: 35,
        backgroundColor: 'rgba(0,0,0,0.5)',
        padding: 4,
        borderRadius: 4,
    },
    statText: {
        color: '#777',
        fontSize: 10,
        marginBottom: 2
    }
});
