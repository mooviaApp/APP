# Actualización BLE: Paquetes Agregados de 20 Muestras

## Resumen de Cambios

Se ha actualizado el código BLE para manejar el nuevo formato del firmware que envía **20 muestras agregadas** por paquete BLE en lugar de una sola muestra.

### Cambios en el Firmware

- **ODR**: 1 kHz (1 muestra cada 1 ms)
- **Muestras por paquete**: 20 (cada 20 ms se envía un paquete)
- **Tamaño del paquete**: 241 bytes (1 byte tipo + 20 × 12 bytes)
- **MTU requerido**: 247 bytes (241 + overhead)

## Archivos Modificados

### 1. `constants.ts`

**Cambios:**
- Actualizado comentario de `MESSAGE_TYPES.SAMPLE` para reflejar 241 bytes
- Añadidas constantes:
  - `SAMPLES_PER_PACKET: 20`
  - `BYTES_PER_SAMPLE: 12`
  - `PACKET_SIZE_BYTES: 241`
  - `SAMPLE_INTERVAL_MS: 1` (1 ms por muestra)
  - `PACKET_INTERVAL_MS: 20` (20 ms por paquete)
  - `BATCH_SIZE_PACKETS: 3` (3 paquetes para acumular)
  - `BATCH_SIZE_SAMPLES: 60` (60 muestras total ≈ 60 ms)
- Añadido `REQUIRED_MTU: 247` en `BLE_CONFIG`

### 2. `dataDecoder.ts`

**Cambios principales:**
- **Renombrado**: `decodeIMUSample()` → `decodeIMUPacket()`
- **Retorno**: Ahora devuelve `IMUSample[]` (array de 20 muestras)
- **Lógica**:
  - Itera 20 veces sobre el buffer de 241 bytes
  - Cada iteración lee 12 bytes (6 valores int16 LE)
  - Calcula timestamps incrementales (baseTimestamp + i ms)
  - Convierte a unidades físicas (g y dps)

**Firma actualizada:**
```typescript
export function decodeIMUPacket(bytes: Uint8Array): IMUSample[]
```

**Tipo de retorno de `decodeNotification`:**
```typescript
IMUSample[] | LogMessage | WHOAMIResponse | null
```

### 3. `BLEService.ts`

**Cambios:**

#### Negociación MTU (líneas 219-228)
```typescript
// Request MTU for 241-byte packets
try {
    const mtu = await device.requestMTU(BLE_CONFIG.REQUIRED_MTU);
    console.log(`MTU negotiated: ${mtu} bytes`);
    if (mtu < BLE_CONFIG.REQUIRED_MTU) {
        console.warn(`MTU ${mtu} is less than required...`);
    }
} catch (error: any) {
    console.warn('MTU negotiation failed:', error.message);
}
```

#### Manejo de Notificaciones (líneas 331-360)
```typescript
private handleDataNotification(base64Data: string): void {
    const decoded = decodeNotification(base64Data);
    
    if (decoded && Array.isArray(decoded)) {
        // Array de 20 muestras
        const samples = decoded as IMUSample[];
        
        // Añadir todas las muestras al buffer
        this.sampleBuffer.push(...samples);
        
        // Emitir la última muestra para visualización en tiempo real
        if (samples.length > 0) {
            this.emit({
                type: 'dataReceived',
                data: { sample: samples[samples.length - 1] },
            });
        }
        
        // Verificar si el buffer está listo para enviar al backend
        if (this.sampleBuffer.length >= SENSOR_CONFIG.BATCH_SIZE_SAMPLES) {
            // Backend transmission handled by hook
        }
    }
}
```

## Flujo de Datos Actualizado

### Antes (Firmware v1)
```
Firmware: 1 muestra cada 20 ms
  ↓ BLE (13 bytes)
App: Recibe 1 muestra
  ↓ Buffer: Acumula 50 muestras
Backend: Envía cada ~1 segundo
```

### Ahora (Firmware v2)
```
Firmware: 20 muestras cada 20 ms (1 kHz ODR)
  ↓ BLE (241 bytes, MTU 247)
App: Recibe 20 muestras por paquete
  ↓ Buffer: Acumula 60 muestras (3 paquetes)
Backend: Envía cada ~60 ms
```

## Impacto en la UI

- **Sin cambios visibles**: La UI sigue mostrando la última muestra recibida
- **Mayor frecuencia**: Ahora se actualiza cada 20 ms (antes cada 20 ms también, pero con 1 muestra)
- **Buffer más eficiente**: Se llenan 60 muestras en 60 ms (antes 50 muestras en 1 segundo)

## Timestamps

Cada muestra dentro de un paquete recibe un timestamp incremental:
- Paquete recibido en `T`
- Muestra 0: `T + 0 ms`
- Muestra 1: `T + 1 ms`
- ...
- Muestra 19: `T + 19 ms`

Esto refleja el ODR de 1 kHz del sensor.

## Verificación

### Logs Esperados
```
Connecting to device: [device-id]
Discovering services...
MTU negotiated: 247 bytes
Notifications enabled
Successfully connected and configured
```

### Datos Recibidos
- Cada notificación debe contener 241 bytes
- Se deben decodificar 20 muestras por notificación
- El buffer debe llenarse más rápido (60 muestras en ~60 ms)

## Compatibilidad

✅ **Compatible con firmware anterior**: NO
- El firmware antiguo enviaba 13 bytes
- El nuevo firmware envía 241 bytes
- La app ahora espera 241 bytes

⚠️ **Importante**: Asegúrate de que el firmware esté actualizado antes de probar la app.

## Próximos Pasos

1. **Probar con dispositivo físico**:
   - Verificar que MTU se negocia correctamente
   - Confirmar que se reciben 20 muestras por paquete
   - Validar timestamps incrementales

2. **Optimizar batching al backend**:
   - Actualmente acumula 60 muestras (3 paquetes)
   - Puedes ajustar `BATCH_SIZE_PACKETS` según necesites

3. **Monitorear rendimiento**:
   - Verificar que no hay pérdida de paquetes
   - Confirmar que el buffer no se desborda
   - Validar latencia de transmisión al backend

## Notas Técnicas

- **MTU**: Si la negociación falla o devuelve < 247, los paquetes grandes pueden fallar
- **Timestamps**: Basados en `Date.now()` del teléfono, no del sensor
- **Buffer**: Se limpia al iniciar streaming con `startStreaming()`
- **Memoria**: 60 muestras × ~100 bytes ≈ 6 KB en memoria (muy ligero)
