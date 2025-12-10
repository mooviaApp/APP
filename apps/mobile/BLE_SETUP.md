# MOOVIA BLE Setup Guide

## Overview

This guide explains how to set up and use the BLE (Bluetooth Low Energy) functionality for the MOOVIA IMU sensor (ICM-42688-P on WBZ351 microcontroller).

## Prerequisites

- Node.js and npm installed
- Expo CLI
- Physical Android or iOS device (BLE doesn't work in simulators/emulators)
- MOOVIA sensor device with firmware configured

## Installation Steps

### 1. Install Dependencies

Navigate to the mobile app directory and install dependencies:

```bash
cd apps/mobile
npm install
```

### 2. Generate Native Projects

Since we're using `react-native-ble-plx` (a native module), you need to generate native projects:

```bash
npx expo prebuild
```

This will create `ios/` and `android/` directories with native code.

> **Note**: After running `prebuild`, you can no longer use Expo Go. You'll need to use development builds or build the app natively.

### 3. Install iOS Pods (iOS only)

If you're building for iOS:

```bash
cd ios
pod install
cd ..
```

### 4. Run the App

For Android:
```bash
npx expo run:android
```

For iOS:
```bash
npx expo run:ios
```

## BLE Service Architecture

### UUIDs

- **Service UUID**: `12345678-1234-5678-1234-567812345678`
- **Characteristic 0 (Data)**: `12345678-1234-5678-1234-567800000001`
  - Properties: Read, Notify
  - Purpose: IMU sample data (ax, ay, az, gx, gy, gz)
- **Characteristic 1 (Commands)**: `12345678-1234-5678-1234-567800000002`
  - Properties: Write Without Response
  - Purpose: Send commands to device
- **Characteristic 2 (Logs)**: `12345678-1234-5678-1234-567800000003`
  - Properties: Read, Notify
  - Purpose: Log messages and WHO_AM_I responses

### Commands

| Command | Code | Description |
|---------|------|-------------|
| WHO_AM_I | 0x01 | Request sensor identification (should return 0x47) |
| Stream On | 0x02 | Start streaming IMU data |
| Stream Off | 0x03 | Stop streaming IMU data |
| Reset IMU | 0x04 | Reset and reconfigure the sensor |

### Data Format

#### IMU Sample (Characteristic 0)
13 bytes total:
- Byte 0: Message type (0x02)
- Bytes 1-2: ax (int16 little-endian)
- Bytes 3-4: ay (int16 little-endian)
- Bytes 5-6: az (int16 little-endian)
- Bytes 7-8: gx (int16 little-endian)
- Bytes 9-10: gy (int16 little-endian)
- Bytes 11-12: gz (int16 little-endian)

**Physical Units:**
- Accelerometer: ±16 g range → `(raw / 32768.0) * 16`
- Gyroscope: ±2000 dps range → `(raw / 32768.0) * 2000`

## Usage

### 1. Scan for Devices

1. Open the app
2. Tap "Start Scan"
3. Wait for MOOVIA device to appear in the list
4. Tap "Connect" on the device

### 2. Verify Sensor

After connecting:
1. Tap "WHO AM I" button
2. Check that the response shows `0x47 ✓` (ICM-42688-P identifier)

### 3. Stream Data

1. Tap "Stream On" to start receiving sensor data
2. Real-time accelerometer and gyroscope values will appear
3. Data is automatically buffered and sent to backend every ~1 second
4. Tap "Stream Off" to stop

### 4. Reset Sensor

If needed, tap "Reset IMU" to reinitialize the sensor.

## Backend Integration

### Current Status

The BLE service buffers sensor samples and prepares them for backend transmission. To complete the integration:

1. Ensure you have an active workout session and set
2. Update the backend URL in `src/services/api.ts` if needed
3. Modify `useBLE.ts` hook to call the backend API with session/set IDs

### Example Backend Integration

```typescript
// In useBLE.ts, replace the TODO in startStreaming:
backendTimerRef.current = setInterval(async () => {
  const samples = bleService.getAndClearBuffer();
  if (samples.length > 0) {
    try {
      await sendSensorBatch(
        currentSessionId,  // You need to track this
        currentSetId,      // You need to track this
        samples,
        currentDevice?.id
      );
    } catch (error) {
      console.error('Failed to send batch:', error);
    }
  }
}, 1000);
```

## Troubleshooting

### Bluetooth Permissions

**Android:**
- Ensure Location Services are enabled
- Grant all Bluetooth permissions when prompted
- On Android 12+, you need BLUETOOTH_SCAN and BLUETOOTH_CONNECT

**iOS:**
- Grant Bluetooth permission when prompted
- Check Settings > Privacy > Bluetooth if issues persist

### Device Not Found

- Ensure the MOOVIA device is powered on and advertising
- Check that the device name is exactly "MOOVIA"
- Try stopping and restarting the scan
- Move closer to the device

### Connection Issues

- Ensure only one app is trying to connect at a time
- Try resetting Bluetooth on your phone
- Power cycle the MOOVIA device
- Check that the firmware is running correctly

### WHO_AM_I Returns Wrong Value

- Expected value: `0x47` (ICM-42688-P)
- If different, check sensor wiring and I2C communication
- Try the "Reset IMU" button

## File Structure

```
apps/mobile/src/
├── services/
│   ├── ble/
│   │   ├── constants.ts       # UUIDs, commands, config
│   │   ├── dataDecoder.ts     # Data parsing utilities
│   │   └── BLEService.ts      # Main BLE service class
│   └── api.ts                 # Backend API client
├── hooks/
│   └── useBLE.ts              # React hook for BLE
├── components/
│   └── SensorDataCard.tsx     # Real-time data display
└── screens/
    └── BLEDeviceScreen.tsx    # Main BLE UI
```

## Next Steps

1. **Test with Physical Device**: Deploy to a real phone and test with your MOOVIA sensor
2. **Backend Integration**: Connect streaming data to workout sessions
3. **Data Visualization**: Add charts for velocity/power calculations
4. **Error Handling**: Improve reconnection logic and error messages
5. **Calibration**: Add sensor calibration features if needed

## Support

For issues or questions:
- Check device logs in the app
- Verify firmware is running correctly
- Ensure BLE service UUIDs match between firmware and app
