# Rakazo ModelScope Lite — root + 客户端内置实时桌面（实验版）

> **状态：源码叠加包，未完成上游 Rakazo 的完整构建，也没有完成 GHCR 或魔搭端到端实测。**
> 已做离线语法和代码补丁样例测试。GitHub Actions 正式构建会做上游 TypeScript 检查。

基于之前的 `rakazo-modelscope-lite` 修改，保留 GitHub Actions → GHCR → 魔搭 Docker 创空间工作流。

## 1. 运行结构

```text
电脑 Rakazo 客户端 / 手机浏览器
            |
   https://rakazo.example.com
            |
      Cloudflare Tunnel
            | (只转发 127.0.0.1:5173)
┌─────────────── 魔搭单个 Docker 容器 ───────────────────────┐
│  0.0.0.0:7860   健康检查（魔搭入口）                       │
│  127.0.0.1:5173 Rakazo Web (root)                        │
│  127.0.0.1:3100 Rakazo API (root)                        │
│  Worker (root) / Desktop Provider (root)                │
│  PostgreSQL 16 (postgres；本机目录 /var/lib/rakazo/pgdata) │
│  Xvfb :99 + Openbox + Chrome --no-sandbox (root)         │
│  xdotool / scrot   真实鼠标键盘与 AI 截图                  │
│  127.0.0.1:5900 x11vnc -viewonly (无单独公网入口)         │
│  127.0.0.1:6080 websockify / noVNC (无单独公网入口)       │
└──────────────────────────────────────────────────────────┘
```

**和旧版相比：** Desktop Provider `connectScreen()` 从 `desktop://screen/...` 占位地址改成 `http://127.0.0.1:6080/vnc.html?...`，依赖 Rakazo 已有的受认证 `/novnc/session/...` 代理，把实时画面嵌入电脑客户端 Computer 面板，而不是新开 noVNC 网页。

**本版只读观看。** x11vnc 使用 `-viewonly`，而 Provider 会拒绝 `interactive` 屏幕会话；用户不能通过这个 VNC 通道直接接管桌面。AI 仍用内部 X11 工具正常点击、截图。桌面统一使用一个 `DISPLAY=:99`，不同 Agent 不能独立拥有各自的桌面。

## 2. GitHub 仓库上传文件

上传 ZIP 解压后的整个项目目录内容（含隐藏的 `.github` 文件夹）到你的 GitHub 仓库：

```text
.github/workflows/build-image.yml
README.zh-CN.md
deploy/Dockerfile
deploy/desktop-x11.ts
deploy/desktopctl
deploy/entrypoint.sh
deploy/env.example
deploy/health.mjs
deploy/patch-desktop.mjs
modelscope/Dockerfile
tests/check.mjs
tests/check.sh
```

将仓库主分支设为 `main` 并 push 后，GitHub Actions `Build Rakazo ModelScope image` 会：

1. 验证部署脚本与补丁样例。
2. 从 `https://github.com/elie222/rakazo` 检出上游源码。
3. 把 `deploy/` 叠加到上游的 `infra/modelscope-single/`。
4. 打补丁，执行 `pnpm --filter @rakazo/adapters check` 做类型检查。
5. 构建 `linux/amd64` 镜像并推送 `ghcr.io/<github用户名>/<仓库名>:latest`。

**建议：** 在 GitHub Actions 仓库变量设置 `RAKAZO_REF` 为一次构建通过的上游完整 commit SHA，避免以后自动跟随 main 带来补丁失效。补丁在发现不同签名时会报错停构建，而不会悄悄跳过。

镜像首次发布可能是 Private；如果魔搭无法认证 GHCR，应在 GHCR Packages 将镜像设置成 Public。镜像里不能写入真实密钥。

## 3. 魔搭仓库只需要一个 Dockerfile

将 `modelscope/Dockerfile` 上传到魔搭 Docker 创空间仓库根目录，修改成实际镜像路径，例如：

```dockerfile
FROM ghcr.io/yourname/rakazo-modelscope-lite:latest
```

魔搭平台通过 `0.0.0.0:7860` 检测容器。**7860 不负责 Rakazo 管理界面。**

## 4. Cloudflare Tunnel（保持一个域名）

- Cloudflare Zero Trust → Tunnels：使用 remotely managed Tunnel。
- Public Hostname：`rakazo.example.com`（替换为实际域名）。
- Service Type：`HTTP`。
- Service URL：**`http://127.0.0.1:5173`**，不是 7860、3100 或 6080。
- Tunnel Token：填写到魔搭运行时 `TUNNEL_TOKEN`。

不要新增 `desktop.example.com`，不要把 5900/6080 开放到公网。屏幕通过 Rakazo 生成的 `/novnc/session/...` 加密签名能力地址访问，`SCREEN_PROXY_SECRET` 必须保持固定且独立。

### 安全边界

**这个版本按要求让 Rakazo API/Worker/Web/Chrome/Agent 作为 root 运行。** Chrome 启动必须加 `--no-sandbox`。恶意网页或 Agent 命令可能影响整个容器并读取同容器中的应用/数据库凭据。只适合一次性、单用户、隔离的私人实验；切勿放置生产数据或不可信 Agent 任务。即使配置 Cloudflare Access，也不能视为生产级安全隔离。

魔搭的原始创空间访问入口也要设为私有；否则可能绕过 Cloudflare Access。Electron 客户端不一定兼容 Access 的网页登录重定向，需要单独验证。**不能为了兼容客户端就把 root 开发实例公开裸奔。**

## 5. 魔搭运行时环境变量

复制 `deploy/env.example`，在魔搭 Settings / Secrets 中逐项设置，**不要上传包含密钥的 `.env` 文件。**

必须设置（11 项）：

| 变量 | 要求 |
| --- | --- |
| `POSTGRES_PASSWORD` | 管理员密码；32+ 十六进制字符 |
| `POSTGRES_APP_PASSWORD` | 另一组独立密码；32+ 十六进制字符 |
| `BETTER_AUTH_SECRET` | 32+ 随机字符 |
| `ENCRYPTION_KEY` | 恰好 64 个十六进制字符 |
| `SCREEN_PROXY_SECRET` | 独立随机字符，跨重启保持不变 |
| `OWNER_EMAIL` | 首次管理员邮箱 |
| `OWNER_PASSWORD` | 至少 16 字符 |
| `BETTER_AUTH_URL` | `https://rakazo.example.com` |
| `WEB_ORIGIN` | 与 `BETTER_AUTH_URL` 完全一致 |
| `RAKAZO_HOST` | `rakazo.example.com`（不带 https） |
| `TUNNEL_TOKEN` | Cloudflare Tunnel 真实 Token |

建议还设置 `RAKAZO_ALLOWED_HOSTS=rakazo.example.com` 和 `API_URL=https://rakazo.example.com`。无需数据库 URL：启动脚本会在容器中根据两个 PostgreSQL 密码生成。

下列变量在镜像/启动脚本中固定：`NODE_ENV=development`、`SANDBOX_PROVIDER=desktop`、`RAKAZO_X11=1`、`DATA_DIR=/var/lib/rakazo/data`、`DISPLAY=:99`。没有 `/mnt/workspace`，没有外部数据库，也没有额外的 VNC 密码环境变量。VNC 使用回环地址 + view-only，外部鉴权依靠 Rakazo 自身的签名屏幕代理。

> 数据只保存到可写容器层；删除或替换容器会丢失 PostgreSQL、Chrome 登录态与文件。没有自动备份。

## 6. 首次启动验收

在魔搭终端执行：

```bash
# 7860：魔搭健康服务
curl -fsS http://127.0.0.1:7860/health
curl -fsS http://127.0.0.1:7860/ready

# 5173：Rakazo 页面（不能是 API 3100）
curl -I http://127.0.0.1:5173/

# 6080：本地 noVNC 页面，只可容器内访问
curl -I http://127.0.0.1:6080/vnc.html

# 进程权限检查（API/Worker/Chrome 是 root，数据库是 postgres）
ps -eo user,pid,args | grep -E 'postgres|apps/api|apps/worker|chrome|Xvfb|x11vnc|websockify' | head -30

# X11 真实桌面截图
desktopctl size
desktopctl screenshot /var/lib/rakazo/screenshots/first.png
```

`/ready` 应报告 `postgres`、`api`、`web`、`vnc`、`screen` 为 `true`。

然后用浏览器或 Rakazo Existing instance 客户端登录 `https://rakazo.example.com`，进入 Agent 的 **Computer** 面板测试实时桌面。`computer_observe` 应当看到真实截图，而非原版占位图。

### 如果电脑画面打不开

1. 先在容器中验证 `curl http://127.0.0.1:6080/vnc.html` 与 `desktopctl screenshot`。
2. 查看 Rakazo Web 日志的 `screen.proxy.target_rejected`、`screen.proxy.websocket_handshake_failed`、`screen.proxy.websocket_upgraded`，以及 API 对 `computer.screenUrl` 的响应。
3. 保证 CF Tunnel 指向 5173，`BETTER_AUTH_URL`、`WEB_ORIGIN`、`API_URL` 均是外部 HTTPS 域名。
4. **注意：** 本版仅把 `connectScreen()` 接到内部 noVNC URL，未在真实 Rakazo 的 API→Web 屏幕代理中做端到端测试。如果该代理拒绝 loopback 上游、noVNC 资源重写不兼容，仍需针对具体构建版本适配代理层；不能仅凭 6080 能打开就认定客户端实时画面一定成功。

## 7. 已知限制与已测试项目

- 离线完成：Shell 语法、Node JS 语法、上游 `connectScreen` 的补丁模拟、失败时停止构建、Dockerfile/root/VNC 监听静态验证。
- 未在本环境完成：Rakazo 上游实际 Git checkout、TypeScript 全量类型检查、GHCR 构建、魔搭启动、CF WebSocket 升级与客户端屏幕真实显示。这些需通过 GitHub Actions 和实际部署验证。
- `x11vnc -viewonly` + `connectScreen` 拒绝 interactive，只支持**观看**；人工控制和多 Agent 独立桌面没有实现。
- 无独立 Agent 沙箱隔离，数据库与应用同容器，Agent root 极高风险。
- Chrome root 必须 `--no-sandbox`；无法确保网页与主控安全隔离。
- 镜像依赖 upstream Rakazo 主分支的 Desktop Provider 结构；建议锁定上游 commit 后正式使用。
- Google Chrome 与 cloudflared 的下载链接仍是非校验版；需要确定可重现/供应链可控时，应固定版本、哈希并自行验证镜像。

官方参考：

- https://github.com/elie222/rakazo/blob/main/packages/adapters/src/desktop-sandbox.ts
- https://github.com/elie222/rakazo/blob/main/docs/computer-runtime.md
- https://github.com/elie222/rakazo/blob/main/docs/self-host.md
- https://github.com/novnc/noVNC
