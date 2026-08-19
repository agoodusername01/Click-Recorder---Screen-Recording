@echo off
REM One-click launcher for Click Recorder - Screen Recording.
REM Double-click this file to install dependencies (first run only) and start the app.

cd /d "%~dp0"

if not exist "node_modules" (
    echo Installing dependencies, this may take a few minutes the first time...
    call npm install
    if errorlevel 1 (
        echo.
        echo Something went wrong during npm install. See the messages above.
        pause
        exit /b 1
    )
)

echo Starting Click Recorder...

REM Launched via "start" and pointed straight at the Electron binary
REM (rather than through "npm start", which keeps it tied to this
REM console) so the app becomes its own independent process. That means
REM this window can be closed immediately after - closing it won't quit
REM the app, since it's no longer attached to this console session.
start "" "node_modules\electron\dist\electron.exe" .

exit
