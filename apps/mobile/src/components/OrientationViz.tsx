import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface OrientationVizProps {
    q: { w: number, x: number, y: number, z: number };
}

export function OrientationViz({ q }: OrientationVizProps) {
    // Quaternion to Euler Angles (Roll, Pitch, Yaw)
    // Conversion to Tai-Bryan angles (Z-Y-X)

    // roll (x-axis rotation)
    const sinr_cosp = 2 * (q.w * q.x + q.y * q.z);
    const cosr_cosp = 1 - 2 * (q.x * q.x + q.y * q.y);
    const roll = Math.atan2(sinr_cosp, cosr_cosp);

    // pitch (y-axis rotation)
    const sinp = 2 * (q.w * q.y - q.z * q.x);
    let pitch: number;
    if (Math.abs(sinp) >= 1)
        pitch = Math.sign(sinp) * Math.PI / 2; // use 90 degrees if out of range
    else
        pitch = Math.asin(sinp);

    // yaw (z-axis rotation)
    const siny_cosp = 2 * (q.w * q.z + q.x * q.y);
    const cosy_cosp = 1 - 2 * (q.y * q.y + q.z * q.z);
    const yaw = Math.atan2(siny_cosp, cosy_cosp);

    // Convert to degrees
    const rDeg = roll * (180 / Math.PI);
    const pDeg = pitch * (180 / Math.PI);
    const yDeg = yaw * (180 / Math.PI);

    return (
        <View style={styles.container}>
            <Text style={styles.label}>Orientation (Roll/Pitch/Yaw)</Text>
            <View style={styles.scene}>
                <View
                    style={[
                        styles.object,
                        {
                            transform: [
                                { perspective: 1000 },
                                { rotateX: `${rDeg}deg` },
                                { rotateY: `${pDeg}deg` },
                                { rotateZ: `${yDeg}deg` }
                            ]
                        }
                    ]}
                >
                    {/* Cylinder Body (Visualized as a disk/box) */}
                    <View style={styles.faceFront}><Text style={styles.faceText}>FRONT</Text></View>
                    <View style={styles.axisX} />
                    <View style={styles.axisY} />
                </View>
            </View>
            <Text style={styles.values}>
                R: {rDeg.toFixed(1)}° | P: {pDeg.toFixed(1)}° | Y: {yDeg.toFixed(1)}°
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        alignItems: 'center',
        marginVertical: 10,
    },
    label: {
        color: '#A0A0B0',
        fontSize: 12,
        marginBottom: 8,
    },
    values: {
        color: '#FFF',
        fontSize: 12,
        marginTop: 8,
        fontFamily: 'monospace',
    },
    scene: {
        width: 120,
        height: 120,
        backgroundColor: '#2E2E3E',
        borderRadius: 60,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 2,
        borderColor: '#444',
    },
    object: {
        width: 80,
        height: 80,
        backgroundColor: 'rgba(80, 31, 240, 0.5)',
        borderRadius: 40,
        borderWidth: 2,
        borderColor: '#1DF09F',
        justifyContent: 'center',
        alignItems: 'center',
    },
    faceFront: {
        position: 'absolute',
        top: 5,
    },
    faceText: {
        fontSize: 8,
        color: 'white',
        fontWeight: 'bold',
    },
    axisX: { position: 'absolute', width: 60, height: 2, backgroundColor: '#FF6B6B' },
    axisY: { position: 'absolute', width: 2, height: 60, backgroundColor: '#4ECDC4' },
});
