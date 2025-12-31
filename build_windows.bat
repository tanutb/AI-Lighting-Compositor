@echo off
echo Installing Build Dependencies...
pip install pyinstaller

echo Cleaning previous builds...
rmdir /s /q build
rmdir /s /q dist

echo Building Executable...
pyinstaller build.spec

echo.
echo ========================================================
echo Build Complete!
echo Your app is located in: dist\AI_Lighting_Compositor.exe
echo ========================================================
pause
