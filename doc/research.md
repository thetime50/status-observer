

有没有免费稳定的测试域名 几个月
- DigitalPlat FreeDomain：支持改 NS 托管到 Cloudflare，社区反馈相对稳。后缀选 .dpdns.org 或 .us.kg 成功率较高。每年需手动免费续期。
- DNSHE：国内邮箱可注册，支持托管 CF，号称 10 年有效期。但 V2EX 用户反馈其 SLA 较差，仅建议测试用。
- is-a.dev：通过 GitHub PR 申请，纯自动化审核。适合有 GitHub 账号的开发者，但只支持 CNAME/A 等记录，不能改 NS。
- 用 nip.io 或 sslip.io 这类泛解析服务（例如 你的IP.nip.io 自动指向你的 IP）要有公网IP

国内确实有类似的免费穿透服务，但“高速”和“安全”往往难以兼得，免费档普遍有限制：

- 华为云 DevBridge：免费档里比较均衡的选择。每月 50GB 流量，5M 带宽，自带 HTTPS，适合个人轻量使用。
- SakuraFrp：带宽相对大方（约 10M），但流量少（5GiB/月，可签到），且需要实名。
- OpenFrp / ChmlFrp：有免费额度，但限速较紧（约 8-12 Mbps），高峰期可能拥堵，适合测试或极轻量场景。
- 花生壳 / NATAPP：老牌服务，免费档限制较多（如花生壳免费 1 条隧道、带宽较低；NATAPP 免费 1M 带宽、2G 流量/月，域名还会变）。