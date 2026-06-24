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

### 2026-06-24 — 持仓诊断页(反锚定的仓位建议)

交付内容:

- **独立 `/diagnose` 页** —— 输入买入成本(/股数/日期,可选)→ 复用 StockInput(自选补全)/ SnapshotCard / 财务面板 / QuickResult;顶部盈亏汇总卡(成本/现价/未实现盈亏%);左侧导航加「持仓诊断」。不改动其他页面。
- **后端复用 quick 引擎** —— QuickRequest 加 `cost_basis/shares/buy_date`;`stream_quick` 在有成本价时走"持仓诊断"任务:算盈亏%、给 **加/持/减/清** 建议;**报告开头强制一节「持仓建议」**(动作 + 前瞻理由 + 是否存在"为回本而持有"的锚定/损失厌恶,有则点破)。报告 `mode=diagnose`,signal 识别加/减/清仓。
- **反锚定设计** —— 核心是不助长"等回本"的认知偏差:决策基于前瞻价值,成本价仅作背景;实测 600519 成本 1500(亏 19.5%)→ 给出"加仓"并明确点破锚定 + 反问"今天 1200 你会买吗",再展开巴菲特标准分析。
- **验证** —— 公网实测诊断流完成、开头「持仓建议」节正确、反锚定词全命中。

### 2026-06-24 — 财务可视化面板 + 报告分享/导出

交付内容:

- **财务可视化面板** —— `components/financials-panel.tsx`:接 `/api/financials`,营收/净利多年柱状图 + 毛利率/净利率/ROE 走势线 + 关键科目表(recharts,双语/响应式/主题色,单位随币种 亿/B 自适应),接入分析页 snapshot 下方;无数据静默隐藏。
- **报告分享(可开关/可撤销)** —— `reports` 表加 `is_public`(启动时 `PRAGMA` 检测 + `ALTER` 兜底迁移,**prod 老库已平滑加列、数据无损**);`POST /api/reports/{id}/share` 切换、`GET /api/public/reports/{id}` 无需登录(仅当公开);`/reports` 详情加 分享/取消分享 + 复制链接;新增公开查看页 `/share?id=`。默认私密。
- **报告导出长图** —— 复用组件 `components/report-view.tsx` + `html-to-image`,一键把报告卡导出 PNG(适合发微信);分享页与详情页通用。
- **验证** —— 本地 TestClient 测旧 schema DB 自动迁移 + 分享/撤销/公开可见全流程;公网部署后服务器侧实测:public 端点 404、分享需鉴权 401、`/api/financials` 200、`/share` 页在线、prod 库 `is_public` 迁移已生效。

阻塞项 / 遗留:

- 访问稳定性(Stage 0)仍未做:裸 IP `:18080` 在国内会间歇性丢请求(API/SSE 长连接更易中断,表现为 "Failed to fetch")。下一步可上 Cloudflare 隧道(临时)或 ICP+HTTPS(根治)。

### 2026-06-24 — 多期财务报表接入(喂给三条 agent 分析链)

交付内容:

- **financials.py 数据层** —— 统一 `Financials` 模型:利润表/资产负债表/现金流量表核心科目(营收/毛利/营业利润/净利/EPS、总资产/负债/权益/现金/有息负债、经营现金流/资本开支/FCF)× ~5 年报 + 近几季 + 比率集;6 小时缓存;全程 None 降级不抛错。三市场适配:
  - **US**:yfinance 三表(年报按数据源定、修跨财年标注);VPS 上 yfinance 429 → `stock_financial_us_analysis_indicator_em` 兜底(利润表级:营收/净利/EPS 多期)。
  - **CN**:`stock_financial_abstract`(新浪源,VPS 可靠),毛利=营收−营业成本、总资产=权益/(1−资产负债率) 推导,比率直接取(ROE/ROA/毛利/净利/营业利润率/流动比率/速动比率…)。
  - **HK**:`hk_analysis_indicator_em`(营收/毛利/净利/EPS + 比率)+ `hk_report_em` 补总资产/现金。
- **新增 `GET /api/financials`**。
- **Quick / Serenity 接入** —— `_format_snapshot_for_prompt` 补全此前漏掉的全部 fundamentals(ROE/ROA/毛利/净利/net_income/负债率/净利同比),并注入多期报表块(`quick.py` 以 `to_thread` 取数)。
- **TradingAgents 接入** —— 在 `create_initial_state` 后把权威财务摘要作为 human message 注入 `messages`,所有 analyst(尤其基本面)可直接引用,弥补 TA 对 A股/港股的弱覆盖;零改 vendored 文件、可回退。
- **部署验证** —— 后端 rsync + 重启(无新依赖)。服务器实测:CN 5 年报+6 季+12 比率(2.2s)、HK 5 年报+8 比率(0.3s)、US 6 年报+6 季(7s,akshare 兜底)。

阻塞项 / 遗留:

- ~~US 在 VPS 上为利润表级~~ **已解决(2026-06-24)**:US 兜底改用 `stock_financial_us_report_em` 拉完整三表(综合损益表/资产负债表/现金流量表,年报),VPS 上补齐总资产/总负债/股东权益/现金/经营现金流/资本开支/FCF + 比率;FCF=OCF−|capex|。AAPL prod 实测:总资产 3592亿 / 权益 737亿 / 经营现金流 1115亿 / FCF 988亿(美元)。
- CN 现金/资本开支/FCF 在 abstract 中无绝对值(经营现金流有);HK 经营现金流/营业利润未取(指标表无)。

### 2026-06-24 — 账号体系 + 历史报告 + 左侧导航布局

交付内容:

- **账号体系(邮箱 + 密码,纯 stdlib 无新依赖)** —— 新增 SQLite(`app/services/db.py`,stdlib `sqlite3`)存 users/reports/watchlist;密码用 `pbkdf2_hmac` 哈希,会话用 `hmac` 签名 token(HS256 等效,验证硬绑定无 `alg:none` 隐患),`Authorization: Bearer` 传递。新增 `/api/auth/register|login|me`。选 stdlib 是为了让 VPS 部署保持 rsync+重启,不触发卡顿的 `uv sync`。`config` 加 `jwt_secret`(env 缺省时持久化到 `data/.jwt_secret`)与 `db_path`。
- **历史报告** —— `app/services/reports.py` + `/api/reports`(列表/详情/删除,带 ownership 校验)。`quick.py` / `debate.py` 的 SSE 在完成时按**登录用户**落盘(quick 累积 token;debate 组装 agent 报告 + final 决策为 markdown),`done` 载荷回传 `saved_report_id`;未登录不存。列表用轻量 signal 提取(BUY/SELL/HOLD)做决策药丸。
- **Watchlist 迁移为按用户** —— 从全局 `watchlist.json` 改为 SQLite 按 `user_id`,路由加登录依赖;旧 JSON 弃用。
- **前端账号 UI** —— `lib/token.ts`(localStorage + Bearer 注入 `api.ts`/`sse.ts`)、`lib/auth.tsx`(AuthProvider)、`components/auth-widget.tsx`(登录/注册弹窗 + 账号下拉)、`/reports` 列表+详情(react-markdown)、watchlist 接入登录守卫。
- **左侧导航壳(轻版)** —— `components/app-shell.tsx`:左侧固定导航(分析/自选/历史,当前页高亮),登录 + 中英文切换固定右上角,标题上方保留 eyebrow;移动端左栏收成汉堡抽屉,账号收成头像下拉(图标点开邮箱/退出),卡片单列堆叠。
- **部署验证** —— 后端 rsync 到 `/opt`(无新依赖,跳过 uv sync)+ 重启;前端本机 build → 上传 `out/` → `/var/www/stock-web`。本地 TestClient 全绿,公网实测:注册/登录/me(200/401)、reports(空 200)、watchlist(无 token 401 / 有 token 增列 200)、`/reports` 页 200、新壳 chunk 含 `nav.analyze`。
- **安全口径** —— Stage A 为纯 HTTP,token/密码在链路上为明文(已在登录框提示"demo 勿用真实密码")。HTTPS 待 Stage B(ICP)。

阻塞项 / 遗留:

- 无邮箱验证 / 找回密码(MVP);无按账号限流(限流仍按 IP)。
- HTTPS 未上(Stage B);真账号安全需备案 + TLS 后再加固。

### 2026-06-23 — A 股基本面补全(成长性 + 估值/盈利/质量)

交付内容:

- **A 股营收/净利同比** —— `_cn_snapshot` 新增 `stock_financial_abstract` 数据源,补齐此前 A 股缺失的成长性字段:营业总收入、归母净利润,以及营业总收入同比增长率、归属母公司净利润同比增长率。前端"增长"区(营收增长 / 净利增长)对 A 股不再空白。
- **口径一致性** —— 营收/净利及其同比从**同一报告期列**读取(最新非空期,通常为最新季度),保证数字与其同比口径一致;`source_detail` 标注所用报告期(如 `stock_financial_abstract (20260331)`)。
- **eps 兜底取年报值** —— 当 EM 财务指标接口缺失时,用 `stock_financial_abstract` 的**最新年报(12-31)**每股收益兜底,避免把单季累计 EPS 当成滚动 EPS 显示(如茅台兜底为全年 65.66 而非 Q1 的 21.76)。
- **数据源选型** —— 选 `stock_financial_abstract`(返回原始元 float)而非 `stock_financial_abstract_ths`(金额为 "6.28亿" 字符串,`_safe_float` 无法解析)。同比值为百分数,统一 `/100` 转 decimal。整段包在 try/except + `or` 合并里,接口不可用时静默降级,不影响既有字段。
- **前端口径脚注更新** —— Snapshot 底部口径说明补上 A 股:"A股/美股增长为同比(A股取最新报告期),港股为滚动增长"。
- **验证** —— 对 600519(茅台,消费)与 000001(平安银行,金融)实测提取逻辑:营收同比 +6.34% / +4.65%,净利同比 +1.47% / +3.03%,eps 取年报值正确,单位口径核对无误。
- **已部署到公网并验证** —— tarball 上传 + 后端 rsync 到 `/opt/stock-web` + 重启 `stock-web-backend`(`~/stock-web` 部署源同步更新,避免下次 install.sh 回滚);`http://47.93.21.132:18080` 上 600519 快照部署前 `revenue/eps` 全空,部署后补上营收 547.0亿、营收同比 +6.34%、净利 272.4亿、净利同比 +1.47%、eps 65.66,`source_detail` 含 `+ stock_financial_abstract (20260331)`。证实 `stock_financial_abstract` 走新浪源,在 VPS 上可用。
- **A 股 PE/PB/ROE/利润率补全(同源派生)** —— 既然 legulegu(`stock_a_indicator_lg` 已从该版 akshare 移除)与 eastmoney 估值接口在 VPS 失效(`RemoteDisconnected` / `NoneType`),改由同一 `stock_financial_abstract` 表派生:PB=现价/最新每股净资产;PE=现价/TTM EPS(EPS 为年内累计,TTM=本期累计 + 上年报 − 去年同期);ROE/毛利率/净利率取最新年报、资产负债率取最新报告期;ROE 键括号全/半角跨版本不一,改用前缀匹配解析避免静默失败;全部 `if None` 兜底,EM 接口恢复时仍优先。实测茅台 PE 18.5 / PB 5.65 / ROE 32.5%、平安银行 PE 5.05 / PB 0.45 / 负债率 91%、宁德 PE 22.4 / PB 5.01,均合理。已部署(单文件 scp 同步 `~/stock-web` + `/opt` + 重启),公网 600519 **估值/盈利/增长/质量四区现已全部有数**。

阻塞项 / 遗留:

- **前端脚注已上线**(本机 build → 上传 `out/`)—— 为避开 1.8Gi 内存机上 `npm run build` 的 OOM 风险,改为**本机** `NEXT_PUBLIC_API_BASE=http://47.93.21.132:18080 npm run build` 产出 `out/`,打包 scp 到服务器后 `sudo rsync --delete` 到 `/var/www/stock-web` 并 reload nginx。公网已验证 index 引用新 chunk `page-6cef5c10fcc1d96c.js` 且含"A股取最新报告期"。**这是该小内存机推荐的前端部署法**(server 端 npm build 风险高)。
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
