@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo 서버 PC에는 Node.js 24 LTS가 필요합니다. README.md의 처음 설치 항목을 확인하세요.
 pause
 exit /b 1
)
node --env-file-if-exists=.env server/start.mjs
pause
