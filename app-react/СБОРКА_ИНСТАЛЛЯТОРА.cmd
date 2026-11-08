@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo  Sbornka EXE-ustanovshika BenchmarkBlock (Electron + React)
echo ============================================================

if exist node_modules goto deps_ok
echo [1/3] Ustanavlivayu zavisimosti, etap dolgiy...
call npm.cmd install --no-audit --no-fund
if errorlevel 1 goto err
goto tests

:deps_ok
echo [1/3] Zavisimosti uzhe ustanovleny, propuskayu etap.

:tests
echo [2/3] Avtotesty dvizhka...
call node scripts\selftest.mjs
if errorlevel 1 goto err

echo [3/3] Sobiraju ustanovshik NSIS...
call npm.cmd run dist
if errorlevel 1 goto err

echo.
echo Gotovo. Ustanovshik lezhit v papke dist, fajl BenchmarkBlock Setup.
start "" explorer dist
goto end

:err
echo.
echo Oshibka sborki, smotri vyvod vyshe.
pause

:end
endlocal
