# Script para generar APK con EAS Build
# Evita validaciones locales problemáticas

Write-Host "🚀 Iniciando build de MOOVIA en EAS..." -ForegroundColor Cyan
Write-Host ""

# Ir al directorio del proyecto mobile
Set-Location "C:\MOOVIA_APP\APP\apps\mobile"

# Ejecutar build en la nube (sin validación local)
Write-Host "📦 Generando APK en la nube..." -ForegroundColor Yellow
Write-Host "⏱️  Esto tomará aproximadamente 5-10 minutos" -ForegroundColor Gray
Write-Host ""

eas build --platform android --profile preview --non-interactive

Write-Host ""
Write-Host "✅ Build completado!" -ForegroundColor Green
Write-Host "📥 Descarga el APK del link que apareció arriba" -ForegroundColor Cyan
Write-Host "📱 Luego instálalo con: adb install nombre-del-archivo.apk" -ForegroundColor Cyan
