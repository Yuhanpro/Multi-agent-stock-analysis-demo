# Deployment

Bare-metal systemd deployment to a single Linux VPS — no Docker required.

Two-stage rollout:

| Stage | Pre-requisite | Result |
|---|---|---|
| **A. IP-only soft-launch** | A cloud VPS (2c4g) running Ubuntu 22.04 | `http://<your-IP>:8080` accessible to anyone — browser shows "Not Secure" warning |
| **B. After ICP filing** | Domain registered + ICP filing approved (14-21 days) | `https://your.domain` with Let's Encrypt cert |

## Stage A — first-time deploy

1. **Buy a VPS** — 2c4g Ubuntu 22.04 in a Chinese region (Aliyun / Tencent / Volcengine). Open inbound TCP **8080** in the security group. Avoid 80 — most Chinese ISPs block it for unfiled domains.

2. **SSH in and run the bootstrap** (installs Python 3.12, Node 20, Redis, nginx, uv):

   ```bash
   ssh user@1.2.3.4
   sudo apt update && sudo apt install -y git
   git clone https://github.com/<you>/stock-web.git ~/stock-web
   cd ~/stock-web
   sudo bash deploy/setup-server.sh
   ```

   (Alternatively, if you don't want to put the repo on GitHub: `scp -r` from your dev machine instead of `git clone`.)

3. **Configure secrets**:

   ```bash
   cp .env.example .env
   nano .env   # set DEEPSEEK_API_KEY and PUBLIC_API_BASE=http://1.2.3.4:8080
   ```

4. **Install / build / start** (idempotent — re-run after `git pull`):

   ```bash
   sudo bash deploy/install.sh
   ```

   This:
   - `uv sync` for the backend
   - writes `/etc/stock-web.env` with secrets (mode 0640, root:stockweb)
   - installs systemd unit + starts `stock-web-backend.service`
   - `npm run build` for the frontend
   - publishes `out/` to `/var/www/stock-web`
   - configures nginx, reloads
   - `curl /healthz` to confirm

5. **Move home** — open `http://1.2.3.4:8080` in your browser.

## Day-to-day operations

```bash
# Tail backend logs
sudo journalctl -u stock-web-backend -f

# Restart backend (after editing /etc/stock-web.env)
sudo systemctl restart stock-web-backend

# Health
curl -s http://127.0.0.1:8000/healthz | jq

# Update + redeploy
cd ~/stock-web
git pull
sudo bash deploy/install.sh

# Reset rate-limit / budget counters (just restart redis)
sudo systemctl restart redis-server
```

## Stage B — adding HTTPS after ICP

1. Register a domain with the same cloud provider's registrar; submit an ICP filing under your ID. **Make sure the site description says "AI 多 agent 系统技术演示"**, not "投资分析" — the latter triggers a financial-services license demand.

2. After ICP approval (14-21 days):
   - Point the domain's A record to your VPS IP.
   - Open inbound TCP 443 in the security group.

3. **Get a Let's Encrypt cert** with certbot:

   ```bash
   sudo apt install -y certbot python3-certbot-nginx
   sudo certbot --nginx -d your.domain
   ```

   certbot will auto-edit `deploy/nginx.conf` (well, the version installed at `/etc/nginx/sites-available/stock-web`) and add the SSL block + http→https redirect.

4. **Update `.env`**:

   ```
   PUBLIC_API_BASE=https://your.domain
   ```

5. **Rebuild + redeploy** (the API base is baked into the static bundle):

   ```bash
   sudo bash deploy/install.sh
   ```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `curl 127.0.0.1:8000/healthz` works on the box but the public URL doesn't | Cloud security group / ufw firewall closed | Open 8080 (or 443) inbound in the cloud console |
| Frontend renders, but pressing "Analyze" says "Failed to fetch" | `PUBLIC_API_BASE` mismatch — value the browser sees doesn't match what the server's CORS allowlist expects | Ensure same string in `.env`, then `sudo bash deploy/install.sh` |
| SSE stream cuts off at 60s | Some cloud LBs add their own nginx hop with default timeouts | Check security group for an LB; either remove or set timeouts > 600s |
| `npm ci` runs out of memory on a 1c1g machine during `next build` | Node uses lots of RAM compiling | Either upgrade to 2c4g, or build locally and `scp -r frontend/out/ user@vps:/var/www/stock-web/` |
| `systemctl status stock-web-backend` shows `failed` | Check `journalctl -u stock-web-backend -n 50`. Most common: `DEEPSEEK_API_KEY` not in `/etc/stock-web.env`, or path-dep `vendor/TradingAgents` missing | Edit `.env`, re-run `install.sh` |
| Cloud provider sends a "your IP is being accessed but no ICP filing" warning | Common after 7-30 days for unfiled IPs | Either accelerate the ICP filing or move the demo behind something they don't track |
