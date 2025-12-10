# PowerShell script to fix Gradle sync issues
# This script handles file locking and cleanup issues

Write-Host "=== Gradle Sync Fix Script ===" -ForegroundColor Cyan
Write-Host ""

# Step 1: Stop Gradle daemons
Write-Host "Step 1: Stopping all Gradle daemon processes..." -ForegroundColor Yellow
.\gradlew --stop
Start-Sleep -Seconds 2

# Step 2: Clean the problematic expo-modules-autolinking build directory
Write-Host "Step 2: Cleaning expo-modules-autolinking build directory..." -ForegroundColor Yellow
$problematicPath = "..\node_modules\expo-modules-autolinking\android\expo-gradle-plugin\expo-autolinking-settings-plugin\build"

if (Test-Path $problematicPath) {
    Write-Host "Found problematic directory, attempting to remove..." -ForegroundColor Yellow
    
    # Try to remove with force
    try {
        Remove-Item -Path $problematicPath -Recurse -Force -ErrorAction Stop
        Write-Host "Successfully removed build directory" -ForegroundColor Green
    }
    catch {
        Write-Host "Could not remove directory automatically. Trying alternative method..." -ForegroundColor Red
        
        # Try using cmd rmdir
        $fullPath = Resolve-Path $problematicPath
        cmd /c "rmdir /s /q `"$fullPath`""
        
        if (Test-Path $problematicPath) {
            Write-Host "ERROR: Directory still exists. You may need to:" -ForegroundColor Red
            Write-Host "  1. Close Android Studio" -ForegroundColor Red
            Write-Host "  2. Pause OneDrive sync temporarily" -ForegroundColor Red
            Write-Host "  3. Manually delete: $fullPath" -ForegroundColor Red
            Write-Host "  4. Run this script again" -ForegroundColor Red
        }
        else {
            Write-Host "Successfully removed directory using cmd" -ForegroundColor Green
        }
    }
}
else {
    Write-Host "Problematic directory not found (already cleaned)" -ForegroundColor Green
}

# Step 3: Clean Gradle cache
Write-Host "Step 3: Cleaning Gradle build cache..." -ForegroundColor Yellow
if (Test-Path "build") {
    Remove-Item -Path "build" -Recurse -Force -ErrorAction SilentlyContinue
}
if (Test-Path ".gradle") {
    Remove-Item -Path ".gradle" -Recurse -Force -ErrorAction SilentlyContinue
}

# Step 4: Clean app build directory
Write-Host "Step 4: Cleaning app build directory..." -ForegroundColor Yellow
if (Test-Path "app\build") {
    Remove-Item -Path "app\build" -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "=== Cleanup Complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Try syncing Gradle in Android Studio again" -ForegroundColor White
Write-Host "  2. If it still fails, close Android Studio and run this script again" -ForegroundColor White
Write-Host "  3. Consider moving your project outside of OneDrive for better performance" -ForegroundColor White
Write-Host ""
