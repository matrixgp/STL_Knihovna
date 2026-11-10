@echo off
cd /d "%~dp0"
where dotnet >nul 2>nul
if errorlevel 1 (
  echo Nenalezen .NET SDK. Nainstaluj ho z https://dotnet.microsoft.com/download
  echo Nebo spust alternativu: node dev\server.mjs
  pause
  exit /b 1
)
rem smaze starou cache obnoveni (po zmene verze .NET)
if exist obj\project.assets.json del /q obj\project.assets.json
echo Spoustim STL Knihovnu ...
dotnet run -c Release -- %*
pause
