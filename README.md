# MOOVIA - Velocity Based Training App

Bienvenido al repositorio del proyecto **MOOVIA**. 
Esta aplicación está diseñada para el entrenamiento basado en velocidad (VBT), permitiendo a los usuarios medir, registrar y analizar su rendimiento en tiempo real utilizando sensores inerciales.

## 🛠 Tech Stack (Tecnologías)

Este proyecto utiliza tecnologías modernas para garantizar rendimiento y escalabilidad:

- **TypeScript**: El lenguaje principal. Es como JavaScript pero "con superpoderes" (tipado estático), lo que nos ayuda a prevenir errores antes de ejecutar el código y hace que el mantenimiento sea mucho más fácil.
- **React Native**: Nuestro framework para crear la aplicación móvil. Nos permite escribir el código una vez en TypeScript/JavaScript y "traducirlo" automágicamente a una aplicación nativa real para Android (y iOS en el futuro).
- **Expo**: Herramienta que facilita el desarrollo, compilación y despliegue de aplicaciones React Native.
- **Estructura Modular**: Aunque el proyecto se centra únicamente en la App Móvil, conservamos una organización limpia donde la lógica de negocio y los componentes visuales están separados en paquetes (`packages/`) reutilizables, manteniendo el código ordenado y fácil de mantener.

## 📂 Estructura del Proyecto

El proyecto sigue una arquitectura modular:

```text
c:\MOOVIA_APP\APP\
├── apps\
│   └── mobile\       # La aplicación React Native (Android) principal.
├── packages\
│   ├── domain\       # Lógica de negocio pura, compartida y sin dependencias de UI.
│   └── ui\           # Componentes visuales reutilizables (Botones, Tarjetas, etc.).
└── README.md         # Este archivo.
```

## 🚀 Requisitos Previos

Antes de empezar, asegúrate de tener instalado:

1.  **Node.js**: Entorno de ejecución para JavaScript (versión 18+ recomendada).
2.  **Java JDK 17+**: Necesario para compilar la aplicación Android.
3.  **Android SDK / Android Studio**: Para las herramientas de compilación de Android (`adb`, `gradle`).

## 💻 Configuración e Instalación

1.  **Instalar dependencias**:
    Ejecuta el siguiente comando en la raíz del proyecto para descargar todas las librerías necesarias:
    ```bash
    npm install
    ```

## 📱 Ejecutar en Desarrollo

Para iniciar el servidor de desarrollo y trabajar en la app en tiempo real:

1.  Ve a la carpeta de la aplicación móvil:
    ```bash
    cd apps/mobile
    ```
2.  Inicia el servidor de Expo:
    ```bash
    npx expo start
    ```
3.  Escanea el código QR con la app **Expo Go** en tu móvil o presiona `a` para abrir en un emulador Android.

---

## 🏗 Generar APK (Android)

Este repositorio está configurado para generar un APK de Android de forma local ("Bare Workflow").

### Comandos de Compilación

Para generar el archivo `app-debug.apk`:

#### Windows (Powershell)
```powershell
cd apps\mobile\android
.\gradlew assembleDebug
```

#### Linux / Mac
```bash
cd apps/mobile/android
./gradlew assembleDebug
```

### Ubicación del APK
Al finalizar, el instalable estará en:
`apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`

---

## 📲 Instalación en Dispositivo Físico

Una vez generado el APK, tienes dos formas de instalarlo en tu móvil Android:

### Opción 1: Transferencia USB (Sencilla)
1.  Conecta tu móvil al PC por USB.
2.  Selecciona modo **"Transferencia de archivos" (MTP)** en el móvil.
3.  Copia el archivo `app-debug.apk` a la carpeta `Downloads` (Descargas) de tu móvil.
4.  En el móvil, abre el "Gestor de Archivos", busca el APK y pulsa para instalar.

### Opción 2: ADB (Rápida para desarrolladores)
Si tienes activada la **Depuración USB** en las opciones de desarrollador de tu Android:

```powershell
adb install -r apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

---

## ℹ️ Notas Adicionales sobre la Limpieza del Repositorio

Para optimizar este entorno específicamente para Android:
- Se han eliminado carpetas no esenciales (`apps/web`, `apps/backend`).
- Se han limpiado scripts de `package.json` relacionados con iOS/Web.
- Se ha asegurado que `apps/mobile/android` esté trackeado por git para consistencia en la compilación.
