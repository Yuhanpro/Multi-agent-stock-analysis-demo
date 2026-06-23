# stock-web

交互式多智能体股票分析 demo。输入股票代码,看着各个智能体相互辩论。底层由 **DeepSeek V4** + **TradingAgents** 多智能体框架 + 巴菲特风格价值投资 skill 驱动。

> **研究 demo。** 不构成投资建议。本站旨在展示当生产级 LLM 智能体框架接入面向公众的 UI 时能做到什么 —— 不用于推荐交易。

---

## 功能介绍

四种模式共用同一个股票代码输入框(美股走 yfinance/Akshare fallback,A 股走 akshare):

| 模式 | 流水线 | 延迟 | 单次成本 |
|---|---|---|---|
| **Snapshot** | yfinance / akshare → JSON | ~1 s | $0 |
| **Buffett Quick** | snapshot + 158k 字符巴菲特 skill prompt → DeepSeek V4-Flash | ~30-60 s | ~$0.003-0.01 |
| **Serenity Scan** | snapshot + Serenity 产业链/供应链瓶颈 prompt → DeepSeek V4-Flash | ~50-80 s | ~$0.003-0.01 |
| **TradingAgents Debate** | LangGraph 多智能体:市场 / 新闻 / 基本面分析师 → 多空对辩 → 交易员 → 4-agent 风险辩论 → 最终决策 | 3-6 分钟 | ~$0.20-0.30 |

前端通过 Server-Sent Events 渲染四种模式:

- Buffett Quick / Serenity Scan 像 ChatGPT 一样**逐 token** 流式输出
- Debate 模式**逐智能体**流式输出:每个分析师卡片在完成后亮起,接着多空 / 风险回合按时间线依次展开,最后呈现一张包含目标价 / 止损 / 仓位建议的主结论卡片

双语支持(English + 简体中文)—— 右上角切换;所有智能体输出都在 LLM 层用所选语言直接生成,而非事后翻译。

---

## 技术栈

```
[Browser] ──HTTPS/SSE──→ [nginx] ──→ [FastAPI] ──→ DeepSeek V4 API
                            │            │
                            │            ├─→ TradingAgents (LangGraph)
                            │            ├─→ yfinance / akshare
                            │            └─→ Redis (限流 + 每日预算)
                            │
                            └─→ static Next.js export (前端)
```

- **Backend** —— FastAPI + uv 管理的 Python 3.12。通过 `sse-starlette` 推送 SSE。158k 字符的巴菲特 system prompt 一次加载、反复复用(DeepSeek 上下文缓存让重复调用成本降低约 3 倍)。TradingAgents 以 vendor 方式内置(参见 `backend/vendor/README.md`)。
- **Frontend** —— Next.js 14 App Router + Tailwind 3 + recharts。`output: "export"` 生成静态 HTML/JS —— 运行时不依赖任何 Node 进程。
- **Deployment** —— 单台 Linux VPS 上裸跑 systemd,不使用 Docker。详见 [DEPLOY.md](./DEPLOY.md)。

---

## 本地开发

### 一次性配置

```powershell
# 1. 克隆 TradingAgents 到本仓库旁边
#    (backend 的 pyproject.toml 期望路径为 ./vendor/TradingAgents)
git clone https://github.com/<TradingAgents-upstream>/TradingAgents.git
cd stock-web/backend
robocopy ..\..\TradingAgents vendor\TradingAgents /E `
    /XD .git .venv __pycache__ logs cache `
    /XF *.pyc .env

# 2. 安装后端依赖(需要 Python 3.12)
uv sync

# 3. 安装前端依赖(需要 Node 20+)
cd ..\frontend
npm install
```

### 运行

开两个终端:

```powershell
# 终端 1 —— 后端
cd stock-web\backend
$env:DEEPSEEK_API_KEY = "sk-..."
uv run uvicorn app.main:app --port 8000 --reload

# 终端 2 —— 前端
cd stock-web\frontend
npm run dev
```

浏览器打开 → http://localhost:3000

### 获取 DeepSeek API key

[platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys) —— 快速分析每次约 $0.01,深度辩论每次约 $0.20-0.30。

---

## 仓库布局

```
stock-web/
├── backend/                       # FastAPI + Python 3.12 (uv 管理)
│   ├── app/
│   │   ├── main.py                # FastAPI 应用, CORS, /healthz
│   │   ├── config.py              # 环境变量加载器 (Settings dataclass)
│   │   ├── routes/
│   │   │   ├── snapshot.py        # GET  /api/snapshot
│   │   │   ├── quick.py           # POST /api/quick   (SSE)
│   │   │   └── debate.py          # POST /api/debate  (SSE)
│   │   ├── services/
│   │   │   ├── market_data.py     # yfinance + akshare
│   │   │   ├── skill_runner.py    # buffett skill → DeepSeek 流式输出
│   │   │   ├── tradingagents_runner.py  # LangGraph 流 → SSE 事件
│   │   │   ├── rate_limit.py      # 按 IP 滑动窗口限流
│   │   │   └── budget.py          # 每日美元上限 (Redis 或内存)
│   │   └── prompts/buffett/       # SKILL.md + 8 个参考文件
│   ├── vendor/                    # TradingAgents 源码 (已 gitignore)
│   └── pyproject.toml             # 路径依赖到 vendor/TradingAgents
│
├── frontend/                      # Next.js 14 (App Router)
│   ├── app/
│   │   ├── layout.tsx             # I18nProvider 包裹
│   │   └── page.tsx               # 模式选择器 + 状态机
│   ├── components/
│   │   ├── stock-input.tsx        # 美股/A股切换 + 股票代码
│   │   ├── snapshot-card.tsx      # K 线图 + 6 项基本面指标
│   │   ├── quick-result.tsx       # token 流式 markdown
│   │   ├── debate-stream.tsx      # agent 时间线 + 主结论卡片
│   │   └── language-switcher.tsx  # EN / 中文
│   └── lib/
│       ├── sse.ts                 # SSE-over-POST 客户端 (fetch+ReadableStream)
│       ├── i18n.tsx               # Context + 字典 (不用 i18next; 约 150 个 key)
│       ├── api.ts                 # fetch 封装, NEXT_PUBLIC_API_BASE
│       └── format.ts              # 数字/百分比/价格格式化 + cn()
│
├── deploy/                        # 生产环境的 systemd + nginx
│   ├── setup-server.sh            # 全新 VPS 上的一次性初始化
│   ├── install.sh                 # 幂等部署 / 重新部署
│   ├── stock-web-backend.service  # systemd unit, 已做安全加固
│   └── nginx.conf                 # 针对 SSE 调优的反向代理
│
├── docs/
│   ├── PLAN.md                    # 完整设计 / 架构 / 走过的弯路
│   └── SKILL.md                   # 用于延续开发的 Claude Code skill
│
├── DEPLOY.md                      # 分步部署 + ICP 备案说明
└── README.md                      # 当前文件
```

---

## 关键设计决策

- **不用 Docker。** systemd + nginx + uv 直接运行。在小型 VPS 上节省约 250 MB 内存,调试更简单(`journalctl` vs `docker logs`),没有需要照看的守护进程。代价(更弱的环境隔离)在单租户的 demo 机器上无关紧要。
- **SSE-over-POST。** 浏览器 `EventSource` 只支持 GET;我们在 `frontend/lib/sse.ts` 中手动解析 `event:` / `data:` 帧,这样 `/api/quick` 和 `/api/debate` 就能接收 JSON 请求体。调优了 nginx 超时并关闭了缓冲 —— debate 运行约 5 分钟,否则会撞上默认的 60 s `proxy_read_timeout`。
- **限流器在校验*之后*运行。** slowapi 的装饰器在 handler 入口运行,因此一个拼错的 ticker 也会消耗额度;我们使用自定义的滑动窗口限流器,在 snapshot 预取成功 *之后* 显式调用。
- **TradingAgents 流模式。** LangGraph 发出的是完整状态快照(`stream_mode="values"`),而不是增量。runner 对相邻 chunk 做 diff 来检测 "agent N 刚刚填入了 `market_report`" → 发出 `agent_complete` SSE 事件。流式粒度是 per-agent 而非 per-token,因为图在每个 agent 的完整 LLM 调用上阻塞。
- **巴菲特 skill 整体作为一个超大 system prompt 加载。** SKILL.md + references/*.md 共计 158k 字符。启动时内联;DeepSeek 的隐式上下文缓存让重复调用便宜约 3 倍。

---

## 暂未实现

- 无用户账号。每 IP 速率限制 + 全局每日 $ 预算上限,无需注册即可阻止滥用。
- 无历史记录 / 保存的分析。即用即走。
- 无回测。输出是定性分析,不是可交易信号。
- `quick` 在缓存未命中时,前 ~30 个字符之后无流式输出(DeepSeek 的首 token 延迟所致)。

---

## 工作日志

倒序排列。新条目置顶。每条:日期 · 交付内容 · 阻塞项。

### 2026-06-23 — A 股成长性指标补全

交付内容:

- **A 股营收/净利同比** —— `_cn_snapshot` 新增 `stock_financial_abstract` 数据源,补齐此前 A 股缺失的成长性字段:营业总收入、归母净利润,以及营业总收入同比增长率、归属母公司净利润同比增长率。前端"增长"区(营收增长 / 净利增长)对 A 股不再空白。
- **口径一致性** —— 营收/净利及其同比从**同一报告期列**读取(最新非空期,通常为最新季度),保证数字与其同比口径一致;`source_detail` 标注所用报告期(如 `stock_financial_abstract (20260331)`)。
- **eps 兜底取年报值** —— 当 EM 财务指标接口缺失时,用 `stock_financial_abstract` 的**最新年报(12-31)**每股收益兜底,避免把单季累计 EPS 当成滚动 EPS 显示(如茅台兜底为全年 65.66 而非 Q1 的 21.76)。
- **数据源选型** —— 选 `stock_financial_abstract`(返回原始元 float)而非 `stock_financial_abstract_ths`(金额为 "6.28亿" 字符串,`_safe_float` 无法解析)。同比值为百分数,统一 `/100` 转 decimal。整段包在 try/except + `or` 合并里,接口不可用时静默降级,不影响既有字段。
- **前端口径脚注更新** —— Snapshot 底部口径说明补上 A 股:"A股/美股增长为同比(A股取最新报告期),港股为滚动增长"。
- **验证** —— 对 600519(茅台,消费)与 000001(平安银行,金融)实测提取逻辑:营收同比 +6.34% / +4.65%,净利同比 +1.47% / +3.03%,eps 取年报值正确,单位口径核对无误。
- **已部署到公网并验证** —— tarball 上传 + 后端 rsync 到 `/opt/stock-web` + 重启 `stock-web-backend`(`~/stock-web` 部署源同步更新,避免下次 install.sh 回滚);`http://47.93.21.132:18080` 上 600519 快照部署前 `revenue/eps` 全空,部署后补上营收 547.0亿、营收同比 +6.34%、净利 272.4亿、净利同比 +1.47%、eps 65.66,`source_detail` 含 `+ stock_financial_abstract (20260331)`。证实 `stock_financial_abstract` 走新浪源,在 VPS 上可用。

阻塞项 / 遗留:

- **A 股 PE/PB/ROE 在生产仍为空**(确认):VPS 上 `stock_a_indicator_lg`(legulegu)已从该版 akshare 移除,`stock_individual_info_em` / `stock_financial_analysis_indicator_em`(eastmoney)在 VPS 上撞 `RemoteDisconnected` / `NoneType` 报错(均被 try/except 兜住)。当前 A 股生产快照有价格/市值/营收/净利/同比/eps,但缺 PE/PB/ROE/毛利率等。后续可换稳定源:用 `stock_financial_abstract` 的 `每股净资产` + 价格算 PB,用 TTM(最近四季)EPS 算 PE,避免依赖已失效接口。
- **前端口径脚注尚未上线** —— `snapshot-card.tsx` 脚注补 A 股的改动已提交,但为避开 1.8Gi 内存机上 `npm run build` 的 OOM 风险,本次只部署了后端;前端可改为本机 build 后上传 `out/`,或在 stop openclaw 释放内存后于服务器 build。
- 部署用 `admin@47.93.21.132`(非 root)+ `id_ed25519` 免密 + 免密 sudo;`~/stock-web` 为 tarball 部署(非 git clone);服务器 shell 残留 OpenClaw 的 `HTTP_PROXY/ALL_PROXY`,本机 `curl 127.0.0.1` 会被代理返回 503,需 `--noproxy "*"` 或 `unset` 代理变量复核(install.sh 已 unset)。

### 2026-06-17 — 迁移到 E 盘、GitHub work items、阿里云部署准备

交付内容:

- **工作区迁移** —— 将 `C:\Users\fuyuh\projects` 迁移到 `E:\code\projects`,原路径改为 junction,旧路径兼容、新路径作为主工作区。`E:\code\claude\skills/plans/memory/plugins/settings` 挂载到对应 `.claude` 目录,便于在 E 盘集中维护。
- **stock-web-build skill** —— 新增 `E:\code\claude\skills\stock-web-build\SKILL.md`,记录项目架构、DeepSeek V4 模型拆分、TradingAgents stream 坑、SSE/PowerShell/gh CLI/Git SSH 踩坑、README 工作日志规则和部署路线。
- **GitHub work items** —— 配置 GitHub SSH key 与 gh CLI,为仓库创建 `deployment/testing/data-source/frontend/backend` labels、Stage A / Stage B milestones,并创建 #2-#7 六个 issues 用作 GitHub 版 work item。
- **README 中文化** —— README 全文改为简体中文,保留关键英文技术名词,并推送到 GitHub。
- **阿里云轻量服务器探查** —— 识别服务器为 Alibaba Cloud Linux 3,OpenClaw/openclaw-gateway 占用约 943MB 内存;停止 OpenClaw/searxng/chrome 后可用内存从 296Mi 提升到 1.5Gi,释放 8080/13984/13986/13987/13995 端口。
- **部署脚本加固** —— `deploy/setup-server.sh` 改为同时支持 apt 与 dnf/yum,Python 3.12 改由 uv 安装;`deploy/install.sh` 改为同步到 `/opt/stock-web` 并兼容 RHEL/Alibaba Cloud Linux 的 `/etc/nginx/conf.d` 布局;`deploy/nginx.conf` 改监听 `18080`,避开 OpenClaw 历史端口。
- **部署打包脚本** —— 新增 `deploy/package.ps1`,生成 `dist/stock-web-deploy.tar.gz`;验证产物约 3.8MB,包含 `backend/vendor/TradingAgents`,排除 `.venv/node_modules/.next/out/.env` 等可再生/敏感目录。
- **Stage A 公网验证** —— `http://47.93.21.132:18080` 已上线。验证页面、`/healthz`、AAPL snapshot、600519 snapshot、00700 港股 snapshot、AAPL 中文 Quick SSE、AAPL 中文 TradingAgents Debate、NVDA 中文 Serenity 产业链扫描均通过。修复 Redis 6.2 不兼容 `EXPIRE ... NX` 导致的 HTTP 500;修复 OpenClaw 残留 SOCKS 代理环境变量导致的 `socksio` / HTTPX 报错。Quick 实测 45 秒,`token=1997`,`done=1`,成本 `$0.002889`;Debate 实测 375.7 秒,`chunks=37`,`agent_complete=3`,`debate_turn=7`,`final=1`,`error=0`,成本估算 `$0.25`,最终建议 `SELL / 低配`;Serenity 实测 49.9 秒,`token=2396`,`done=1`,成本 `$0.003283`。新增 Fundamentals enrichment v1:US 补 EPS/营收增长/ROE/毛利率并用 price/EPS 估算 P/E;HK 补 P/E/P/B/EPS/市值/营收增长/ROE;CN 在估值接口不稳定时至少用 `outstanding_share` 计算总市值,并用 symbol cache 兜底公司简称。Snapshot 前端只显示有值的指标,空值不再占位;增长指标统一显示为"增长",底部标注口径:美股多为同比,港股为滚动增长,估值/盈利/质量为最新时点或最新报告期。随后补充 A 股实时行情增强:使用 `ak.stock_zh_a_spot()` 缓存 60 秒,为 A 股补现价、今开、昨收、最高、最低、成交额、买一卖一、涨跌幅等;公网 600519 实测 13.1 秒返回现价 `1226.43`、成交额 `52.43亿`、买一/卖一和时间戳。
- **本地主题编辑器** —— 新增 `ThemeProvider` + `ThemeEditor`:右下角小按钮,支持实时调整背景/卡片/边框/文字/主色/涨跌色/圆角/密度,配置保存在当前浏览器 `localStorage['stock-web:theme']`,可 Reset 和 Copy JSON。Tailwind 颜色改为 CSS variables,后续可将用户调好的 JSON 固化为默认主题。随后根据反馈继续拆细主题 token:背景层(page/surface/elevated/input)、页面文字层(heading/body/muted/subtle)、分析报告文字层(reportHeading/reportBody/reportMuted/reportAccent)、边界层(border/borderStrong)、图表层(chartGrid/chartTooltip)和语义色(accent/bull/bear),并新增字体预设(system/neo/serif/mono),解决"上面字体和下面分析报告文字不能同色"以及字体可选项不足的问题。已部署到公网。
- **taste skill 页面重做** —— 安装 `design-taste-frontend` skill 后,把首页模式选择从大卡片改为更克制的分段导航 + 单行模式说明,减少 dashboard 味和廉价感;保留本地 Theme Editor 但让它默认收起、不污染主界面。随后将默认配色从饱和深蓝改为 graphite + steel-blue:低饱和背景、冷灰卡片、克制蓝色 accent、更 muted 的涨跌色。公网 smoke 验证页面 200、`Theme`、`Serenity Scan`、`Buffett Quick` 文案存在,`/healthz` 正常。
- **Watchlist MVP** —— 新增 `backend/app/services/watchlist.py` + `routes/watchlist.py`,用 `backend/data/watchlist.json` 保存自选股;新增 `/api/watchlist` CRUD;新增 `/watchlist` 静态页面,支持添加/删除、自选市场、启用状态、备注、分析模式选择,并能从行内跳转回首页带参数分析。股票代码后新增公司简称映射(AAPL · Apple、NVDA · NVIDIA、600519 · 贵州茅台等)。新增 `/api/symbol-search` 和前端补全:输入股票代码、英文名、中文名或别名时显示候选公司名称和代码;首页输入框与 Watchlist 添加框均已接入。A 股搜索补全已扩展为全量代码表 `symbols_cn_full.json`(5528 只),覆盖主板/创业板/科创板/北交所;港股支持已扩展为 `symbols_hk_full.json`(2771 只),支持 `HK` 市场、港股日线 snapshot 和港股搜索补全;公网已验证 `寒武纪→688256`、`中芯→688981`、`宁德→300750`、`688→科创板候选`、`300→创业板候选`、`北交所→920xxx`、`腾讯→00700`、`9988→09988`。

阻塞项 / 遗留:

- Stage A 已部署到 `http://47.93.21.132:18080`:页面、`/healthz`、AAPL 美股 snapshot、600519 A 股 snapshot 均已验证通过。
- Alibaba Cloud Linux 上 `uv sync --frozen` 会在 PyPI/Fastly 下载阶段卡住,已增加 `deploy/server-pip-install.sh` fallback:使用 Python 3.12 venv + pip + 阿里云 PyPI 镜像安装依赖。
- 该轻量服务器只有 1.8Gi 内存,OpenClaw 停掉后可运行 stock-web,但 Multi-Agent Debate 仍可能比 2c4g 机器慢;尚未在公网跑完整 debate。

### 2026-06-16 — 初版 9 任务搭建

交付内容(全部 9 个任务 ✅):

1. **仓库脚手架** —— `backend/`(uv + Python 3.12)、`frontend/`(Next 14)、`.gitignore`、README。验证 `uv sync` 能正确解析对 `vendor/TradingAgents` 的 path-dep。
2. **后端骨架 + snapshot 路由** —— FastAPI 应用、CORS、`/healthz`、统一 yfinance + akshare 的 `market_data.py`、`GET /api/snapshot`。发现并修复 yfinance NaN 尾行 bug(当前交易日偶尔为 null)。
3. **Skill runner + `/api/quick` SSE** —— 内置 Buffett skill(`SKILL.md` + 8 篇参考资料 = 157k 字符的 system prompt)。通过 OpenAI SDK + `base_url` 实现 DeepSeek 流式输出。发现并修复 sse-starlette 双重 `data:` 包装问题(yield dict,而不是预格式化的字符串)。
4. **TradingAgents runner + `/api/debate` SSE** —— LangGraph `stream_mode="values"` 翻译层。对相邻 state 快照做 diff,发出 `agent_start / agent_complete / debate_turn / final / done`。通过 `asyncio.Queue + run_in_executor` 把同步的 `graph.stream()` 异步化包装。**发现**:`llm_provider="openai" + backend_url=deepseek` 会触发 OpenAI Responses API → 404。修复方式是改用 TA 内置的 `llm_provider="deepseek"`。
5. **速率限制 + 每日预算闸门** —— 替换掉 slowapi(装饰器在 validation 之前运行,拼错的 ticker 也会消耗配额),改用自定义滑动窗口限流器,在 snapshot 预取*之后*才调用。Redis 后端(原子 INCR + EXPIRE NX),本地开发时回落到内存实现。每日 $ 上限在 SSE 打开之前就强制校验。
6. **前端骨架** —— Next 14 App Router、Tailwind 3(后续接入深蓝主题)、shadcn 风格组件、recharts K 线、模式选择器(snapshot / quick / debate)。验证静态导出能正常构建,且 `NEXT_PUBLIC_API_BASE` 会被打入 bundle。
7. **SSE 客户端 + UI 流式渲染** —— 由于 `EventSource` 仅支持 GET,自己手写 `lib/sse.ts`(`fetch + ReadableStream`,容忍 CRLF 的帧解析器)。`quick-result.tsx` 像 ChatGPT 那样按 token 流式渲染 markdown;`debate-stream.tsx` 渲染 agent 时间线,卡片可折叠。顶部 "Final Decision" 卡片提取 BUY/SELL/HOLD 决策、TL;DR 一句话总结(对 `Executive Summary` / `执行摘要` / `Reasoning` / `理由` 做正则匹配),以及关键事实(目标价、止损、时间窗口、仓位规模),以药丸标签形式呈现。
8. **本地端到端验证** —— 三次真实 LLM 跑通:Quick zh AAPL($0.005,29 秒)、Quick en NVDA($0.005,36 秒)、Debate zh AAPL($0.10,273 秒,31 个 chunk,0 错误)。合计 ~$0.11。验证语言切换能产出 100% 中文 / 100% 英文,无混杂。
9. **部署脚手架** —— 最初用 Docker compose,**转向 Ubuntu 上裸跑的 systemd + nginx + uv**(节省 ~250 MB 内存,无 daemon,`journalctl` 调试更简单)。写了 `deploy/setup-server.sh`、`deploy/install.sh`、`deploy/stock-web-backend.service`、`deploy/nginx.conf`、`DEPLOY.md`,采用两阶段上线(IP 软启动 → ICP + HTTPS)。验证后端在新的 vendor 路径下可正常 import,`npm run build` 的静态导出在 API base 已烘入的情况下能成功完成。

今日其他值得记录的选择:

- **DeepSeek V4**(不是 V3 —— 那是对老别名 `deepseek-chat` 的误读,该别名现在映射到 V4-Flash;别名将在 2026-07-24 退役)。默认分工:V4-Pro 用于 debate 深度思考,V4-Flash 用于 quick + TA 内部调用。
- **深蓝主题**,顶部带细微的径向高光(比原本中性灰更具金融 / 分析气质)。
- **EN / 中文 i18n** 通过 `lib/i18n.tsx` 里的扁平字典实现(~150 个 key,不引入 i18next)。状态持久化在 localStorage;首次访问嗅探 `navigator.language`。LLM 输出语言透传到后端(Quick 用尾部 directive,Debate 用 TradingAgents 内置的 `output_language="Chinese"`)。
- **为什么不用 Vercel + Railway** —— 中国大陆访问质量差;demo 受众是没有 VPN 的朋友。

阻塞项 / 今日遗留:

- akshare 的 eastmoney 接口在本机调用失败,因为这台机器上有 HTTP 代理 —— 需要在干净的中国 VPS 生产环境上验证。
- ICP 备案尚未启动 —— 域名 + 14-21 天的备案流程在用户侧。Stage A(仅 IP `:8080`)无需备案即可部署。
- 没有自动化测试套件。全程靠手工烟雾测试。
- 暂无 live demo URL。一旦 Stage A 部署到真实 VPS 就会补上。

---

## 许可证

MIT。TradingAgents 有其自己的许可证 —— 二次分发前请先核对。
