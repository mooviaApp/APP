# MOOVIA Mobile App - Source Code Documentation

## Descripción General

Este directorio contiene el código fuente de la aplicación móvil MOOVIA, desarrollada con **React Native** y **Expo**. La aplicación se comunica mediante **Bluetooth Low Energy (BLE)** con sensores IMU para capturar datos de movimiento y calcular trayectorias en tiempo real.

### Tecnologías Principales
- **React Native** 0.76.9
- **Expo** 52.0.47
- **TypeScript** 5.3.3
- **react-native-ble-plx** 3.5.0 (Comunicación BLE)
- **react-native-svg** 15.8.0 (Visualización de gráficos)

---

## Estructura de Carpetas

```
src/
├── components/          # Componentes reutilizables de UI
│   ├── OrientationViz.tsx      # Visualización de orientación 3D
│   ├── SensorDataCard.tsx      # Tarjeta de datos del sensor
│   └── TrajectoryGraph.tsx     # Gráfico de trayectoria
│
├── hooks/              # Custom React Hooks
│
├── screens/            # Pantallas de la aplicación
│
└── services/           # Lógica de negocio y servicios
    ├── ble/           # Servicio de comunicación Bluetooth
    │   ├── dataDecoder.ts      # Decodificación de datos BLE
    │   └── ...
    │
    └── math/          # Servicios matemáticos
        ├── TrajectoryService.ts # Cálculo de trayectorias
        └── ...
```

---

## Servicios Principales

### Servicio BLE (`services/ble/`)
Gestiona la comunicación Bluetooth Low Energy con los sensores IMU.

**Funcionalidades:**
- Escaneo y conexión con dispositivos BLE
- Recepción de datos del sensor (acelerómetro, giroscopio, magnetómetro)
- Decodificación de paquetes de datos binarios
- Manejo de reconexiones automáticas

**Archivo clave:** `dataDecoder.ts` - Decodifica los datos binarios recibidos del sensor.

### Servicio Matemático (`services/math/`)
Procesa los datos del sensor para calcular trayectorias y métricas de movimiento.

**Funcionalidades:**
- Cálculo de trayectorias en 3D
- Compensación de gravedad instantánea
- Filtrado de ruido y drift
- Cálculo de velocidad y aceleración

**Archivo clave:** `TrajectoryService.ts` - Implementa los algoritmos de cálculo de trayectoria.

---

## Componentes UI

### `OrientationViz.tsx`
Visualización 3D de la orientación del sensor en tiempo real.

### `SensorDataCard.tsx`
Muestra los datos del sensor (aceleración, velocidad, posición) en formato de tarjeta.

### `TrajectoryGraph.tsx`
Renderiza gráficos de la trayectoria del movimiento usando SVG.

---

## Flujo de Datos

```
Sensor IMU (BLE)
    ↓
BLE Service (recepción y decodificación)
    ↓
Math Service (procesamiento y cálculos)
    ↓
React State (useState/useEffect)
    ↓
UI Components (visualización)
```

---

## Compilación del APK

### Opción 1: Build Local con Gradle

#### Limpiar Gradle antes de compilar
```powershell
# Navegar al directorio de Android
cd C:\MOOVIA_APP\APP\apps\mobile\android

# Limpiar build anterior
.\gradlew clean

# Volver al directorio mobile
cd ..

# Compilar APK de debug
npx expo run:android --variant debug

# O compilar APK de release
cd android
.\gradlew assembleRelease
```

El APK se generará en:
```
android/app/build/outputs/apk/release/app-release.apk
```

#### Limpiar caché completo de Gradle (si hay problemas)
```powershell
# Detener daemon de Gradle
cd android
.\gradlew --stop

# Limpiar build
.\gradlew clean

# Limpiar caché de Gradle (opcional, solo si persisten problemas)
Remove-Item -Recurse -Force $env:USERPROFILE\.gradle\caches
```

### Opción 2: Build en la Nube con EAS (Recomendado)

```powershell
# Ejecutar el script de build
.\build-apk.ps1
```

O manualmente:
```powershell
# Instalar EAS CLI (solo primera vez)
npm install -g eas-cli

# Login en Expo
eas login

# Generar APK en la nube
eas build --platform android --profile preview
```

**Ventajas del build en la nube:**
- No requiere configuración local de Android SDK
- Evita problemas de dependencias
- Build consistente y reproducible
- Tiempo aproximado: 5-10 minutos

---

## Testing

```powershell
# Ejecutar tests (cuando estén configurados)
npm test

# Ejecutar en modo desarrollo
npm start
```

---

## Configuración del Entorno

### Variables de Entorno
No se requieren variables de entorno específicas para el desarrollo local.

### Permisos Necesarios (Android)
- `BLUETOOTH`
- `BLUETOOTH_ADMIN`
- `BLUETOOTH_CONNECT`
- `BLUETOOTH_SCAN`
- `ACCESS_FINE_LOCATION`

Estos permisos están configurados en `android/app/src/main/AndroidManifest.xml`.

---

## Convenciones de Código

### Nomenclatura
- **Componentes:** PascalCase (`OrientationViz.tsx`)
- **Servicios:** PascalCase con sufijo Service (`TrajectoryService.ts`)
- **Hooks:** camelCase con prefijo use (`useBluetoothConnection.ts`)
- **Utilidades:** camelCase (`dataDecoder.ts`)

### Estructura de Archivos
- Un componente por archivo
- Exportación por defecto para componentes principales
- Exportaciones nombradas para utilidades

### TypeScript
- Tipado estricto habilitado
- Interfaces para props de componentes
- Types para estructuras de datos

---

## 🔗 Dependencias Clave

| Dependencia | Versión | Propósito |
|------------|---------|-----------|
| `react-native-ble-plx` | 3.5.0 | Comunicación Bluetooth Low Energy |
| `react-native-svg` | 15.8.0 | Renderizado de gráficos vectoriales |
| `base-64` | 1.0.0 | Codificación/decodificación de datos |
| `expo` | 52.0.47 | Framework y herramientas de desarrollo |

---

## Solución de Problemas Comunes

### Error de compilación de Gradle
```powershell
cd android
.\gradlew clean
.\gradlew --stop
cd ..
npx expo run:android
```

### Error de conexión BLE
- Verificar que el Bluetooth esté activado
- Verificar permisos de ubicación (requerido para BLE en Android)
- Reiniciar la aplicación

### Problemas con caché de Metro
```powershell
npx expo start --clear
```

---

## Documentación Adicional

- **BLE_SETUP.md** - Configuración detallada del servicio BLE
- **BLE_UPDATE_20_SAMPLES.md** - Actualización del sistema de muestreo

---

## 👥 Desarrollo

Para contribuir al proyecto:

1. Mantener la estructura de carpetas existente
2. Seguir las convenciones de nomenclatura
3. Documentar funciones complejas
4. Probar en dispositivo físico (BLE no funciona en emulador)

---

**Última actualización:** Enero 2026  
**Versión:** 1.0.0
