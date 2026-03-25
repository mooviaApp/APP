# MOOVIA — Sensor Lab

Stack para captura y análisis de levantamientos con IMU en barra. Incluye:
- **App móvil (Expo/React Native)** para conectar por BLE, mostrar métricas en vivo y exportar sesiones en JSON.
- **Web-test (Vite/TS/Chart.js)** para reprocesar los JSON exportados y visualizar trayectorias/métricas offline.
- **sensor-core** (TypeScript) con la fusión de sensores, filtros y métrica de levantamiento.

## Estructura
```
C:\MOOVIA_APP\APP
├─ apps/
│  ├─ mobile/        # App React Native + Expo Dev Client
│  └─ web-test/      # Visualizador offline de sesiones (Vite)
├─ packages/
│  └─ sensor-core/   # Fusión IMU, filtros Kalman, métricas
├─ docs/             # Informes técnicos (p.ej. iteration2-vision.pdf)
└─ package.json
```

## Requisitos
- Node.js 18+
- JDK 17+
- Android SDK / adb / Gradle (para APK)
- Expo CLI (`npm i -g expo-cli`) recomendado para dev
- TeX Live (solo si vas a compilar PDFs en `docs/`)

## Instalación de dependencias
```bash
cd C:\MOOVIA_APP\APP
npm install
```

## App móvil (Expo Dev Client)
### Desarrollo en dispositivo
```bash
cd apps\mobile
npx expo start --dev-client
```
- Escanea el QR con Expo Go/Dev Client o pulsa `a` para emulador Android.

### Generar APK debug
```powershell
cd apps\mobile\android
.\gradlew assembleDebug
```
APK: `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`

### Exportar sesión JSON (desde la app)
Botón “Export Session JSON” en la pantalla principal. Guarda en caché del dispositivo y abre diálogo de compartir si `expo-sharing` está disponible.

## Web-test (visualizador offline)
Permite cargar un JSON exportado y ver:
- Aceleración lineal, velocidad, desplazamiento vertical.
- Trayectoria 2D (X vs Z), métricas (VMP, Acel. pico, Altura máx., Lateral máx./final).

### Correr en local
```bash
cd apps\web-test
npm install      # primera vez
npm run dev -- --host
```
Abrir http://localhost:5173 y usar “Load JSON”.

### Build estático
```bash
cd apps\web-test
npm run build
```
Salida en `apps/web-test/dist`.

## sensor-core (fusión IMU)
- Ubicado en `packages/sensor-core`.
- Implementa: Madgwick + compensación de giro de manga, filtros Kalman 1D, ZUPT, métricas (altura, VMP, pico de aceleración, desviación lateral), post-procesado y export.

## Documentos
- `docs/iteration2/iteration2-vision.pdf`: visión técnica de la iteración 2 (referencia magnética/péndulo y mejoras de yaw).

## Comandos rápidos
- Limpiar y reconstruir APK: `cd apps/mobile/android && ./gradlew assembleDebug --rerun-tasks`
- Reprocesar una sesión en web-test: abrir dev server y cargar JSON exportado.

## Notas
- Compatibilidad: el protocolo BLE actual usa paquetes de 15 muestras; si se amplían campos (mag/péndulo) se versionará el decoder.
- Si el share de Android falla, la app muestra la ruta local en caché para recuperar el archivo.
