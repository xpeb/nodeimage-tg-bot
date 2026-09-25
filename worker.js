const API_BASE = 'https://api.nodeimage.com';
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/svg+xml',
]);
const NI_UA =
  'Mozilla/5.0 (Macintosh; ARM64 Mac OS X 15_2_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';

const HELP = [
  '<b>🖼 图床 Bot</b>',
  '',
  '<b>上传</b>  直接发图',
  '<b>列表</b>  /list · /list 10',
  '<b>详情</b>  /info &lt;id&gt;',
  '<b>删除</b>  /del &lt;id&gt;',
  '',
  '<i>回复上传消息后可直接 /info 或 /del</i>',
].join('\n');

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method;

    if (method === 'OPTIONS') return corsPreflight(request, env);

    try {
      if (method === 'POST' && path === '/webhook') return handleWebhook(request, env);

      if (method === 'POST' && path === '/api/upload') return httpUpload(request, env);
      if (method === 'GET' && path.startsWith('/api/image/')) return httpProxy(request, env, () => niInfo(env, path.slice(11)));
      if (method === 'GET' && (path === '/api/images' || path === '/api/v1/images')) {
        return httpProxy(request, env, () => niList(env, url.search || ''));
      }
      if (method === 'DELETE' && path.startsWith('/api/image/')) {
        return httpProxy(request, env, () => niDelete(env, path.slice(11)));
      }
      if (method === 'DELETE' && path.startsWith('/api/v1/delete/')) {
        return httpProxy(request, env, () => niDelete(env, path.slice(15)));
      }
      if (path === '/' || path === '/health') return json({ ok: true }, 200, request, env);
      return json({ error: 'not found' }, 404, request, env);
    } catch (err) {
      return json({ success: false, error: err.message || String(err) }, err.status || 500, request, env);
    }
  },
};

function requireKey(env) {
  if (!env.NODEIMAGE_API_KEY) throw httpErr(500, '缺少 NODEIMAGE_API_KEY');
  return env.NODEIMAGE_API_KEY;
}

function requireChatId(env) {
  const id = env.TG_CHAT_ID;
  if (id == null || String(id).trim() === '') throw httpErr(500, '缺少 TG_CHAT_ID');
  return String(id).trim();
}

function httpErr(status, message, data) {
  const e = new Error(message);
  e.status = status;
  if (data) e.data = data;
  return e;
}

function niHeaders(env) {
  return {
    'X-API-Key': requireKey(env),
    'User-Agent': NI_UA,
    Accept: 'application/json, */*;q=0.8',
  };
}

function corsOrigin(request, env) {
  const conf = (env.CORS_ORIGIN || '').trim();
  if (!conf || conf === '-') return null;
  if (conf === '*') return '*';
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  return conf.split(',').map((s) => s.trim()).includes(origin) ? origin : null;
}

function withCors(res, request, env) {
  const origin = corsOrigin(request, env);
  if (!origin) return res;
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', origin);
  h.set('Vary', 'Origin');
  return new Response(res.body, { status: res.status, headers: h });
}

function corsPreflight(request, env) {
  const origin = corsOrigin(request, env);
  if (!origin) return new Response(null, { status: 204 });
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, Authorization',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    },
  });
}

function assertHttpAuth(request, env) {
  const expected = requireKey(env);
  const h = request.headers;
  const got = h.get('X-API-Key') || h.get('x-api-key') || bearer(h.get('Authorization'));
  if (!got || got !== expected) throw httpErr(401, 'unauthorized');
}

function bearer(v) {
  if (!v) return null;
  const m = String(v).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : String(v).trim();
}

function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const ba = enc.encode(String(a ?? ''));
  const bb = enc.encode(String(b ?? ''));
  const n = Math.max(ba.length, bb.length, 1);
  let diff = ba.length === bb.length ? 0 : 1;
  for (let i = 0; i < n; i++) diff |= (ba[i % ba.length] || 0) ^ (bb[i % bb.length] || 0);
  return diff === 0;
}

async function niUpload(env, bytes, filename, contentType) {
  assertImagePayload(bytes.byteLength, contentType, filename);
  const mime = normalizeMime(contentType, filename);
  const form = new FormData();
  form.append('image', new Blob([bytes], { type: mime }), filename || 'image.bin');
  return parseNi(
    await fetch(`${API_BASE}/api/upload`, { method: 'POST', headers: niHeaders(env), body: form })
  );
}

async function niInfo(env, imageId) {
  const id = encodeURIComponent(sanitizeId(imageId));
  return parseNi(await fetch(`${API_BASE}/api/image/${id}`, { headers: niHeaders(env) }));
}

async function niList(env, query = '') {
  const q = !query ? '' : query.startsWith('?') ? query : `?${query}`;
  return parseNi(await fetch(`${API_BASE}/api/v1/images${q}`, { headers: niHeaders(env) }));
}

async function niDelete(env, imageId) {
  const id = encodeURIComponent(sanitizeId(imageId));
  return parseNi(
    await fetch(`${API_BASE}/api/v1/delete/${id}`, { method: 'DELETE', headers: niHeaders(env) })
  );
}

function sanitizeId(imageId) {
  const id = String(imageId || '').trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) throw httpErr(400, '无效 image_id');
  return id;
}

function normalizeMime(contentType, filename) {
  let raw = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (raw === 'image/jpg') raw = 'image/jpeg';
  return ALLOWED_MIME.has(raw) ? raw : guessMime(filename);
}

function assertImagePayload(size, contentType, filename) {
  if (!Number.isFinite(size) || size <= 0) throw httpErr(400, '空文件');
  if (size > MAX_UPLOAD_BYTES) throw httpErr(413, `文件过大（>${MAX_UPLOAD_BYTES} bytes）`);
  const mime = normalizeMime(contentType, filename);
  if (!ALLOWED_MIME.has(mime)) throw httpErr(415, `不支持的类型: ${mime || 'unknown'}`);
}

async function parseNi(res) {
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    let msg = `上游非 JSON (${res.status})`;
    if (res.status === 403) msg = 'nodeimage 403（请求被拦截）';
    else if (res.status === 429) msg = 'nodeimage 限流 429';
    else if (text) msg += `: ${text.replace(/\s+/g, ' ').slice(0, 80)}`;
    throw httpErr(res.status || 502, msg);
  }
  const errMsg = typeof data.error === 'string' && data.error ? data.error : null;
  if (!res.ok || data.success === false || errMsg) {
    throw httpErr(res.status || 502, data.message || errMsg || `HTTP ${res.status}`, data);
  }
  return data;
}

async function httpProxy(request, env, fn) {
  try {
    assertHttpAuth(request, env);
    return json(await fn(), 200, request, env);
  } catch (e) {
    return json({ success: false, error: e.message, ...(e.data || {}) }, e.status || 500, request, env);
  }
}

async function httpUpload(request, env) {
  try {
    assertHttpAuth(request, env);
    if (!(request.headers.get('content-type') || '').includes('multipart/form-data')) {
      throw httpErr(400, '需要 multipart field: image');
    }
    const file = (await request.formData()).get('image') || null;
    if (!file || typeof file === 'string') throw httpErr(400, '缺少 image');
    return json(
      await niUpload(env, await file.arrayBuffer(), file.name || 'image.bin', file.type || 'application/octet-stream'),
      200,
      request,
      env
    );
  } catch (e) {
    return json({ success: false, error: e.message, ...(e.data || {}) }, e.status || 500, request, env);
  }
}

async function handleWebhook(request, env) {
  const secret = (env.TG_WEBHOOK_SECRET || '').trim();
  if (secret) {
    const got = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
    if (!timingSafeEqual(got, secret)) return new Response('forbidden', { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return ok();
  }

  const msg = body.message || body.edited_message;
  if (!msg) return ok();

  const botToken = env.TG_BOT_TOKEN;
  const chatId = msg.chat && msg.chat.id;

  let allowed;
  try {
    allowed = requireChatId(env);
  } catch (e) {
    if (botToken && chatId != null) await tg(botToken, chatId, errCard(e.message));
    return ok();
  }
  if (String(chatId) !== allowed) return ok();

  try {
    if (!botToken) throw new Error('缺少 TG_BOT_TOKEN');
    requireKey(env);

    const text = (msg.text || msg.caption || '').trim();
    const cmd = parseCommand(text);
    if (cmd) {
      await dispatchCommand(env, botToken, chatId, cmd, msg);
      return ok();
    }

    const media = extractMedia(msg);
    if (media) {
      await doUploadFromTg(env, botToken, chatId, media);
      return ok();
    }

    if (text) await tg(botToken, chatId, HELP);
  } catch (err) {
    await tg(botToken, chatId, errCard(err.message || err));
  }
  return ok();
}

function ok() {
  return new Response('OK', { status: 200 });
}

function parseCommand(text) {
  if (!text || !text.startsWith('/')) return null;
  const m = text.match(/^\/([a-zA-Z0-9_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/);
  return m ? { name: m[1].toLowerCase(), arg: (m[2] || '').trim() } : null;
}

async function dispatchCommand(env, botToken, chatId, cmd, msg) {
  const { name, arg } = cmd;
  if (name === 'start' || name === 'help') return tg(botToken, chatId, HELP);
  if (name === 'list' || name === 'ls') return doList(env, botToken, chatId, arg);
  if (name === 'info' || name === 'get') {
    const id = arg || idFromReply(msg);
    return id ? doInfo(env, botToken, chatId, id) : tg(botToken, chatId, usageCard('info'));
  }
  if (name === 'del' || name === 'delete' || name === 'rm') {
    const id = arg || idFromReply(msg);
    return id ? doDelete(env, botToken, chatId, id) : tg(botToken, chatId, usageCard('del'));
  }
  return tg(botToken, chatId, `<b>❓ 未知命令</b> /${esc(name)}\n\n${HELP}`);
}

function extractMedia(msg) {
  if (msg.photo && msg.photo.length) {
    return { fileId: msg.photo[msg.photo.length - 1].file_id, filename: 'photo.jpg', mime: 'image/jpeg' };
  }
  const doc = msg.document;
  if (doc && doc.mime_type && doc.mime_type.startsWith('image/')) {
    return { fileId: doc.file_id, filename: doc.file_name || 'image.bin', mime: doc.mime_type };
  }
  const st = msg.sticker;
  if (st && st.file_id && !st.is_animated && !st.is_video) {
    return { fileId: st.file_id, filename: 'sticker.webp', mime: 'image/webp' };
  }
  return null;
}

function idFromReply(msg) {
  const t = msg.reply_to_message && (msg.reply_to_message.text || msg.reply_to_message.caption);
  if (!t) return null;
  const m =
    String(t).match(/(?:^|\n)\s*id\s*[:：]\s*(?:<code>)?([A-Za-z0-9_-]{8,128})(?:<\/code>)?/i) ||
    String(t).match(/image_id\s*[:：]\s*(?:<code>)?([A-Za-z0-9_-]{8,128})(?:<\/code>)?/i);
  return m ? m[1] : null;
}

async function doUploadFromTg(env, botToken, chatId, media) {
  const fileData = await (
    await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(media.fileId)}`)
  ).json();
  if (!fileData.ok) throw new Error(fileData.description || 'getFile 失败');

  const { file_path: filePath, file_size: tgSize } = fileData.result;
  if (tgSize && tgSize > MAX_UPLOAD_BYTES) throw httpErr(413, `文件过大（>${MAX_UPLOAD_BYTES} bytes）`);

  const imageRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
  if (!imageRes.ok) throw new Error(`下载失败 ${imageRes.status}`);

  const bytes = await imageRes.arrayBuffer();
  const ct = imageRes.headers.get('content-type') || media.mime || guessMime(media.filename);
  await tg(botToken, chatId, formatLinks(await niUpload(env, bytes, media.filename, ct), 'upload'));
}

async function doInfo(env, botToken, chatId, imageId) {
  await tg(botToken, chatId, formatLinks(await niInfo(env, imageId), 'info'));
}

async function doList(env, botToken, chatId, arg) {
  const limit = arg && /^\d+$/.test(arg) ? Math.min(50, parseInt(arg, 10)) : 0;
  const data = await niList(env);
  const images = Array.isArray(data.images) ? data.images : [];
  const view = limit > 0 ? images.slice(0, limit) : images;

  if (!view.length) {
    return tg(botToken, chatId, ['<b>📂 列表</b>', '暂无图片', '', '<i>发一张图开始上传</i>'].join('\n'));
  }

  const total = data.count != null ? data.count : images.length;
  const head = limit > 0
    ? `<b>📂 列表</b>  ·  ${total} 张  ·  前 ${view.length}`
    : `<b>📂 列表</b>  ·  ${total} 张`;

  let buf = `${head}\n`;
  const chunks = [];
  for (let i = 0; i < view.length; i++) {
    const img = view[i];
    const direct = (img.links && img.links.direct) || '';
    const size = img.size != null ? `  ·  ${fmtSize(img.size)}` : '';
    const line =
      `\n<b>${i + 1}.</b> <code>${esc(img.image_id || '')}</code>${size}` +
      (direct ? `\n    ${aLink(direct, '打开图片')}` : '') +
      '\n';
    if ((buf + line).length > 3500) {
      chunks.push(buf);
      buf = line;
    } else buf += line;
  }
  if (buf.trim()) chunks.push(buf);
  for (const c of chunks) await tg(botToken, chatId, c);
}

async function doDelete(env, botToken, chatId, imageId) {
  await niDelete(env, imageId);
  await tg(botToken, chatId, ['<b>🗑 已删除</b>', `id: <code>${esc(imageId)}</code>`].join('\n'));
}

function formatLinks(data, mode = 'upload') {
  const links = data.links || {};
  const id = data.image_id || '';
  const direct = links.direct || data.url || '';
  const md = links.markdown || (direct ? `![image](${direct})` : '');

  const title = mode === 'info' ? 'ℹ️ <b>图片详情</b>' : '✅ <b>上传成功</b>';
  const lines = [title];

  const meta = [];
  if (data.filename) meta.push(esc(data.filename));
  if (data.size != null) meta.push(fmtSize(data.size));
  if (meta.length) lines.push(`📄 ${meta.join(' · ')}`);
  if (mode === 'info' && data.mimetype) lines.push(`🎛 ${esc(data.mimetype)}`);
  if (mode === 'info' && data.upload_time) lines.push(`🕒 ${esc(data.upload_time)}`);

  lines.push('', `id: <code>${esc(id)}</code>`);
  if (direct) lines.push('', '<b>直链</b>', aLink(direct, esc(direct)));
  if (md) lines.push('', '<b>Markdown</b>', `<code>${esc(md)}</code>`);
  return lines.join('\n');
}

function usageCard(kind) {
  const isInfo = kind === 'info';
  return [
    isInfo ? '<b>ℹ️ 用法</b>' : '<b>🗑 用法</b>',
    isInfo ? '<code>/info &lt;id&gt;</code>' : '<code>/del &lt;id&gt;</code>',
    isInfo ? '或回复上传消息后发送 /info' : '或回复上传消息后发送 /del',
  ].join('\n');
}

function errCard(message) {
  return ['<b>❌ 失败</b>', esc(message)].join('\n');
}

function aLink(url, label) {
  const href = String(url || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<a href="${href}">${esc(label || url)}</a>`;
}

function fmtSize(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '';
  if (x < 1024) return `${x} B`;
  if (x < 1024 * 1024) return `${(x / 1024).toFixed(1)} KB`;
  return `${(x / (1024 * 1024)).toFixed(2)} MB`;
}

async function tg(token, chatId, text) {
  if (!token || chatId == null) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
}

function json(obj, status = 200, request = null, env = null) {
  const res = new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
  return request && env ? withCors(res, request, env) : res;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function guessMime(name) {
  const n = String(name || '').toLowerCase();
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.gif')) return 'image/gif';
  if (n.endsWith('.webp')) return 'image/webp';
  if (n.endsWith('.bmp')) return 'image/bmp';
  if (n.endsWith('.svg')) return 'image/svg+xml';
  return 'image/jpeg';
}
