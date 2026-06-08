'use strict';

const https      = require('https');
const crypto     = require('crypto');
const os         = require('os');
const path       = require('path');
const fs         = require('fs');
const formidable = require('formidable');
const { flipbookHTML, slugify, oembedJSON } = require('../lib/template');

function getAuth() {
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

// 等待部署 READY 並回傳「公開」網址（最短的別名＝乾淨的正式網址，不受部署保護）
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

async function uploadFile(buffer, token, teamId) {
  const sha = crypto.createHash('sha1').update(buffer).digest('hex');
  const qs  = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
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
    throw new Error(`Vercel token 已失效或權限不足 (HTTP ${status})，請更新 VERCEL_DEPLOY_TOKEN 環境變數（到 vercel.com/account/tokens 重新產生，scope 選對 team）`);
  }
  if (status !== 200 && status !== 409) throw new Error(`File upload failed (HTTP ${status})`);
  return { sha, size: buffer.length };
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = getAuth();
  if (!auth?.token) return res.status(500).json({ error: '找不到 Vercel token，請設定 VERCEL_DEPLOY_TOKEN 環境變數' });
  const { token, teamId } = auth;

  const form = formidable({ multiples: true, maxFileSize: 100 * 1024 * 1024 });
  let fields, files;
  try {
    [fields, files] = await new Promise((resolve, reject) =>
      form.parse(req, (err, f, fi) => err ? reject(err) : resolve([f, fi]))
    );
  } catch (err) {
    return res.status(400).json({ error: '無法解析上傳檔案：' + err.message });
  }

  let imageFiles = files.images || [];
  if (!Array.isArray(imageFiles)) imageFiles = [imageFiles];
  if (!imageFiles.length) return res.status(400).json({ error: '請至少上傳一張圖片' });

  // 存取密碼閘門（密碼存於 BUILDER_PASSWORD 環境變數，不在程式碼中）
  const required = (process.env.BUILDER_PASSWORD || '').trim();
  const pw = Array.isArray(fields.password) ? fields.password[0] : (fields.password || '');
  if (required && pw.trim() !== required) {
    return res.status(401).json({ error: '存取密碼錯誤，無法部署' });
  }

  const nameField   = Array.isArray(fields.name) ? fields.name[0] : (fields.name || '');
  const projectName = slugify(nameField) || `ebook-${Date.now()}`;

  try {
    const imageFilenames = imageFiles.map((f, i) => {
      const ext = (path.extname(f.originalFilename || f.originalName || '') || '.jpg').toLowerCase();
      return `page_${String(i + 1).padStart(3, '0')}${ext}`;
    });

    const vercelJsonBuf = Buffer.from(JSON.stringify({
      headers: [{ source: '/(.*)', headers: [
        { key: 'X-Frame-Options',        value: 'ALLOWALL'          },
        { key: 'Content-Security-Policy', value: 'frame-ancestors *' },
      ]}],
    }));

    const qs = teamId ? `?teamId=${teamId}` : '';
    const projectSettings = { framework: null, buildCommand: null, outputDirectory: null, installCommand: null };

    // 共用檔案：圖片 + vercel.json（兩階段沿用同一份 SHA，第二次不必重傳）
    const sharedFiles = await Promise.all([
      uploadFile(vercelJsonBuf, token, teamId).then(r => ({ file: 'vercel.json', ...r })),
      ...imageFiles.map((f, i) =>
        uploadFile(fs.readFileSync(f.filepath), token, teamId)
          .then(r => ({ file: imageFilenames[i], ...r }))
      ),
    ]);

    async function createDeployment(extraFiles) {
      const { status, data } = await vercelAPI('POST', `/v13/deployments${qs}`, {
        name: projectName, files: [...sharedFiles, ...extraFiles],
        target: 'production', projectSettings,
      }, token);
      if (status === 401 || status === 403) {
        throw new Error(`Vercel token 已失效或權限不足 (HTTP ${status})，請更新 VERCEL_DEPLOY_TOKEN 環境變數`);
      }
      if (status >= 400) throw new Error(`Deployment failed (${status}): ${JSON.stringify(data)}`);
      return data;
    }

    // 第一階段：先用「無網址版」部署，問出實際公開網址
    const htmlV1 = await uploadFile(Buffer.from(flipbookHTML(imageFilenames)), token, teamId)
      .then(r => ({ file: 'index.html', ...r }));
    const dep1 = await createDeployment([htmlV1]);
    const realUrl = await waitForPublicUrl(dep1.id, qs, token);

    // 第二階段：用真實網址重生 meta/oembed，重新部署（圖片沿用 SHA）
    const htmlV2 = await uploadFile(Buffer.from(flipbookHTML(imageFilenames, realUrl)), token, teamId)
      .then(r => ({ file: 'index.html', ...r }));
    const oembedV2 = await uploadFile(Buffer.from(oembedJSON(realUrl, imageFilenames[0])), token, teamId)
      .then(r => ({ file: 'oembed.json', ...r }));
    const dep2 = await createDeployment([htmlV2, oembedV2]);

    res.json({ success: true, deployId: dep2.id, url: realUrl });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
