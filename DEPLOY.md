# 部署指南

单台 Linux VPS 裸跑部署,**不使用 Docker**。服务组成:

- nginx:公网入口,监听 `:18080`,服务前端静态文件并反代 `/api/*`
- FastAPI backend:systemd 服务,只监听 `127.0.0.1:8000`
- Redis:本机 loopback,存限流和每日预算计数
- 前端:Next.js `output: "export"` 静态产物,发布到 `/var/www/stock-web`
- 运行目录:`/opt/stock-web`

两阶段上线:

| 阶段 | 前置条件 | 结果 |
|---|---|---|
| **A. IP soft-launch** | 国内 VPS(2c4g 推荐),Ubuntu 22.04/24.04 | `http://<你的IP>:18080` 可访问,无 HTTPS |
| **B. 域名 + HTTPS** | 域名备案通过(14-21 天) | `https://your.domain` 绿锁 |

---

## Stage A — IP soft-launch

### 1. 买机器

推荐配置:

- 阿里云 ECS / 轻量应用服务器均可
- 地域:国内任意区域
- 系统:Ubuntu 22.04 或 24.04
- 配置:2c4g / 40GB SSD / 3Mbps+
- 安全组:开放 inbound TCP **18080**

未备案前不要依赖 80/443,多数云厂或运营商会拦。

### 2. 打包并上传代码

本机 PowerShell:

```powershell
cd E:\code\projects\stock-web
powershell -ExecutionPolicy Bypass -File deploy\package.ps1
scp dist\stock-web-deploy.tar.gz root@<你的IP>:/tmp/stock-web-deploy.tar.gz
```

服务器上解压:

```bash
ssh root@<你的IP>
rm -rf ~/stock-web
mkdir -p ~/stock-web
tar -xzf /tmp/stock-web-deploy.tar.gz -C ~/stock-web
cd ~/stock-web
```

如果你不用 root,替换成自己的登录用户。

为什么不用 `scp -r E:\code\projects\stock-web`? 因为它会把 `.venv`、`node_modules`、`.next` 一起传上去,浪费几百 MB;`deploy/package.ps1` 会排除这些可再生目录,但保留服务器必须要的 `backend/vendor/TradingAgents`。

### 3. 服务器一次性初始化

SSH 到服务器:

```bash
ssh root@<你的IP>
cd ~/stock-web
sudo bash deploy/setup-server.sh
```

这个脚本会:

- apt 安装 curl / git / rsync / nginx / redis / build-essential
- 安装 Node 20
- 安装 uv
- 通过 uv 给 `stockweb` 系统用户安装 Python 3.12(不依赖 Ubuntu apt 源是否带 Python 3.12)
- 创建 `/opt/stock-web`
- 启动 Redis(loopback only)

### 4. 配置环境变量

```bash
cd ~/stock-web
cp .env.example .env
nano .env
```

至少改两项:

```env
DEEPSEEK_API_KEY=sk-你的真实key
PUBLIC_API_BASE=http://<你的IP>:18080
```

可选:

```env
DAILY_BUDGET_USD=10
RATE_LIMIT_QUICK=5/hour
RATE_LIMIT_DEBATE=1/hour
DEEP_THINK_LLM=deepseek-v4-pro
QUICK_THINK_LLM=deepseek-v4-flash
```

### 5. 部署 / 更新

```bash
sudo bash deploy/install.sh
```

这个脚本是幂等的,以后每次更新代码都可以重新跑。它会:

1. 把当前仓库同步到 `/opt/stock-web`
2. 后端优先 `uv sync --frozen`;如果在 PyPI/Fastly 下载阶段失败或 15 分钟超时,自动 fallback 到 `deploy/server-pip-install.sh`(pip + 阿里云 PyPI 镜像)
3. 写 `/etc/stock-web.env`(root:stockweb,0640)
4. 安装并重启 `stock-web-backend.service`
5. 前端 `npm ci && npm run build`
6. 把 `frontend/out/` 发布到 `/var/www/stock-web`
7. 安装 nginx site 并 reload
8. curl `/healthz` 做 smoke check

### 6. 验收

浏览器打开:

```text
http://<你的IP>:18080
```

检查:

- [ ] 首页正常显示
- [ ] Snapshot 模式 AAPL 能返回 K 线
- [ ] Buffett Quick 能流式输出
- [ ] TradingAgents Debate 3-5 分钟后出现最终结论卡

服务器上可运行:

```bash
curl -s http://127.0.0.1:8000/healthz
sudo systemctl status stock-web-backend
sudo journalctl -u stock-web-backend -n 80 --no-pager
```

---

## 日常运维

```bash
# 查看 backend 日志
sudo journalctl -u stock-web-backend -f

# 重启 backend
sudo systemctl restart stock-web-backend

# 更新代码后重新部署
# 方式 A:如果服务器是 git clone 的: git pull
# 方式 B:如果是打包上传的:重新运行 package.ps1 + scp + tar 覆盖 ~/stock-web
cd ~/stock-web
sudo bash deploy/install.sh

# 重置 Redis 计数器(限流和每日预算)
sudo systemctl restart redis-server

# 检查 nginx 配置
sudo nginx -t
sudo systemctl reload nginx
```

---

## Stage B — 备案后加 HTTPS

ICP备案通过后:

1. 域名 A 记录指向 VPS IP
2. 安全组开放 443
3. 安装 certbot:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your.domain
```

4. 更新 `.env`:

```env
PUBLIC_API_BASE=https://your.domain
```

5. 重新构建前端(因为 `NEXT_PUBLIC_API_BASE` 是 build-time baked):

```bash
sudo bash deploy/install.sh
```

6. 验证:

```bash
curl -I https://your.domain/healthz
sudo certbot renew --dry-run
```

---

## 常见问题

| 现象 | 可能原因 | 处理 |
|---|---|---|
| `http://<ip>:18080` 打不开 | 安全组没开放 18080 / 服务器防火墙 | 云控制台放行 TCP 18080;如启用 ufw,`sudo ufw allow 18080/tcp` |
| 首页打开,点 Analyze 失败 | `.env` 里的 `PUBLIC_API_BASE` 和浏览器实际访问地址不一致,CORS 拒绝 | 改 `.env`,重新 `sudo bash deploy/install.sh` |
| Debate 60 秒断流 | 中间代理/nginx 缓冲或 timeout 太短 | 确认使用 `deploy/nginx.conf`,里面 `proxy_buffering off` 和 `proxy_read_timeout 600s` |
| `stock-web-backend.service` failed | 看日志 | `sudo journalctl -u stock-web-backend -n 80 --no-pager` |
| `uv sync --frozen` 失败,提示 `vendor/TradingAgents` 缺失 | GitHub 仓库不包含 vendored TradingAgents,需要本地/服务器补齐 | 按 `backend/vendor/README.md` 把 TradingAgents 拷进 `backend/vendor/TradingAgents` 后再部署 |
| 前端 build OOM | 机器太小(1c1g) | 换 2c4g,或本地 build 后上传 `frontend/out` |
| A 股数据失败 | akshare / eastmoney 接口问题 | 见 GitHub issue #2 |

---

## 重要注意

- `DEEPSEEK_API_KEY` 不要提交到 git,只放服务器 `.env` 和 `/etc/stock-web.env`。
- 未备案阶段只适合小范围演示;正式分享请等 ICP + HTTPS。
- 首页/README 已声明 research demo / 不构成投资建议,不要改成交易建议类文案。
