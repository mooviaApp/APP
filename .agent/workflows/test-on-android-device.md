---
description: Cómo probar la app MOOVIA en tu OnePlus 12
---

# Guía para Probar la App en OnePlus 12

Esta guía te ayudará a ejecutar la aplicación MOOVIA en tu OnePlus 12 para probar la funcionalidad BLE.

## Opción 1: Desarrollo con Expo Go (Más Rápido - RECOMENDADO para desarrollo)

### Paso 1: Preparar el OnePlus 12

1. **Habilitar Opciones de Desarrollador:**
   - Ve a `Ajustes` → `Acerca del teléfono` → `Versión`
   - Toca 7 veces en "Número de compilación" hasta que aparezca "Ahora eres un desarrollador"

2. **Habilitar Depuración USB:**
   - Ve a `Ajustes` → `Sistema` → `Opciones de desarrollador`
   - Activa `Depuración USB`
   - Activa `Instalación vía USB` (si está disponible)

3. **Conectar el teléfono al PC:**
   - Conecta tu OnePlus 12 al PC con un cable USB
   - En el teléfono, selecciona "Transferencia de archivos" o "MTP"
   - Acepta el mensaje de "¿Permitir depuración USB?"

### Paso 2: Verificar la Conexión

```bash
# Verifica que ADB detecta tu dispositivo
adb devices
```

Deberías ver algo como:
```
List of devices attached
ABC123XYZ    device
```

### Paso 3: Iniciar el Servidor de Desarrollo

```bash
# Desde la raíz del proyecto
npm run dev:mobile
```

O directamente desde la carpeta mobile:
```bash
cd apps/mobile
npm start
```

### Paso 4: Ejecutar en el Dispositivo

Cuando el servidor Expo esté corriendo, presiona `a` para abrir en Android, o escanea el código QR con la app Expo Go.

**IMPORTANTE:** Para BLE, necesitas usar la Opción 2 (build nativo) porque Expo Go tiene limitaciones con permisos BLE.

---

## Opción 2: Build Nativo (NECESARIO para BLE)

Esta es la opción que DEBES usar para probar BLE, ya que requiere permisos nativos.

### Paso 1: Preparar el OnePlus 12 (igual que Opción 1)

Sigue los pasos 1-3 de la Opción 1.

### Paso 2: Verificar Configuración de Android

```bash
# Verifica que tienes Android SDK configurado
echo $ANDROID_HOME
```

Si no está configurado, necesitas instalar Android Studio y configurar las variables de entorno.

### Paso 3: Build e Instalación Directa

// turbo
```bash
# Desde la raíz del proyecto
cd apps/mobile
npx expo run:android --device
```

Este comando:
1. Compila la aplicación nativa
2. Genera el APK
3. Lo instala automáticamente en tu OnePlus 12
4. Inicia la app

**Tiempo estimado:** 5-10 minutos la primera vez, 1-2 minutos en builds subsecuentes.

### Paso 4: Verificar Permisos BLE

Cuando la app se abra en tu OnePlus 12:
1. La app pedirá permisos de Bluetooth
2. Acepta todos los permisos
3. Ve a la pantalla de "Device" o BLE
4. Presiona "Start Scan"
5. Deberías ver tu dispositivo "MOOVIA" si está encendido

---

## Opción 3: Generar APK para Instalación Manual

Si prefieres generar un APK e instalarlo manualmente:

### Paso 1: Generar APK de Debug

```bash
cd apps/mobile/android
./gradlew assembleDebug
```

El APK se generará en:
```
apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

### Paso 2: Instalar en el OnePlus 12

```bash
# Con el teléfono conectado
adb install apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

O copia el archivo APK al teléfono y ábrelo manualmente.

---

## Solución de Problemas Comunes

### El dispositivo no aparece en `adb devices`

1. Verifica que la depuración USB está habilitada
2. Prueba con otro cable USB (algunos cables solo cargan)
3. Instala los drivers USB de OnePlus (si estás en Windows)
4. Ejecuta: `adb kill-server` y luego `adb start-server`

### Error: "ANDROID_HOME is not set"

Necesitas instalar Android Studio y configurar las variables de entorno:
```bash
# En Windows (PowerShell)
$env:ANDROID_HOME = "C:\Users\TU_USUARIO\AppData\Local\Android\Sdk"
$env:PATH += ";$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\tools"
```

### La app se cierra al intentar usar BLE

Verifica que los permisos están en el AndroidManifest.xml:
- `BLUETOOTH`
- `BLUETOOTH_ADMIN`
- `BLUETOOTH_SCAN`
- `BLUETOOTH_CONNECT`
- `ACCESS_FINE_LOCATION`

### Build falla con error de Gradle

```bash
# Limpia el proyecto
cd apps/mobile/android
./gradlew clean
cd ../../..
npm run android
```

---

## Recomendación Final

**Para desarrollo activo con BLE:**
1. Usa `npx expo run:android --device` (Opción 2)
2. Mantén el teléfono conectado
3. Los cambios de código se recargarán automáticamente (Fast Refresh)
4. Solo necesitas rebuild si cambias código nativo o permisos

**Para testing final:**
1. Genera un APK de release
2. Instálalo en el teléfono
3. Prueba sin conexión al PC

---

## Comandos Rápidos

```bash
# Ver dispositivos conectados
adb devices

# Ejecutar en dispositivo conectado
cd apps/mobile && npx expo run:android --device

# Ver logs en tiempo real
adb logcat | grep -i "moovia\|ble\|bluetooth"

# Desinstalar la app
adb uninstall com.moovia.mobile

# Reinstalar desde cero
adb uninstall com.moovia.mobile && npx expo run:android --device
```
