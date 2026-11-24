# UptimeFlare 部署

部署出错时先看官方 [Quickstart](https://github.com/lyc8503/UptimeFlare/wiki/Quickstart)。官方步骤里没有下面这份权限清单，所以留在这里。

本仓库新建环境用改过的 UptimeFlare-Cloud-DSH 当模板，不从上游 `lyc8503/UptimeFlare` 重新 fork。

---

仓库和发布由本机命令完成，探测仍在 Cloudflare。用户要事先准备 API Token，并登录 `gh`。

### 操作流程

**1. 准备 Token（只做一次）**
登录 Cloudflare，进入 [API Tokens 页面](https://dash.cloudflare.com/profile/api-tokens)，点击“Create Token”。选择 **“Edit Cloudflare Workers”** 模板，账户资源设为你的账户，区域资源设为“所有区域”，生成后**立即复制 Token**（只显示一次）。放到本机环境变量 `CLOUDFLARE_API_TOKEN`。

GitHub 读不回已有仓库里的 Secret，所以不能从旧仓库自动拷贝。本机没有这个值时，命令停下来，不建仓库。

确认以下权限都有

Account - Cloudflare Pages: Edit
Account - Workers Scripts - Edit
Account - D1 - Edit
Account - Workers KV Storage - Edit（保险起见加上）
Account - Account Settings - Read

**2. 启动国际**
本机先登录 `gh`。跑「启动国际」并传入该场景的 `intl` 目录。远端仓库还不存在时，命令自己做完：

- `gh repo create` 建空仓库，不带 README（带了的话第一次 push 历史对不上）
- 用本机 Token 执行 `gh secret set CLOUDFLARE_API_TOKEN`
- 新场景先按场景名改 D1、Worker、Pages 的名字，避免盖掉已有环境
- `git push -u <远端> <本地分支>:main`，由该仓库的 GitHub Action 部署

已有业务环境不新建仓库：本地分支 `Cloud-DSH` 推到 `UptimeFlare-Cloud-DSH` 的 `main`，资源名仍是 `uptimeflare_d1`、`uptimeflare_worker`、`uptimeflare`。

**3. 以后再跑**
仓库和 Secret 已经有了，就只更新配置并再次 push 到该远端的 `main`。

**4. 部署失败**
看该仓库 Actions 日志。再对照官方 [Quickstart](https://github.com/lyc8503/UptimeFlare/wiki/Quickstart) 和上面的权限清单。

### 补充说明

- **D1 数据库变更**：2026 年 1 月起，UptimeFlare 已从 KV 迁移到 D1 数据库，新部署会自动创建 D1 资源，无需手动操作。
- **监控限制**：免费版单次 cron 最多执行 **50 个**子请求，因此监控项上限为 50 个（1 分钟精度）。
- **详细文档**：如果配置过程中遇到问题，可以参考项目的 [Wiki 页面](https://github.com/lyc8503/UptimeFlare/wiki) 获取更完整的配置说明。
