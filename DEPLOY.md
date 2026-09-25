# 部署

仓库：https://github.com/1x2345/nodeimage-tg-bot

## 准备

| 材料 | 来源 |
|---|---|
| CF 账号 | [dash.cloudflare.com](https://dash.cloudflare.com)（免费即可） |
| `TG_BOT_TOKEN` | [@BotFather](https://t.me/BotFather) → `/newbot` |
| `TG_CHAT_ID` | [@userinfobot](https://t.me/userinfobot) |
| `NODEIMAGE_API_KEY` | nodeimage 控制台 |
| `TG_WEBHOOK_SECRET` | `openssl rand -hex 24`（建议） |

密钥只进 CF 变量，不要写进代码 / git。

## 1. Worker

1. **Workers & Pages** → Create Worker → Deploy  
2. **Edit code** → 全文替换为 [`worker.js`](./worker.js) → **Save and deploy**  
3. 记下 `https://<WORKER>`（`*.workers.dev`）  
4. 打开 `https://<WORKER>/` 应返回 `{"ok":true}`

## 2. 变量

**Settings → Variables and Secrets**（建议 Encrypt）：

| 变量 | 必填 |
|---|---|
| `TG_BOT_TOKEN` | 是 |
| `TG_CHAT_ID` | 是 |
| `NODEIMAGE_API_KEY` | 是 |
| `TG_WEBHOOK_SECRET` | 建议 |
| `CORS_ORIGIN` | 否（默认关跨域；需要时填来源或 `*`） |

Save / Deploy。代码限制：图片 MIME，≤15MB。

## 3. Webhook

```bash
curl -sS -X POST "https://api.telegram.org/bot<TG_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://<WORKER>/webhook","secret_token":"<TG_WEBHOOK_SECRET>"}'
```

核对：

```bash
curl -sS "https://api.telegram.org/bot<TG_BOT_TOKEN>/getWebhookInfo"
```

卸掉：`.../deleteWebhook`

> 未配 `TG_WEBHOOK_SECRET` 时不校验该头；强烈建议配置，防他人 POST `/webhook`。

## 4. 验收

私聊 Bot：发图应回 id + 直链 + Markdown；再试 `/list` `/info` `/del`。

- 仅 `TG_CHAT_ID` 对应用户有响应  
- 回复上传消息可 `/info` `/del`（认 `id:` 行）  
- 动图 / 视频贴纸不支持

## HTTP（可选）

```bash
BASE="https://<WORKER>"
KEY="<NODEIMAGE_API_KEY>"
curl -sS -X POST "$BASE/api/upload" -H "X-API-Key: $KEY" -F "image=@a.png"
curl -sS -X GET  "$BASE/api/image/<id>" -H "X-API-Key: $KEY"
curl -sS -X GET  "$BASE/api/images" -H "X-API-Key: $KEY"
curl -sS -X DELETE "$BASE/api/image/<id>" -H "X-API-Key: $KEY"
```

## 排障

| 现象 | 处理 |
|---|---|
| 完全没回 | webhook URL；是否他人在聊；secret 是否一致 |
| webhook 403 | `TG_WEBHOOK_SECRET` ≠ setWebhook |
| 缺少 CHAT_ID / TOKEN / KEY | 变量名错或未 Deploy |
| 文件过大 / 类型 | >15MB 或非图片 |
| 无效 image_id | 格式不对；回复里无 `id:` |
| nodeimage 403 | 换最新 `worker.js` 重部署；查密钥 |
| HTTP 401 | 头 `X-API-Key` |
| 浏览器 CORS | 设 `CORS_ORIGIN` |

日志：Worker → **Logs** → Begin log stream。

## 更新

复制最新 `worker.js` → Edit code 全替 → Deploy；检查是否新增变量。

## 安全

- [ ] `TG_CHAT_ID` 已填  
- [ ] `TG_WEBHOOK_SECRET` + setWebhook 同值  
- [ ] 密钥均为 Secret，未进 git / 前端  
- [ ] 勿对公网开 `CORS_ORIGIN=*`  
- [ ] 泄露过的 Bot token 已 `/revoke`
