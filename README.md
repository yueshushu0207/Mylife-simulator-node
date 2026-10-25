# 人生模拟器 · 文字版（Node.js 版）

一款由 AI（DeepSeek）驱动的高写实**文字人生模拟游戏**。从呱呱坠地到寿终正寝，约 20-30 次关键抉择，每一次选择都在暗中改写你的七维属性——人生不是开卷考试，选择之前你看不到任何数值。

## 玩法特色

- **完整生命周期**：婴儿 → 幼年 → 童年 → 少年 → 青年 → 成年 → 壮年 → 中年 → 暮年，九大阶段，入园、中考、高考、毕业、婚恋、退休等人生节点自然触发
- **盲选机制**：选项只描述行为与一句含蓄暗示，选中后才会在"命运结算"中揭晓属性变动——一个选择未必能预见结果
- **七维属性**：健康 / 情感 / 社会 / 资产 / 学识 / 品德 / 运气；资产以"万（W）"为单位且**无上限**，其余 0-100；同一笔钱按出生年代衡量分量——1960 年代 5 万是殷实人家，2010 年代只是拮据，属性条常驻显示"同时代观感"档位
- **天赋与家境**：开局随机 2 个天赋（普通/优秀/逆天/缺陷四档）与家境，影响一生走向
- **生辰定时代**：填写出生年月日时排盘八字，锁定时代背景（1949 至今十二个年代），一生事件严格符合年代——1977 年前无高考、80 年代没有手机，物价、职业、观念皆随时代流转；八字五行还会微调初始属性
- **生辰记录**：每次写入生辰开局，服务端自动把八字信息落盘到 `data/` 目录（`bazi-records.jsonl` 完整记录 / `bazi-records.csv` 表格 / `bazi-summary.json` 统计汇总），排盘由服务端重算、不信任前端；目录已列入静态托管黑名单与 `.gitignore`，不上传 IP 等隐私
- **人生无常**：约半数事件带压力、损失或两难——投资失败、失业、重病、亲友离世……属性再高也会遭横祸，只是应对余地更大
- **AI 结局**：寿终正寝或中途病逝后，AI 为你的整段人生撰写 4 字标签、人物传记、总体评价与人生高光，并收录进"结局图鉴"
- **存档**：进度保存在浏览器 localStorage，随时继续上一段人生
- **手机端适配**：属性胶囊置顶、点击属性查看作用说明、新事件自动滚动到开头

## 架构

```
浏览器前端（原生 HTML/CSS/JS，无框架）
   │  POST /api/deepseek  { kind, state, extra }
   ▼
Node.js 后端（零依赖，server.js）
   │  固定提示词在服务端拼装（prompts.js），Key 不出服务器
   ▼
DeepSeek API（response_format: json_object）
```

- **Key 永不外泄**：前端只发送游戏场景参数，API Key 与全部系统提示词仅存于服务端
- **防盗刷**：场景白名单、请求体限 256KB、每 IP 每分钟限 30 次、max_tokens 服务端固定
- **降级兜底**：AI 超时/失败时自动使用分阶段本地事件库（年代敏感事件按当时公历年份过滤，专属年代另有降级剧情），游戏不卡死也不穿越
- **SEO 就绪**：`seo.js` 统一生成 title / description / keywords（含「岳泽霖」「金亥跃江」品牌词）/ Open Graph / JSON-LD 结构化数据，服务端启动时注入 `index.html`；内置 `/robots.txt`、`/sitemap.xml`、`favicon.svg` 与社交分享图 `og-image.png`
- **省 token 设计**：结果反馈合并进下一次事件生成，一局（约 25 轮）仅约 27 次 API 调用

## 快速开始

要求 **Node.js ≥ 14**（无需 npm install，零依赖）。

### 一键启动（推荐）

| 系统 | 方式 |
|---|---|
| Windows | 直接双击 **`start.bat`**（或在资源管理器里右键 → 打开） |
| Linux / macOS | 终端执行 **`./start.sh`**（首次需 `chmod +x start.sh`） |

脚本会自动完成：检测 Node.js → 准备 `.env`（缺失时由 `.env.example` 生成）→ 检查 DeepSeek Key 是否填写 → 启动服务 → 3 秒后自动打开浏览器。服务在前台运行，日志实时可见，**Ctrl+C 停止**。

```bash
# 自定义端口
start.bat 8080          # Windows
./start.sh 8080         # Linux / macOS

# 不想自动打开浏览器
set SKIP_BROWSER=1 && start.bat      # Windows
SKIP_BROWSER=1 ./start.sh            # Linux / macOS
```

### 手动启动

```bash
# 1. 配置 Key（去 https://platform.deepseek.com 申请）
cp .env.example .env   # 然后编辑 .env 填入你的 Key
# 或者直接设置环境变量：set DEEPSEEK_API_KEY=sk-xxx（Windows）/ export DEEPSEEK_API_KEY=sk-xxx（Linux）
# 注意：环境变量的优先级高于 .env 中的同名配置

# 2. 启动
node server.js

# 3. 浏览器打开
http://localhost:3000
```

> Windows 版脚本已按 GBK(cp936) + CRLF 保存，确保中文界面在任何 cmd 窗口都不乱码。

也可直接双击 `index.html` 离线试玩（AI 剧情将使用本地降级事件库）。

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | （必填） | DeepSeek API Key |
| `PORT` | `3000` | 服务端口 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | 兼容 OpenAI 协议的其他服务地址 |
| `DEEPSEEK_MODEL` | `deepseek-chat` | 模型名 |
| `SITE_URL` | `http://localhost:3000` | 站点对外地址（SEO canonical / sitemap / og:image 用），上线后改为实际域名 |

## 部署提示

- 公网部署务必**使用自己的 Key 并保留默认限流**，避免余额被盗刷
- 反向代理（Nginx）时注意传递客户端真实 IP，限流按 IP 计数
- 上线后在 `.env` 设置 `SITE_URL=https://你的域名`，canonical / sitemap / 分享图链接才会指向正确地址
- **SEO 收录**：把域名提交到百度站长平台 / Google Search Console；根页面验证代码占位在 `seo.js`（`baidu-site-verification`），替换后重启即可
- `data/` 目录存放玩家生辰记录（隐私），已被静态托管黑名单与 `.gitignore` 排除，请勿手动开放该目录

## 其他版本

- PHP 版（适合虚拟主机/宝塔一键部署）：见 `life-simulator-php` 仓库

## License

MIT
