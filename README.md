# nodeimage-tg-bot

Cloudflare Workers + Telegram 图床，后端 [nodeimage](https://www.nodeimage.com/)。  
发图 → 直链 / Markdown；支持列表、详情、删除。

完整部署步骤见 **[DEPLOY.md](./DEPLOY.md)**。

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `TG_BOT_TOKEN` | 是 | BotFather Token |
| `TG_CHAT_ID` | 是 | 你的 TG 用户 ID（仅你可用） |
| `NODEIMAGE_API_KEY` | 是 | nodeimage 密钥；HTTP 鉴权同此 |
| `TG_WEBHOOK_SECRET` | 建议 | 与 `setWebhook.secret_token` 一致 |
| `CORS_ORIGIN` | 否 | 默认禁止浏览器跨域 |

上传：仅图片，最大 15MB。API：`https://api.nodeimage.com`。

## 快速部署

1. CF Worker 粘贴 [`worker.js`](./worker.js) → Deploy  
2. 填上表变量（敏感值 Encrypt）  
3. 挂 Webhook：

```bash
curl -sS -X POST "https://api.telegram.org/bot<TG_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://<WORKER>/webhook","secret_token":"<TG_WEBHOOK_SECRET>"}'
```

## 使用

| 操作 | 方式 |
|---|---|
| 上传 | 发图（压缩图 / 文件 / 静态贴纸） |
| 列表 | `/list` · `/list 10` |
| 详情 | `/info <id>` 或回复后 `/info` |
| 删除 | `/del <id>` 或回复后 `/del` |
| 帮助 | `/start` `/help` |

## HTTP 代理

`X-API-Key: <NODEIMAGE_API_KEY>`

```bash
curl -X POST   "$BASE/api/upload" -H "X-API-Key: $KEY" -F "image=@a.png"
curl -X GET    "$BASE/api/image/<id>" -H "X-API-Key: $KEY"
curl -X GET    "$BASE/api/images" -H "X-API-Key: $KEY"
curl -X DELETE "$BASE/api/image/<id>" -H "X-API-Key: $KEY"
```

兼容：`GET /api/v1/images`、`DELETE /api/v1/delete/<id>`。
