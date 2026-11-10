@echo off
setlocal
cd /d "%~dp0"
where dotnet >nul 2>nul
if errorlevel 1 (
  echo Nenalezen .NET SDK. Nainstaluj ho z https://dotnet.microsoft.com/download
  pause
  exit /b 1
)
set /p N=<build.txt
set /a N=N+1
echo Sestavuji STL Knihovna, cislo sestaveni %N% ...
if exist obj\project.assets.json del /q obj\project.assets.json
dotnet publish -c Release -r win-x64 --self-contained true -p:BuildNumber=%N% -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -p:DebugType=none -o dist\STL_Knihovna
if errorlevel 1 (
  echo.
  echo SESTAVENI SELHALO - cislo sestaveni se nezmenilo.
  pause
  exit /b 1
)
> build.txt echo %N%
echo.
echo Hotovo: dist\STL_Knihovna\STL_Knihovna.exe  (verze 1.0.%N%)
echo Slozka dist\STL_Knihovna je prenositelna - exe, wwwroot a config.json drz pohromade.
pause
