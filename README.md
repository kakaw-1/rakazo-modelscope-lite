# Rakazo 魔搭单容器版（Desktop Provider + Chrome + Cloudflare Tunnel）

**状态：实验性源码与构建流程，尚未在 GHCR/魔搭完成实际镜像构建或端到端测试。**

把 [Rakazo](https://github.com/elie222/rakazo) 打包成**一个 Docker 容器**，跑在魔搭（ModelScope）Docker 创空间，再通过 Cloudflare Tunnel 暴露给手机浏览器或桌面客户端访问。

本仓库**不包含 Rakazo 源码**：GitHub Actions 在构建时拉取上游仓库，把本仓库的 `deploy/` 覆盖进去后编译镜像。

- 架构图、完整部署步骤、运行限制：见 **[README.zh-CN.md](README.zh-CN.md)**
- 构建流水线：[`.github/workflows/build-image.yml`](.github/workflows/build-image.yml) → 推送 `ghcr.io/kakaw-1/rakazo-modelscope-lite:latest`
- 魔搭侧：[`modelscope/Dockerfile`](modelscope/Dockerfile) 只用 `FROM` 拉取该镜像，不在魔搭重新编译
- 运行时变量清单：[`deploy/env.example`](deploy/env.example)（全部是占位符，**真实密钥请只填到魔搭运行环境，不要提交到 Git**）
- 容器入口：[`deploy/entrypoint.sh`](deploy/entrypoint.sh)；桌面补丁：[`deploy/patch-desktop.mjs`](deploy/patch-desktop.mjs)

> ⚠️ 仅适合**私人、可信**的开发测试实例：镜像内置 `NODE_ENV=development` + `SANDBOX_PROVIDER=desktop`，Agent 可在容器内直接执行命令并读取同容器的运行时密钥；数据库与截图位于容器可写层，容器重建即丢失。不要用于生产数据。
