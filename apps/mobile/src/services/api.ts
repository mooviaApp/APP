/**
 * Backend API Service
 * 
 * Handles communication with the MOOVIA backend for sending sensor data.
 */

import { IMUSample } from './ble/constants';

// Backend configuration
const BASE_URL = 'http://192.168.0.214:3000'; // Update with your backend URL

export interface SensorBatchPayload {
    deviceId?: string;
    samples: {
        timestamp: string;
        ax: number;
        ay: number;
        az: number;
        gx: number;
        gy: number;
        gz: number;
    }[];
}

/**
 * Send a batch of sensor samples to the backend
 * 
 * @param sessionId - Workout session ID
 * @param setId - Set ID
 * @param samples - Array of IMU samples
 * @param deviceId - Optional device identifier
 */
export async function sendSensorBatch(
    sessionId: string,
    setId: string,
    samples: IMUSample[],
    deviceId?: string
): Promise<void> {
    try {
        const payload: SensorBatchPayload = {
            deviceId,
            samples: samples.map(s => ({
                timestamp: s.timestamp,
                ax: s.ax,
                ay: s.ay,
                az: s.az,
                gx: s.gx,
                gy: s.gy,
                gz: s.gz,
            })),
        };

        const response = await fetch(
            `${BASE_URL}/workouts/${sessionId}/sets/${setId}/sensor`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Backend error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        console.log(`Successfully sent ${result.inserted} samples to backend`);

    } catch (error: any) {
        console.error('Failed to send sensor batch:', error);
        throw error;
    }
}

/**
 * Create a new workout session
 * 
 * @param userId - User ID
 * @param exercise - Exercise name
 * @returns Session object with ID
 */
export async function createWorkoutSession(
    userId: string,
    exercise: string
): Promise<{ id: string; exercise: string; date: string }> {
    try {
        const response = await fetch(`${BASE_URL}/workouts`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ userId, exercise }),
        });

        if (!response.ok) {
            throw new Error(`Failed to create session: ${response.status}`);
        }

        return await response.json();
    } catch (error: any) {
        console.error('Failed to create workout session:', error);
        throw error;
    }
}

/**
 * Add a set to a workout session
 * 
 * @param sessionId - Session ID
 * @param weight - Weight in kg
 * @param reps - Number of repetitions
 * @returns Set object with ID
 */
export async function addSet(
    sessionId: string,
    weight: number,
    reps: number
): Promise<{ id: string; weight: number; reps: number }> {
    try {
        const response = await fetch(`${BASE_URL}/workouts/${sessionId}/sets`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ weight, reps }),
        });

        if (!response.ok) {
            throw new Error(`Failed to add set: ${response.status}`);
        }

        return await response.json();
    } catch (error: any) {
        console.error('Failed to add set:', error);
        throw error;
    }
}
