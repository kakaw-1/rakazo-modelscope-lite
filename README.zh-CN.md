# Rakazo 魔搭单容器版：Desktop Provider + Chrome + Cloudflare Tunnel

**状态：可提交到 GitHub 的实验性源码与构建流程，尚未在 GHCR/魔搭完成实际镜像构建或端到端测试。**

架构（参考 herm_lite 的 GitHub Actions -> GHCR -> 魔搭方式）：

```text
你的电脑 Rakazo 客户端 / 手机浏览器
                  │
        https://rakazo.example.com
                  │
          Cloudflare Tunnel
                  │ (only localhost:5173)
 ┌────────────────魔搭单个容器────────────────────┐
 │  PostgreSQL 16     localhost:5432             │
 │  Rakazo API        localhost:3100             │
 │  Rakazo Worker     内部无公开端口              │
 │  Rakazo Web        localhost:5173             │
 │  Chrome/Xvfb       DISPLAY=:99                │
 │  Desktop Provider  真实 PNG + xdotool         │
 │  Health server     0.0.0.0:7860 (魔搭可访问)   │
 │  cloudflared       向 Cloudflare 建立出站连接  │
 └───────────────────────────────────────────────┘
```

不安装 noVNC；PostgreSQL 和 Rakazo 文件均位于容器可写层（`/var/lib/rakazo/pgdata`、`/var/lib/rakazo/data`），**不用 `/mnt/workspace` 或外部数据库**。容器重新创建，数据可能丢失。没有自动备份。

## 1. 在 GitHub 创建部署仓库

在 GitHub 新建仓库，如 `rakazo-modelscope-lite`。将本压缩包 **根目录**下的以下文件上传到该仓库（特别注意隐藏的 `.github/workflows/build-image.yml`）：

```text
rakazo-modelscope-lite/
├── .github/workflows/build-image.yml
├── deploy/
│   ├── Dockerfile
│   ├── entrypoint.sh
│   ├── health.mjs
│   ├── desktop-x11.ts
│   ├── patch-desktop.mjs
│   ├── desktopctl
│   └── env.example
├── modelscope/Dockerfile
├── tests/check.sh
└── README.zh-CN.md
```

GitHub Actions 将在构建过程中从 `elie222/rakazo` 拉取**完整源码**，覆盖本项目的 `deploy` 文件，运行源代码补丁并构建镜像。你不需要在这个部署仓库手工复制 Rakazo 源码。

构建时上游源码默认使用 `main`。为了防止 Rakazo 后续修改导致补丁冲突，建议在 GitHub 仓库的 `Settings -> Secrets and variables -> Actions -> Variables` 里设置 `RAKAZO_REF` 为通过构建验证的完整 Git commit SHA；也可以在 `Actions -> Build Rakazo ModelScope image -> Run workflow` 里手动输入一个 Git commit SHA。

推送到 `main` 后，GitHub Actions 运行 `Build Rakazo ModelScope image`，构建并推送镜像到：

```text
ghcr.io/<github-owner>/<repo-name>:latest
```

标签统一转为小写。还会生成 `sha-...` 标签。仅主分支构建会推送 `latest`。`GITHUB_TOKEN` 用于 GHCR 登录，不需要额外 PAT。查看 Actions 运行记录，**镜像成功推送后**再继续下一步。

> GHCR 包首次发布可能默认为私有。若魔搭没有使用私有仓库凭据的方式，需要在 GitHub Packages 中将该镜像设置为 Public（构建镜像内不放账户密钥）。

## 2. 建立 Cloudflare Tunnel

1. Cloudflare Zero Trust -> Networks -> Tunnels -> Create Tunnel，选择 Cloudflared，创建 **remotely-managed** Tunnel。
2. 为该 Tunnel 建立一个 Public Hostname，例如 `rakazo.example.com`。
3. **Service Type = HTTP；Service URL = `http://127.0.0.1:5173`**，不是 7860。
4. 复制 Tunnel Token 到魔搭的运行环境变量 `TUNNEL_TOKEN`。
5. 通过 Cloudflare Access 限制访问，尤其不要暴露给不可信用户。Electron 桌面客户端可能不支持 Cloudflare Access 的额外重定向登录；需要单独验证。不要为了兼容桌面客户端就将开发模式实例裸露在公网。

没有第二个域名，也不暴露 VNC、Chrome 调试端口或数据库端口。

## 3. 创建魔搭 Docker 创空间

1. 在 ModelScope 新建 Docker 创空间；使用的机器架构必须是 **linux/amd64**。
2. 将本项目 `modelscope/Dockerfile` 内容作为魔搭仓库的 Dockerfile，替换 GHCR 镜像路径。魔搭只负责拉取镜像，不在魔搭重新编译 Rakazo。
3. 在魔搭运行时环境变量（Secrets）中逐项添加 `deploy/env.example` 中的变量；**不要将填写密钥后的文件提交到 Git**。
4. 确保应用对魔搭监听 `0.0.0.0:7860`。端口 7860 用于健康检查；`/` 与 `/health` 返回 200，`/ready` 仅在本地 PostgreSQL、API、Web 监听时返回 200。
5. 启动实例。查看日志，应依次看到 PostgreSQL 启动、数据库迁移、创建管理员、Xvfb/Chrome、API/Worker、Web 和 cloudflared。

关键运行时变量（完整示例在 `deploy/env.example`）：

```dotenv
POSTGRES_PASSWORD=<至少32位hex>
POSTGRES_APP_PASSWORD=<另外一组至少32位hex>
BETTER_AUTH_SECRET=<32字符以上随机串>
ENCRYPTION_KEY=<恰好64位hex>
SCREEN_PROXY_SECRET=<单独随机串>
OWNER_EMAIL=you@example.com
OWNER_PASSWORD=<至少16字符>
BETTER_AUTH_URL=https://rakazo.example.com
WEB_ORIGIN=https://rakazo.example.com
RAKAZO_HOST=rakazo.example.com
RAKAZO_ALLOWED_HOSTS=rakazo.example.com
TUNNEL_TOKEN=<Cloudflare Token>
```

PostgreSQL 的管理员密码和应用密码是 **两组不同的随机 hex**。容器启动脚本自动组装 `DATABASE_MIGRATION_URL` / `DATABASE_URL`，不用手动配置外部数据库，也不用暴露 5432。Rakazo 自带迁移脚本会创建 runtime 数据库角色并设置访问权限。

`NODE_ENV=development` 和 `SANDBOX_PROVIDER=desktop` 已内置于镜像。Desktop Provider 在上游拒绝 production 环境，因为 Agent 将在应用所在容器内直接执行命令。此版本只能当私人、受信任的开发测试实例使用。若 Linux Chrome 沙箱在魔搭不支持，可以尝试设置 `CHROME_NO_SANDBOX=1`，但会明显削弱安全性。

## 4. 验证访问

从魔搭控制台检查：

```bash
curl -fsS http://127.0.0.1:7860/health
curl -fsS http://127.0.0.1:7860/ready
```

从手机 Safari/Chrome 打开 `https://rakazo.example.com` 并登录。电脑可通过浏览器或 Rakazo 客户端选择已有实例，输入同一个 URL（客户端与 CF Access 的兼容性需要单独测试）。

从容器内部的终端验证图形浏览器：

```bash
gosu rakazo env DISPLAY=:99 /app/infra/modelscope-single/desktopctl size
gosu rakazo env DISPLAY=:99 /app/infra/modelscope-single/desktopctl url https://example.org
gosu rakazo env DISPLAY=:99 /app/infra/modelscope-single/desktopctl screenshot /var/lib/rakazo/screenshots/test.png
```

最后让 Rakazo Agent 使用 `computer_observe` 观察真实 PNG、使用 `computer_act` 点击输入；如果只得到 1x1 占位图，检查构建日志里的桌面补丁以及 `RAKAZO_X11=1`。这版会设置 `graphical: true`，但 **不会实现 `pageBrowser()` 语义级浏览器工具，也不会实现用户远程桌面画面**；浏览器通过真实桌面截图/点击工具操作。

## 5. 运行行为与限制

- 7860 只提供非敏感健康状态，不转发 Rakazo，也不返回数据库信息。
- Web、API、PostgreSQL 只在 `127.0.0.1` 监听。CF Tunnel 只将域名映射到本地 Web 5173。
- 数据库和截图在容器本地可写层，不挂载 `/mnt/workspace`。容器重建和镜像替换会丢失数据。不要在这里保存生产数据、长效密钥或唯一文件。
- GitHub Actions 每次构建镜像都会重新执行源代码补丁；如果 Rakazo 上游改动了目标代码，补丁会**明确报错停止**，避免静默构建出无法操控屏幕的镜像。
- Google Chrome 和 cloudflared 下载地址目前没有 pin/hash；为了可复现和供应链安全，正式使用前需锁定具体版本与校验值。
- 同一 Xvfb 显示器供所有 Agent 共享。**只建议单 Agent 操作图形桌面**，不能当作多用户隔离环境。
- Agent、API 和 Worker 都运行在容器里；这不是安全沙箱，Agent 可能读取同容器文件和运行时秘密。配合开发模式，只适合可信测试任务。
- Cloudflare Tunnel 无法防止魔搭创空间休眠或资源被回收。即使 Tunnel 正常，创空间不运行也无法访问。

## 6. 验证状态

**当前只做了本地静态测试**：Shell 和 Node JS 文件语法、补丁脚本的构造性测试、Workflow YAML 解析以及健康服务器接口测试。**未完成完整 Docker build、GHCR 推送、魔搭镜像启动和 Rakazo 端到端浏览器操作实测**，因为本环境无法连接外部源码与镜像仓库执行构建。

参考：

- https://github.com/elie222/rakazo
- https://github.com/elie222/rakazo/blob/main/infra/railway/start.sh
- https://github.com/elie222/rakazo/blob/main/packages/adapters/src/desktop-sandbox.ts
- https://github.com/kakaw-1/herm_lite/blob/main/.github/workflows/docker-build.yml
- https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/
