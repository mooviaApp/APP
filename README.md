# Proyecto Android - MOOVIA

Este repositorio ha sido configurado para generar la aplicación Android de forma aislada.

## Tipo de Proyecto
Proyecto **React Native** (Estructura Monorepo con Expo Bare Workflow).
La aplicación principal se encuentra en `apps/mobile`.

## Generar APK
Para generar el APK de debug (`app-debug.apk`), ejecuta los siguientes comandos desde la raíz del proyecto:

### Windows
```powershell
cd apps\mobile\android
.\gradlew assembleDebug
```

### Linux / Mac
```bash
cd apps/mobile/android
./gradlew assembleDebug
```

## Ubicación del APK
Una vez finalizada la compilación, el archivo `.apk` se encontrará en:
`apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`

## Cambios realizados
1. **Limpieza de Plataformas**:
   - Se han eliminado las carpetas `apps/web` y `apps/backend` porque el objetivo actual es solo Android.
   - Se han eliminado scripts de `ios` y `web` en `package.json` para evitar confusiones.

2. **Configuración Android**:
   - La carpeta `apps/mobile/android` ha sido quitada del `.gitignore` para asegurar que la configuración de compilación se mantenga en el repositorio.
   - Se verificado la compatibilidad de Gradle (v8.10.2) con el JDK (Java 17+ recomendado).
   - `compileSdkVersion` ajustado a 35.

3. **Estructura**:
   - Se mantiene la estructura funcional `apps/mobile/android` para respetar la configuración de React Native/Expo.

## Instalación en dispositivo

### Opción 1: Transferencia USB (Tu pregunta)
Sí, puedes copiar el archivo manualmente:
1. Conecta tu teléfono por USB al PC.
2. En el teléfono, selecciona el modo **"Transferencia de archivos"** (o MTP).
3. Copia el archivo `app-debug.apk` desde tu PC a la carpeta `Descargas` (Downloads) de tu teléfono.
4. En el teléfono, abre tu gestor de archivos, busca el APK y pulsa para instalar.

### Opción 2: Instalación vía ADB (Más rápido)
Si tienes activada la "Depuración USB" en tu teléfono, puedes instalarlo directamente desde la terminal:

```powershell
adb install -r apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
```
