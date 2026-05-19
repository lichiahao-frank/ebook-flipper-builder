'use strict';

const express  = require('express');
const multer   = require('multer');
const fs       = require('fs');
const path     = require('path');
const os       = require('os');
const crypto   = require('crypto');
const https    = require('https');
const { exec } = require('child_process');
const { flipbookHTML, slugify } = require('./lib/template');

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
      token:  process.env.VERCEL_DEPLOY_TOKEN,
      teamId: process.env.VERCEL_DEPLOY_TEAM_ID || null,
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
  if (status !== 200 && status !== 409) throw new Error(`File upload failed (HTTP ${status})`);
  return { sha, size: buffer.length };
}

// ── POST /api/deploy ────────────────────────────────────────────
app.post('/api/deploy', upload.array('images'), async (req, res) => {
  const files = req.files;
  if (!files?.length) return res.status(400).json({ error: '請至少上傳一張圖片' });

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

    const vercelJsonBuf = Buffer.from(JSON.stringify({
      headers: [{ source: '/(.*)', headers: [
        { key: 'X-Frame-Options',        value: 'ALLOWALL'          },
        { key: 'Content-Security-Policy', value: 'frame-ancestors *' },
      ]}],
    }));
    const htmlBuf = Buffer.from(flipbookHTML(imageFilenames));

    console.log('  📤 上傳檔案中…');
    const uploadResults = await Promise.all([
      uploadFile(htmlBuf,       token, teamId).then(r => ({ file: 'index.html',  ...r })),
      uploadFile(vercelJsonBuf, token, teamId).then(r => ({ file: 'vercel.json', ...r })),
      ...files.map((f, i) =>
        uploadFile(f.buffer, token, teamId).then(r => ({ file: imageFilenames[i], ...r }))
      ),
    ]);

    console.log('  🚀 建立 deployment…');
    const qs = teamId ? `?teamId=${teamId}` : '';
    const { status, data } = await vercelAPI('POST', `/v13/deployments${qs}`, {
      name: projectName,
      files: uploadResults,
      target: 'production',
      projectSettings: { framework: null, buildCommand: null, outputDirectory: null, installCommand: null },
    }, token);

    if (status >= 400) throw new Error(`Deployment failed (${status}): ${JSON.stringify(data)}`);
    console.log(`  ⏳ Deployment ${data.id} 建立中…`);
    res.json({ success: true, deployId: data.id });

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
    const qs = teamId ? `?teamId=${teamId}` : '';
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
