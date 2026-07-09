---
name: deploy-webapp-aliyun-domain
description: >-
  Put an app running on a local port of an Aliyun server onto a custom domain
  with HTTPS and a Chinese ICP filing footer. Use when the user wants to expose
  an internal service (e.g. 127.0.0.1:PORT) at their own domain via nginx reverse
  proxy + Let's Encrypt, on an Alibaba Cloud server (ECS or 轻量应用服务器/SWAS),
  and/or add an ICP 备案号 (京ICP备... 号) to the site footer. Triggers: "把 X 部署到
  域名", "配 HTTPS / 证书", "加 ICP 备案", "nginx 反代", "Failed to fetch after moving
  to a domain".
---

# Deploy a web app to a custom domain on Aliyun (nginx + HTTPS + ICP 备案)

A field-tested playbook for taking an app that runs on a local port of an Alibaba
Cloud server and publishing it at a real domain with HTTPS and a compliant ICP
filing footer. Follow the phases in order; each has a verify step. **Do not skip
verification — several failure modes only show up when you actually load the page.**

## Ground rules

- **Confirm which machine you are on before running server commands.** The Claude
  Code environment is often a *different* box than the user's target server. Prove
  the target's identity from Aliyun metadata, and if it does not match, have the
  **user** run the commands on the real server (SSH) — you guide, they execute.
  ```bash
  M=http://100.100.100.200/latest/meta-data
  curl -s --max-time 3 $M/region-id; echo
  curl -s --max-time 3 $M/eipv4;    echo   # public/elastic IP
  curl -s --max-time 3 $M/instance/instance-type; echo
  ```
  Compare the reported IP to the IP the domain must point to. If they differ, you
  are on the wrong host — stop touching it and switch to guiding the user.
- Report faithfully. If a check runs on the wrong machine, say so and retract any
  conclusion drawn from it.

## Phase 1 — DNS

Add **A records** in the domain registrar's DNS console (Aliyun 云解析 / 腾讯云 /
etc.), NOT on the server:

| 主机记录 | 类型 | 记录值 | TTL |
|---|---|---|---|
| `@`   | A | `<server public IP>` | 600 |
| `www` | A | `<server public IP>` | 600 |

Verify propagation (dig/nslookup may be absent — fall back to getent/python):
```bash
getent hosts example.com || python3 -c "import socket;print(socket.gethostbyname('example.com'))"
```
`.cn` domains must be real-name verified or they won't resolve at all.

## Phase 2 — Open ports 80/443 (two layers)

1. **Cloud firewall** (web console; cannot be done from the shell):
   - **ECS** → security group (安全组): 网络与安全 → 安全组 → 配置规则 → 入方向 →
     add TCP `80` and `443`, source `0.0.0.0/0`.
   - **轻量应用服务器 (SWAS)** → it has **NO 安全组**; its firewall is under the
     Lightweight console → the instance → **「防火墙」** tab → add HTTP(80)/HTTPS(443).
   - If the ECS security-group list is **empty**, the box is almost certainly a
     **轻量** server, or you're in the wrong region/account. Use metadata's
     `region-id` to find the real region.
2. **Host firewall** (on the server): usually already open on Aliyun images.
   ```bash
   command -v ufw && ufw status; command -v firewall-cmd && firewall-cmd --list-all
   iptables -L INPUT -n --line-numbers
   ```

**Verify:** open `http://<domain>` in a browser. Anything (even a default page)
means DNS + cloud firewall + a web server on :80 are all wired.

## Phase 3 — Reverse proxy to the app's local port

Find out what's actually on :80 first — don't assume.
```bash
sudo ss -tlnp | grep -E ':80\b'          # nginx? apache/httpd? a container?
rpm -q nginx httpd 2>/dev/null; ps -ef | grep -Ei 'nginx|httpd|apache' | grep -v grep
```

### nginx (most common on Aliyun Linux / Anolis)
Create `/etc/nginx/conf.d/<site>.conf` — a **named** server block coexists with the
default `server_name _;` block:
```nginx
map $http_upgrade $connection_upgrade { default upgrade; '' close; }   # in http ctx

server {
    listen 80;
    listen [::]:80;
    server_name example.com www.example.com;
    location / {
        proxy_pass http://127.0.0.1:<APP_PORT>;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
    }
}
```
```bash
sudo nginx -t && sudo systemctl reload nginx
```
Proxying nginx → the app's own nginx on another port is fine; the extra localhost
hop is negligible and reuses the app's already-correct internal routing.

### Apache/httpd
Enable mod_proxy/mod_proxy_http, add a `<VirtualHost *:80>` with
`ProxyPass / http://127.0.0.1:<APP_PORT>/` + `ProxyPassReverse`.

**Verify:** `http://<domain>` now shows the app, not the default page.

## Phase 4 — Fix "Failed to fetch" (hardcoded API base / CSP / mixed content)

Symptom: page shell loads but data fails. Check DevTools → Console/Network.

- **`...violates the document's Content Security Policy`** or CORS on a request to
  `http://<IP>:<port>/api/...` → the frontend has the backend URL **hardcoded** to
  an IP:port. Under a domain (and later HTTPS) that's cross-origin / mixed-content
  and gets blocked by `connect-src 'self'`.
- **Fix = make API calls same-origin relative `/api/...`**, then the reverse proxy's
  `location /` carries them to the backend. Two ways:
  - **Proper (preferred): fix at the source and rebuild.** For Next.js this is a
    `NEXT_PUBLIC_*` base URL, usually in `.env.production`. Set it **empty** so
    `base ?? default` yields `""` → relative `/api`. Then rebuild (see Phase 6).
    A prior build may have hardcoded the IP via an inline
    `NEXT_PUBLIC_API_BASE=http://IP:port npm run build` even though the file is
    empty — a clean rebuild fixes it.
  - **Quick patch (no source): sed the built bundle.** Back up first, then strip
    the absolute origin so URLs become relative:
    ```bash
    sudo cp -a /var/www/<site> /var/www/<site>.bak.$(date +%s)
    sudo grep -rl 'http://<IP>:<port>' /var/www/<site>/ \
      | sudo xargs sed -i 's#http://<IP>:<port>##g'
    ```
    ⚠️ A rebuild/redeploy revives the hardcoded URL — only the source fix is durable.

**Verify:** hard-refresh (Ctrl+Shift+R); data loads via `<domain>/api/...`.

## Phase 5 — HTTPS with Let's Encrypt (certbot)

```bash
sudo dnf install -y certbot python3-certbot-nginx      # apache: python3-certbot-apache
sudo certbot --nginx -d example.com -d www.example.com
```
Answer the prompts: email → agree ToS `Y` → EFF share `N` → redirect HTTP→HTTPS
`2`. certbot writes the 443 server block, adds the redirect, and installs an
auto-renew timer (`systemctl list-timers | grep certbot`). Certs last 90 days.

**Verify:** `https://<domain>` and `https://www.<domain>` show a padlock + working
data. If it hangs, the **443** cloud-firewall rule is missing (80 open ≠ 443 open).

## Phase 6 — Rebuild & redeploy a static frontend (Next.js `output: "export"`)

Identify the **live** source tree (may be several copies): the one whose built
chunk matches the deployed file is the real one.
```bash
# which source produced the deployed chunk?
ls <src>/.next/static/chunks/<hash>.js   # matches /var/www/<site>/_next/... => live
```
Build as the directory's **owner** (mismatched ownership → EACCES on `.next`):
```bash
sudo rm -rf <src>/.next <src>/out           # clear stale/root-owned artifacts
sudo -u <owner> bash -lc 'cd <src> && npm run build'
grep -rl '<IP>:<port>' <src>/out/ || echo "clean, no hardcoded IP"
```
Deploy `out/` and fix perms / SELinux context:
```bash
sudo cp -a /var/www/<site> /var/www/<site>.bak.$(date +%s)
sudo rsync -a --delete <src>/out/ /var/www/<site>/ \
  || { sudo rm -rf /var/www/<site>/*; sudo cp -a <src>/out/. /var/www/<site>/; }
sudo chmod -R a+rX /var/www/<site>
sudo restorecon -R /var/www/<site> 2>/dev/null || true   # if SELinux Enforcing
```
No nginx reload needed for static-file swaps.

## Phase 7 — ICP 备案 (mainland servers only)

- **Only mainland-China servers require 备案.** Hong Kong / overseas nodes don't —
  check metadata `region-id` (e.g. `cn-beijing` needs it; `us-west-1`/`cn-hongkong`
  do not).
- File **through the hosting provider** (阿里云 App / "阿里云ICP代备案" 小程序), not
  directly at MIIT. Prereqs: domain real-name verified; a **备案服务码** generated in
  the 轻量/ECS console (instance must have ≥3 months left); ID (individual) or
  business license (company). Flow: 主体信息 → 网站信息 → 证件+人脸核验 → provider
  review (1–2 d) → 管局 review (1–20 working days, respond to the SMS verification).
  Free. Individual site names must not sound like a company or they're rejected.
- **After the number is issued it is legally required to show it in the site footer
  linked to https://beian.miit.gov.cn/.** For Next.js, add it to the root
  `app/layout.tsx` so every page shows it (back up first, write as the owner):
  ```tsx
  <footer style={{ textAlign: "center", padding: "16px 12px", fontSize: 12, opacity: 0.55 }}>
    <a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer"
       style={{ color: "inherit", textDecoration: "none" }}>
      京ICP备XXXXXXXX号
    </a>
  </footer>
  ```
  Then rebuild + redeploy (Phase 6). Operational sites also often need 公安联网备案
  (beian.mps.gov.cn) — add that number to the footer too.

## Cleanup & hardening

- Remove backups once stable: `/var/www/<site>.bak.*`, `layout.tsx.bak`.
- The app's raw `http://<IP>:<APP_PORT>` is still directly reachable (no HTTPS, no
  备案号). To force domain-only access, drop `<APP_PORT>` from the cloud firewall
  (keep only 80/443) or bind the app to `127.0.0.1:<APP_PORT>`.
