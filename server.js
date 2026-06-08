'use strict';

const express  = require('express');
const multer   = require('multer');
const fs       = require('fs');
const path     = require('path');
const os       = require('os');
const crypto   = require('crypto');
const https    = require('https');
const { exec } = require('child_process');
const { flipbookHTML, slugify, oembedJSON, imageDims } = require('./lib/template');

const app  = express();
const PORT = 3456;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 100 * 1024 * 1024 },
});

// ── Vercel auth ─────────────────────────────────────────────────
function getVercelAuth() {
  if (process.env.VERCEL_DEPLOY_TOKEN) {
    return {
      token:  process.env.VERCEL_DEPLOY_TOKEN.trim(),
      teamId: process.env.VERCEL_DEPLOY_TEAM_ID?.trim() || null,
    };
  }
  const base = path.join(os.homedir(), 'Library', 'Application Support', 'com.vercel.cli');
  try {
    const { token }       = JSON.parse(fs.readFileSync(path.join(base, 'auth.json'),   'utf8'));
    const { currentTeam } = JSON.parse(fs.readFileSync(path.join(base, 'config.json'), 'utf8'));
    return { token, teamId: currentTeam };
  } catch { return null; }
}

// ── Vercel REST API helper ──────────────────────────────────────
function vercelAPI(method, apiPath, payload, token) {
  return new Promise((resolve, reject) => {
    const body   = payload instanceof Buffer ? payload
                 : payload ? Buffer.from(JSON.stringify(payload)) : null;
    const isJSON = payload && !(payload instanceof Buffer);
    const req = https.request({
      hostname: 'api.vercel.com',
      path: apiPath, method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(isJSON && { 'Content-Type': 'application/json' }),
        ...(body   && { 'Content-Length': body.length }),
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        try { resolve({ status: res.statusCode, data: JSON.parse(text) }); }
        catch { resolve({ status: res.statusCode, data: text }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ── 等待部署 READY 並回傳公開網址（最短別名＝乾淨正式網址） ──────
async function waitForPublicUrl(deployId, qs, token) {
  for (let i = 0; i < 25; i++) {
    const { data } = await vercelAPI('GET', `/v13/deployments/${deployId}${qs}`, null, token);
    if (data.readyState === 'ERROR') throw new Error('第一階段部署失敗');
    // 公開網址＝不在 automaticAliases（team-scoped、受部署保護）裡的別名，
    // 它在 readyState 變 READY 之後可能還要再幾秒才指派好，需要等它出現
    const auto = data.automaticAliases || [];
    const publics = (data.alias || []).filter(a => !auto.includes(a));
    if (data.readyState === 'READY' && publics.length) {
      return 'https://' + publics.sort((a, b) => a.length - b.length)[0];
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error('等待公開網址逾時');
}

// ── Upload one file ─────────────────────────────────────────────
async function uploadFile(buffer, token, teamId) {
  const sha = crypto.createHash('sha1').update(buffer).digest('hex');
  const qs  = teamId ? `?teamId=${teamId}` : '';
  const status = await new Promise((resolve, reject) => {
    const r = https.request({
      hostname: 'api.vercel.com',
      path: `/v2/files${qs}`, method: 'POST',
      headers: {
        Authorization:     `Bearer ${token}`,
        'Content-Type':    'application/octet-stream',
        'x-vercel-digest': sha,
        'Content-Length':  buffer.length,
      },
    }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    r.on('error', reject);
    r.write(buffer);
    r.end();
  });
  if (status === 401 || status === 403) {
    throw new Error(`Vercel token 已失效或權限不足 (HTTP ${status})，請重新執行 vercel login 或更新 VERCEL_DEPLOY_TOKEN`);
  }
  if (status !== 200 && status !== 409) throw new Error(`File upload failed (HTTP ${status})`);
  return { sha, size: buffer.length };
}

// ── POST /api/deploy ────────────────────────────────────────────
app.post('/api/deploy', upload.array('images'), async (req, res) => {
  const files = req.files;
  if (!files?.length) return res.status(400).json({ error: '請至少上傳一張圖片' });

  // 存取密碼閘門（密碼存於 BUILDER_PASSWORD 環境變數，不在程式碼中）
  const required = (process.env.BUILDER_PASSWORD || '').trim();
  if (required && (req.body.password || '').trim() !== required) {
    return res.status(401).json({ error: '存取密碼錯誤，無法部署' });
  }

  const auth = getVercelAuth();
  if (!auth?.token) return res.status(500).json({ error: '找不到 Vercel token，請先執行 vercel login' });
  const { token, teamId } = auth;

  const projectName = slugify(req.body.name) || `ebook-${Date.now()}`;

  try {
    console.log(`\n📚 部署「${projectName}」，共 ${files.length} 張圖片`);

    const imageFilenames = files.map((f, i) => {
      const ext = (path.extname(f.originalname) || '.jpg').toLowerCase();
      return `page_${String(i + 1).padStart(3, '0')}${ext}`;
    });
    // 依第一張圖的實際比例設定書頁與卡片，避免橫式圖被塞進直式頁產生白邊
    const dims = imageDims(files[0].buffer) || { width: 595, height: 842 };

    const vercelJsonBuf = Buffer.from(JSON.stringify({
      headers: [{ source: '/(.*)', headers: [
        { key: 'X-Frame-Options',        value: 'ALLOWALL'          },
        { key: 'Content-Security-Policy', value: 'frame-ancestors *' },
      ]}],
    }));

    const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
    const projectSettings = { framework: null, buildCommand: null, outputDirectory: null, installCommand: null };

    console.log('  📤 上傳圖片中…');
    // 共用檔案：圖片 + vercel.json（兩階段沿用同一份 SHA，第二次不必重傳）
    const sharedFiles = await Promise.all([
      uploadFile(vercelJsonBuf, token, teamId).then(r => ({ file: 'vercel.json', ...r })),
      ...files.map((f, i) =>
        uploadFile(f.buffer, token, teamId).then(r => ({ file: imageFilenames[i], ...r }))
      ),
    ]);

    async function createDeployment(extraFiles) {
      const { status, data } = await vercelAPI('POST', `/v13/deployments${qs}`, {
        name: projectName, files: [...sharedFiles, ...extraFiles],
        target: 'production', projectSettings,
      }, token);
      if (status === 401 || status === 403) {
        throw new Error(`Vercel token 已失效或權限不足 (HTTP ${status})，請重新執行 vercel login 或更新 VERCEL_DEPLOY_TOKEN`);
      }
      if (status >= 400) throw new Error(`Deployment failed (${status}): ${JSON.stringify(data)}`);
      return data;
    }

    // 第一階段：先用「無網址版」部署，問出實際公開網址
    console.log('  🚀 第一階段部署（取得網址）…');
    const htmlV1 = await uploadFile(Buffer.from(flipbookHTML(imageFilenames, null, dims)), token, teamId)
      .then(r => ({ file: 'index.html', ...r }));
    const dep1 = await createDeployment([htmlV1]);
    const realUrl = await waitForPublicUrl(dep1.id, qs, token);
    console.log(`  🔗 取得網址：${realUrl}`);

    // 第二階段：用真實網址重生 meta/oembed，重新部署（圖片沿用 SHA）
    console.log('  🚀 第二階段部署（寫入 oEmbed）…');
    const htmlV2 = await uploadFile(Buffer.from(flipbookHTML(imageFilenames, realUrl, dims)), token, teamId)
      .then(r => ({ file: 'index.html', ...r }));
    const oembedV2 = await uploadFile(Buffer.from(oembedJSON(realUrl, imageFilenames[0], dims)), token, teamId)
      .then(r => ({ file: 'oembed.json', ...r }));
    const dep2 = await createDeployment([htmlV2, oembedV2]);
    console.log(`  ⏳ Deployment ${dep2.id} 建立中…`);
    res.json({ success: true, deployId: dep2.id, url: realUrl });

  } catch (err) {
    console.error('  ❌', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/status ─────────────────────────────────────────────
app.get('/api/status', async (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  const auth = getVercelAuth();
  if (!auth?.token) return res.status(500).json({ error: '找不到 Vercel token' });
  const { token, teamId } = auth;

  try {
    const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
    const { data } = await vercelAPI('GET', `/v13/deployments/${id}${qs}`, null, token);
    console.log(`  state: ${data.readyState}`);

    if (data.readyState === 'READY') {
      const aliases = (data.alias || []).sort((a, b) => a.length - b.length);
      const url = aliases[0] ? `https://${aliases[0]}` : `https://${data.url}`;
      console.log(`  ✅ 完成：${url}`);
      res.json({ readyState: 'READY', url });
    } else if (data.readyState === 'ERROR') {
      res.json({ readyState: 'ERROR', error: JSON.stringify(data.errorMessage) });
    } else {
      res.json({ readyState: data.readyState });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start ───────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, '127.0.0.1', () => {
    console.log('\n📚  電子書生成器已啟動');
    console.log(`→   http://localhost:${PORT}\n`);
    exec(`open http://localhost:${PORT}`);
  });
}

module.exports = app;
