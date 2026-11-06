# Rakazo ModelScope Lite — root + 客户端内置实时桌面（实验版）

**状态：实验性源码与构建流程，尚未在本环境完成 GHCR 构建、魔搭启动与客户端实时画面的端到端验证。**

把 [Rakazo](https://github.com/elie222/rakazo) 打包成**一个 Docker 容器**，跑在魔搭（ModelScope）Docker 创空间，再通过 Cloudflare Tunnel 暴露给手机浏览器或桌面客户端访问。

本仓库**不包含 Rakazo 源码**：GitHub Actions 在构建时拉取上游仓库，把本仓库的 `deploy/` 覆盖进去、跑一遍静态检查后编译镜像。

## 这一版做了什么

- **实时桌面**：容器内 `Xvfb :99` + Openbox + Chrome；`x11vnc -viewonly`（5900）+ `websockify`/noVNC（6080）只绑定 `127.0.0.1`，画面通过 Rakazo 自带的受认证 `/novnc/session/...` 代理嵌进电脑客户端的 Computer 面板，**不新开公网 noVNC 页面、不加第二个域名**。
- **只读观看**：`-viewonly` + Provider 拒绝 `interactive` 会话，人不能通过 VNC 接管桌面；AI 仍走内部 X11 工具截图/点击。
- **全部 root 运行**：API/Worker/Web/Chrome/Agent 都是 root，Chrome 必须带 `--no-sandbox`；数据库仍由 `postgres` 账户运行。

## 文件导航

- 架构图、完整部署步骤、运行限制与验证清单：**[README.zh-CN.md](README.zh-CN.md)**
- 构建流水线：[`.github/workflows/build-image.yml`](.github/workflows/build-image.yml) → 推送 `ghcr.io/kakaw-1/rakazo-modelscope-lite:latest`
- 魔搭侧：[`modelscope/Dockerfile`](modelscope/Dockerfile) 只用 `FROM` 拉取该镜像，不在魔搭重新编译
- 容器入口编排：[`deploy/entrypoint.sh`](deploy/entrypoint.sh)；桌面/屏幕补丁：[`deploy/patch-desktop.mjs`](deploy/patch-desktop.mjs)
- 运行时变量清单：[`deploy/env.example`](deploy/env.example)（全部是占位符，**真实密钥请只填到魔搭运行环境，不要提交到 Git**）
- 本地静态检查：[`tests/check.sh`](tests/check.sh) / [`tests/check.mjs`](tests/check.mjs)（CI 在构建前也会跑）

> ⚠️ **仅供一次性、单用户、隔离的私人实验。** root + `--no-sandbox` + 开发模式意味着恶意网页或 Agent 命令可能影响整个容器并读取同容器的应用/数据库凭据；没有 Agent 沙箱隔离，数据库与截图位于容器可写层，容器重建即丢失。不要放生产数据。魔搭创空间自身的访问入口也要设为私有，否则可能绕过 Cloudflare Access。
