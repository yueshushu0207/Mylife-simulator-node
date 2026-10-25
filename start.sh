#!/usr/bin/env bash
# ============================================================
#  人生模拟器 · 文字版（Node.js 版）—— Linux / macOS 一键启动脚本
#  出品：金亥跃江  |  作者：岳泽霖
#
#  用法：
#     ./start.sh            # 默认端口 3000，并自动打开浏览器
#     ./start.sh 8080       # 指定端口
#     SKIP_BROWSER=1 ./start.sh   # 不自动打开浏览器
#
#  停止服务：在本终端按 Ctrl+C
# ============================================================

set -uo pipefail

# 切到脚本所在目录（支持从任意位置调用）
cd "$(dirname "$0")" || exit 1

# 端口：第一个参数 > 环境变量 PORT > 默认 3000
if [ -n "${1:-}" ]; then
  PORT="$1"
fi
PORT="${PORT:-3000}"
export PORT

C_GREEN='\033[36m'; C_YELLOW='\033[33m'; C_RED='\033[31m'; C_DIM='\033[2m'; C_OFF='\033[0m'

echo ""
echo -e "${C_GREEN}  ============================================================${C_OFF}"
echo -e "${C_GREEN}     人生模拟器 · 文字版  ( Node.js 版 )${C_OFF}"
echo -e "${C_GREEN}     出品：金亥跃江    作者：岳泽霖${C_OFF}"
echo -e "${C_GREEN}  ============================================================${C_OFF}"
echo ""

# ---------- 检查 Node.js ----------
if ! command -v node >/dev/null 2>&1; then
  echo -e "${C_RED}  [错误] 未检测到 Node.js，请先安装 Node.js >= 14：https://nodejs.org${C_OFF}"
  exit 1
fi
echo -e "  [1/4] Node.js 已就绪：${C_GREEN}$(node -v)${C_OFF}"

# ---------- 准备 .env ----------
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    echo "  [2/4] 已由 .env.example 生成 .env"
  else
    echo "  [2/4] 未找到 .env / .env.example，跳过配置生成"
  fi
else
  echo "  [2/4] 已存在 .env"
fi

# ---------- 检查 DeepSeek Key 是否已填写 ----------
API_KEY=""
if [ -f .env ]; then
  API_KEY="$(grep -E '^\s*DEEPSEEK_API_KEY=' .env | head -n 1 | cut -d '=' -f 2- | tr -d '\r')"
fi
if [ -z "$API_KEY" ] || [ "$API_KEY" = "sk-YOUR_KEY_HERE" ]; then
  echo -e "  ${C_YELLOW}[警告] .env 中 DEEPSEEK_API_KEY 尚未填写，AI 剧情将走本地降级事件库。${C_OFF}"
  echo -e "         ${C_YELLOW}请编辑 .env 填入 Key（申请地址：https://platform.deepseek.com）${C_OFF}"
else
  echo "  [3/4] DeepSeek Key 已配置"
fi

echo "  [4/4] 正在启动服务，端口：${PORT}"
echo ""
echo -e "  浏览器访问：${C_GREEN}http://localhost:${PORT}${C_OFF}"
echo -e "  停止服务：${C_DIM}在本终端按 Ctrl+C${C_OFF}"
echo ""

# ---------- 延迟打开浏览器 ----------
if [ -z "${SKIP_BROWSER:-}" ]; then
  ( sleep 2
    if command -v open >/dev/null 2>&1; then
      open "http://localhost:${PORT}"
    elif command -v xdg-open >/dev/null 2>&1; then
      xdg-open "http://localhost:${PORT}" >/dev/null 2>&1
    fi
  ) >/dev/null 2>&1 &
fi

# ---------- 启动服务（前台运行，便于查看日志与 Ctrl+C 停止） ----------
exec node server.js
