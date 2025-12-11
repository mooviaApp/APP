# Guía: Generar APK con EAS Build (Expo Application Services)

## ✅ Ya completado:
- ✅ EAS CLI instalado
- ✅ Configuración `eas.json` creada
- ✅ Proyecto configurado correctamente

---

## 📋 Pasos para generar el APK:

### 1. Login en Expo (NECESARIO - Solo una vez)

Abre una terminal PowerShell normal (no en VS Code) y ejecuta:

```powershell
cd C:\MOOVIA_APP\APP\apps\mobile
eas login
```

**Opciones:**
- **Si tienes cuenta Expo**: Ingresa tu email/username y contraseña
- **Si NO tienes cuenta**: Ve a https://expo.dev/signup y créala gratis (toma 1 minuto)

---

### 2. Configurar el proyecto (NECESARIO - Solo una vez)

```powershell
eas build:configure
```

Esto configurará tu proyecto para usar EAS Build.

---

### 3. Generar el APK (Este es el comando principal)

```powershell
eas build --platform android --profile preview
```

**Qué hace:**
- ✅ Sube tu código a los servidores de Expo
- ✅ Construye el APK en un contenedor limpio con todas las dependencias correctas
- ✅ Evita TODOS los problemas de dependencias locales (metro-cache, etc.)
- ✅ Genera un APK listo para instalar

**Tiempo estimado:** 5-10 minutos

**Resultado:** Te dará un link para descargar el APK

---

### 4. Descargar e instalar el APK

Una vez que termine el build:

1. EAS te dará un link como: `https://expo.dev/artifacts/...`
2. Descarga el APK desde ese link
3. Instálalo en tu OnePlus 12:

```powershell
adb install ruta\al\archivo.apk
```

O copia el APK al teléfono y ábrelo manualmente.

---

## 🎯 Alternativa: Build local con EAS

Si prefieres hacer el build localmente (sin subir a la nube):

```powershell
eas build --platform android --profile preview --local
```

**Requisitos:**
- Docker instalado y corriendo
- Más lento que build en la nube
- Usa un contenedor local para evitar problemas de dependencias

---

## 💡 Comandos útiles

```powershell
# Ver el estado de tus builds
eas build:list

# Ver detalles de un build específico
eas build:view [BUILD_ID]

# Cancelar un build en progreso
eas build:cancel

# Ver logs de un build
eas build:logs
```

---

## 🆓 Límites del plan gratuito

- **Builds en la nube**: Limitados (suficientes para desarrollo)
- **Build local**: Ilimitados (requiere Docker)
- **Almacenamiento**: 30 días para APKs generados

---

## ⚡ Ventajas de EAS Build

1. ✅ **Sin problemas de dependencias** - Todo en contenedor limpio
2. ✅ **Reproducible** - Mismo resultado siempre
3. ✅ **Rápido** - Servidores potentes
4. ✅ **Fácil** - Un solo comando
5. ✅ **Profesional** - Usado en producción por miles de apps

---

## 🔧 Troubleshooting

### Error: "Project not configured"
```powershell
eas build:configure
```

### Error: "Not logged in"
```powershell
eas login
```

### Error: "No Android credentials"
EAS los generará automáticamente en el primer build.

---

## 📱 Después de instalar el APK

Este APK será **standalone** (no necesita Metro):
- ✅ Funciona sin conexión al PC
- ✅ Incluye todo el código JavaScript
- ✅ Listo para probar BLE
- ✅ Permisos BLE ya configurados

---

## 🚀 Comando completo (copia y pega)

```powershell
# 1. Login (solo primera vez)
eas login

# 2. Generar APK
eas build --platform android --profile preview

# 3. Esperar ~5-10 minutos

# 4. Descargar APK del link que te da

# 5. Instalar en OnePlus 12
adb install nombre-del-archivo.apk
```

---

## ✨ ¡Eso es todo!

Una vez instalado, la app funcionará completamente independiente y podrás probar BLE sin problemas.
