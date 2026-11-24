# Status-v2 旁路设计（修订）

## 目标

在 **不 fork、不搬 Kuma 源码** 的前提下，增加 `status-v2`：

- 视觉与交互尽量对齐官方 `/status/:slug`
- 每一条 monitor 增加仪表盘同款「小时级延迟图」
- **同一端口**访问（与现有 3002 对外一致）
- 项目只含增量，体积小、轻量

## 结论

**可以旁路做，推荐：官方 Kuma 镜像不动 + 反代同端口 + 独立轻量 status-v2。**

| 诉求 | 是否可行 | 说明 |
| --- | --- | --- |
| 旁路开发、仓库只放增量 | 是 | 不 import / 不 patch Kuma |
| 同端口访问 | 是 | 前面加 Nginx/Caddy，Kuma 不再直接对外映射 |
| 页面观感接近原 status | 是（近似） | 用公开 API 自绘布局；可对齐结构/色板，难保证与上游逐像素永久一致 |
| 每条加小时 chart | 有条件 | 见下方「数据面」 |
| 极轻量 | 是 | 静态页 + 反代即可起步；要长周期图再加极薄 BFF |

**不推荐**：把 Kuma 当 npm 依赖 / patch 注入 Vue 路由 / 自定义整镜像。那是为「嵌进 Kuma SPA」准备的，和「只加展示页」不成比例。

## 同端口怎么做

对外仍只暴露 **一个端口**（例如继续用 `3002`）：

```text
浏览器 → :3002 (反代)
           ├─ /status-v2/*     → status-v2 静态资源
           ├─ /api/status-page/* → 可直转 Kuma（或由 v2 同源代理）
           └─ /*               → 官方 Uptime Kuma 容器
```

- Kuma 容器内部仍监听 `3001`，**不改镜像**
- compose 增加 `nginx`（或 Caddy），宿主机 `3002:80`，Kuma 仅内网连通
- status-v2 与 API **同源**，无 CORS 问题

路径建议：`/status-v2/:slug`（保留原 `/status/:slug` 不动，便于对比）。

## 「和原 status 一模一样」怎么理解

原页数据来自公开接口（已发布的 status page）：

- `GET /api/status-page/:slug` — 分组、monitor 元数据、incident 等
- `GET /api/status-page/heartbeat/:slug` — 近期心跳 + uptime

**轻量一致做法（推荐）**

1. 按原页信息架构自绘：标题 / 分组 / 每条状态条 / 最近心跳点阵 / incident
2. 在每条下方加 chart（这是相对原页的**唯一增量**）
3. 样式可参考 Kuma 公开页的大致布局与颜色，不拷贝整份 Vue 工程

**不追求的部分**

- 不嵌入 Kuma 的 `StatusPage.vue`（会拖进构建链）
- 不保证上游改版后 100% 像素一致（那是维护成本，不是第一版目标）

## 数据面：小时 chart 的卡点

要对齐的仪表盘组件是 monitor 详情页里的包层 + `PingChart`：

```html
<div class="shadow-box big-padding text-center ping-chart-wrapper">
  <PingChart :monitor-id="..." />
</div>
```

- 源码：`src/components/PingChart.vue`（上游 [PingChart.vue](https://github.com/louislam/uptime-kuma/blob/master/src/components/PingChart.vue)）
- 挂载位置：`src/pages/Details.vue`（仪表盘某个 monitor 详情，**不在**公开 `/status/:slug` 上）
- 技术栈：Chart.js + `vue-chartjs` 的 `Line`；叠加 **折线（ping）+ 柱状（down/maintenance/pending 状态）**
- 壳样式：`.shadow-box` / `.big-padding` / `.ping-chart-wrapper`（小屏会压 padding）

### PingChart 行为（对齐目标）

周期切换（右上角）：

| `chartPeriodHrs` | UI 文案 | 数据来源 |
| --- | --- | --- |
| `0` | recent（最近） | 内存里的 `heartbeatList[monitorId]`（约最近 100 条心跳） |
| `3` / `6` / `24` / `168` | 3h / 6h / 24h / 1w | Socket **`getMonitorChartData(monitorId, periodHours)`**（需登录） |

两种渲染路径：

1. **`getChartDatapointsFromHeartbeatList()`**（recent）  
   - 单条折线：UP 时画 `ping`，否则 `null`  
   - 柱：DOWN / MAINTENANCE / PENDING → 1，颜色区分  
   - 探测间隔空隙过大时插空点断开折线  

2. **`getChartDatapointsFromStats()`**（3h～1w）  
   - 用 `UptimeCalculator` 聚合点：`timestamp / up / down / maintenance / avgPing / minPing / maxPing`  
   - 三条折线：min / avg / max ping；柱表示该桶 down(+maintenance)  
   - 点多时会做滑动窗口聚合；非 recent 时约每 **5 分钟** 再拉一次  

Socket 契约（内部 API，不稳定、需登录）：

```text
emit("getMonitorChartData", monitorID, periodHours, cb)
→ cb({ ok, data?: Array<{ timestamp, up, down, maintenance?, avgPing, minPing, maxPing }>, msg? })
```

公开 status 页 **没有** 这个组件，也 **调不到** `getMonitorChartData`。

### 公开 API 覆盖范围

公开 `GET /api/status-page/heartbeat/:slug` 大约只给每 monitor **最近 ~100 条**心跳 —— 能力上限接近 PingChart 的 **recent**，不是 24h/1w。

| 探测间隔 | ~100 条大约覆盖 | 对标 PingChart |
| --- | --- | --- |
| 60s | ~1.7 小时 | ≈ recent；不够 3h/6h/24h/1w |
| 5min | ~8 小时 | recent～短窗口；仍不够 24h/1w 聚合桶 |
| 要 3h～1w 同款 | 公开 API 不够 | 需档 B 补 `getMonitorChartData` 同类数据 |

### 两档实现（按轻量优先）

**档 A（最轻，推荐先做）——对齐 PingChart「recent」**

- 仅用公开 `status-page` + `heartbeat`
- 每条 monitor 下仿 `ping-chart-wrapper` 壳，用 Chart.js 画：ping 折线 + down 柱（逻辑对齐 `getChartDatapointsFromHeartbeatList`）
- 可不做周期下拉，或下拉里只保留 recent
- **零后端、零登录、零改 Kuma**
- **不等于**仪表盘 3h/24h/1w

**档 B（对齐 PingChart 全周期）**

旁路加 **极薄只读 BFF**（仍不改 Kuma 镜像），给前端提供与 `getMonitorChartData` 同形的聚合点：

1. **只读挂载 `kuma.db`**（与现有 `./data` 同源只读），按 period 聚合后暴露  
   例如：`GET /status-v2/api/chart/:monitorId?period=24`  
2. 或 BFF 内用管理员凭据调 Socket `getMonitorChartData`（凭据不出浏览器；升级脆裂，不如读库稳）

前端再实现周期切换 + `getChartDatapointsFromStats` 同类的 min/avg/max 折线。  
档 B 仍是旁路小项目；**不要** fork，也 **不要** 把 `PingChart.vue` 整文件搬进仓库当依赖（Chart 逻辑可薄复刻）。

## 推荐最小目录（增量 only）

挂在现有 `tools/uptime-kuma/` 下即可：

```text
tools/uptime-kuma/
  docker-compose.yml          # 现有 kuma + 增加 reverse-proxy（及可选 status-v2）
  data/                       # 现有，Kuma 写；档 B 只读
  status-v2/
    public/                   # index.html + app.js + chart（无构建或极简）
    nginx.conf                # 同端口路由
    # 可选档 B：
    # server.mjs              # 只读 db → /status-v2/api/chart/:id
```

仓库 **不包含** Uptime Kuma 源码。

## 精简架构

```text
[浏览器] 同一端口 :3002
    │
    ▼
[反代]
    ├─ /status-v2/**     → status-v2 静态（+ 可选 BFF）
    └─ /**               → Uptime Kuma 官方容器
                              ├─ 探测 / 存库 / 原控制台
                              └─ 原 /status/:slug（保留）
```

- **探测与存数据**：仍全部由官方 Kuma 负责  
- **status-v2**：只读展示 + chart  
- **一致性**：公开 API 对齐原 status 结构；chart 为每条增量  
- **轻量**：档 A 几乎只有静态文件；档 B 多一个只读小服务

## 明确不做

- 不 fork Kuma，不把整仓 Vue/Server 搬进本仓库  
- 不自定义 Kuma 镜像仅为了塞一个页面  
- 不在浏览器里塞管理员 Token 调 Socket（不安全且不稳定）

## 落地状态

已完成同端口档 A + 轻量档 B：

- slug：`tunnel-pst`
- 访问：http://127.0.0.1:3002/status-v2/tunnel-pst
- 原页：http://127.0.0.1:3002/status/tunnel-pst
- 图表上：后台同款周期下拉（recent / 3h / 6h / 24h / 1w）
- 每站点下：事件日历（默认折叠、懒加载；异常日红圈；点选范围联动图表）
- API：`/status-v2/api/beats/:id`、`/status-v2/api/anomaly-days/:id`（只读 `kuma.db`）

---

来源：对照 GPT「依赖 + Patch」原方案后的修订；主推旁路路线 2，并收束为「同端口 + 近似原 status + 分档 chart」。
