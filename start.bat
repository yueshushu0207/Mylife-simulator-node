@echo off
chcp 936 >nul 2>&1
setlocal
REM ============================================================
REM  人生模拟器 · 文字版（Node.js 版）—— Windows 一键启动脚本
REM  出品：金亥跃江    作者：岳泽霖
REM
REM  用法：
REM    1）在资源管理器里双击 start.bat，默认端口 3000，自动打开浏览器
REM    2）指定端口：start.bat 8080
REM    3）不想自动打开浏览器：先执行 set SKIP_BROWSER=1，再运行 start.bat
REM
REM  停止服务：在本窗口按 Ctrl+C，或直接关闭窗口
REM ============================================================

title 人生模拟器 - Node 版

REM 切到脚本所在目录（支持从任意位置调用）
cd /d "%~dp0"

REM ---------- 端口优先级：第 1 个参数 优先于 环境变量 PORT，默认 3000 ----------
if not "%~1"=="" set "PORT=%~1"
if "%PORT%"=="" set "PORT=3000"

echo.
echo   ============================================================
echo      人生模拟器 · 文字版  ^( Node.js 版 ^)
echo      出品：金亥跃江    作者：岳泽霖
echo   ============================================================
echo.

REM ---------- 检查 Node.js ----------
where node >nul 2>nul
if errorlevel 1 (
    echo   [错误] 未检测到 Node.js，请先安装 Node.js ^>= 14：https://nodejs.org
    echo         安装完成后重新双击本脚本即可。
    echo.
    pause
    exit /b 1
)

for /f "delims=" %%V in ('node -v 2^>nul') do set "NODE_VER=%%V"
echo   [1/4] Node.js 已就绪：%NODE_VER%

REM ---------- 准备 .env ----------
if not exist ".env" (
    if exist ".env.example" (
        copy /y ".env.example" ".env" >nul
        echo   [2/4] 已由 .env.example 生成 .env
    ) else (
        echo   [2/4] 未找到 .env / .env.example，跳过配置生成
    )
) else (
    echo   [2/4] 已存在 .env
)

REM ---------- 检查 DeepSeek Key 是否已填写 ----------
set "API_KEY="
if exist ".env" (
    for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
        if "%%A"=="DEEPSEEK_API_KEY" set "API_KEY=%%B"
    )
)
set "KEY_UNSET="
if not defined API_KEY set "KEY_UNSET=1"
if "%API_KEY%"=="" set "KEY_UNSET=1"
if "%API_KEY%"=="sk-YOUR_KEY_HERE" set "KEY_UNSET=1"
if defined KEY_UNSET (
    echo   [警告] .env 中 DEEPSEEK_API_KEY 尚未填写，AI 剧情将走本地降级事件库。
    echo          请编辑 .env 填入 Key（申请地址：https://platform.deepseek.com）
) else (
    echo   [3/4] DeepSeek Key 已配置
)

echo   [4/4] 正在启动服务，端口：%PORT%
echo.
echo   浏览器访问：http://localhost:%PORT%
echo   停止服务：在本窗口按 Ctrl+C
echo.

REM ---------- 延迟 3 秒自动打开浏览器（SKIP_BROWSER=1 时跳过） ----------
if "%SKIP_BROWSER%"=="" (
    where powershell >nul 2>nul
    if not errorlevel 1 (
        start "" /min powershell -NoProfile -Command "Start-Sleep -Seconds 3; Start-Process 'http://localhost:%PORT%'"
    )
)

node server.js

echo.
echo   服务已停止。按任意键关闭窗口……
pause >nul
endlocal
