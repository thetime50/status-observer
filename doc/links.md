# 状态页 / 监控相关链接

## FlashDuty

*不记录持延迟 废弃*
- 监听/探测：本机 flashcat
- 记数据：FlashDuty（组件状态 / 故障事件 / 不记录持延迟）
- 提供页面：FlashDuty 状态页（play-site-dsh）

- [状态页变更创建 API](https://docs.flashduty.com/zh/api-reference/on-call/status-pages/status-page-change-create)
- [AppKey 管理](https://console.flashcat.cloud/profile/appkey)
- [状态页 play-site-dsh](https://statuspage.flashcat.cloud/play-site-dsh)

## UptimeFlare / Cloudflare
外网监控测试

- 监听/探测：Cloudflare Worker（边缘定时拉目标）
- 记数据：Cloudflare D1（latency / incident）
- 提供页面：Cloudflare Pages（uptimeflare-56u.pages.dev）

- [UptimeFlare 文档 Wiki](https://github.com/lyc8503/UptimeFlare/wiki)
- [Cloudflare API 令牌](https://dash.cloudflare.com/profile/api-tokens)
- [UptimeFlare-Cloud-DSH 仓库](https://github.com/thetime50/UptimeFlare-Cloud-DSH)
- [UptimeFlare 状态页](https://uptimeflare-56u.pages.dev/)

```

令牌权限参考
Workers Agents Configuration: Edit
Containers: Edit
Workers Observability: Edit
Workers Builds Configuration: Edit
D1: Read
D1: Edit
Cloudflare Pages: Edit
Workers R2 Storage: Edit
Workers Tail: Read
Workers KV Storage: Edit
Workers Scripts: Edit
Account Settings: Read

///
Account - Cloudflare Pages: Edit
Account - Workers Scripts - Edit
Account - D1 - Edit ← 这一行是你报错的核心原因
Account - Workers KV Storage - Edit（保险起见加上）
Account - Account Settings - Read
```

## Uptime Kuma
本机监控 status没有小时数据

- 监听/探测：本机 Uptime Kuma 服务（主动探站点）
- 记数据：本机 Uptime Kuma（含延迟历史）
- 提供页面：本机控制台 / 状态页（局域网可访问即可）
- 命令 Demo（`cd tools/uptime-kuma`）：
  - `node kuma.mjs deploy` — 启动容器，首次打开页面创建管理员
  - `node kuma.mjs import ./monitors.json` — 从指定 JSON 导入本机库（可先复制 `monitors.example.json`）
  - `node kuma.mjs export ./monitors.json` — 导出到指定 JSO

- [本机控制台](http://127.0.0.1:3002/)（端口 3002）
- [原 status 页](http://127.0.0.1:3002/status/tunnel-pst)
- [Status v2（旁路 + recent 图）](http://127.0.0.1:3002/status-v2/tunnel-pst)
- [GitHub 仓库](https://github.com/louislam/uptime-kuma)
- [官网 / 文档](https://uptime.kuma.pet/)
- [公开状态页 Demo](https://status.kuma.pet/)

## checkmeta

参考 未部署

- Checkmate 状态页可开 Show charts 显示近期响应时间柱状图
- [Checkmate 官网](https://checkmate.so/)
- [Checkmate 状态页文档](https://docs.checkmate.so/users-guide/status-pages)