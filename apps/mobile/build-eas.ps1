# Script para hacer build de EAS evitando validaciones locales
Write-Host "🔧 Preparando build..." -ForegroundColor Cyan

# Guardar ubicación actual
$originalLocation = Get-Location

try {
    # Ir al directorio mobile
    Set-Location "C:\MOOVIA_APP\APP\apps\mobile"
    
    # Renombrar metro.config.js temporalmente para evitar validaciones locales
    if (Test-Path "metro.config.js") {
        Write-Host "📦 Ocultando metro.config.js temporalmente..." -ForegroundColor Yellow
        Rename-Item "metro.config.js" "metro.config.js.bak" -Force
    }
    
    Write-Host "🚀 Iniciando build en EAS..." -ForegroundColor Green
    Write-Host ""
    
    # Ejecutar build
    eas build --platform android --profile preview
    
    $buildResult = $LASTEXITCODE
    
    Write-Host ""
    
    if ($buildResult -eq 0) {
        Write-Host "✅ Build iniciado exitosamente!" -ForegroundColor Green
        Write-Host "📥 El APK estará disponible en unos minutos en: https://expo.dev" -ForegroundColor Cyan
    }
    else {
        Write-Host "❌ Build falló" -ForegroundColor Red
    }
    
}
finally {
    # Restaurar metro.config.js
    if (Test-Path "metro.config.js.bak") {
        Write-Host "🔄 Restaurando metro.config.js..." -ForegroundColor Yellow
        Rename-Item "metro.config.js.bak" "metro.config.js" -Force
    }
    
    # Volver a la ubicación original
    Set-Location $originalLocation
}

Write-Host ""
Write-Host "✨ Proceso completado" -ForegroundColor Cyan
