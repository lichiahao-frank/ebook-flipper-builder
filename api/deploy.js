'use strict';

const https      = require('https');
const crypto     = require('crypto');
const os         = require('os');
const path       = require('path');
const fs         = require('fs');
const formidable = require('formidable');
const { flipbookHTML, slugify } = require('../lib/template');

function getAuth() {
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
    const htmlBuf = Buffer.from(flipbookHTML(imageFilenames));

    const uploadResults = await Promise.all([
      uploadFile(htmlBuf,       token, teamId).then(r => ({ file: 'index.html',  ...r })),
      uploadFile(vercelJsonBuf, token, teamId).then(r => ({ file: 'vercel.json', ...r })),
      ...imageFiles.map((f, i) =>
        uploadFile(fs.readFileSync(f.filepath), token, teamId)
          .then(r => ({ file: imageFilenames[i], ...r }))
      ),
    ]);

    const qs = teamId ? `?teamId=${teamId}` : '';
    const { status, data } = await vercelAPI('POST', `/v13/deployments${qs}`, {
      name: projectName,
      files: uploadResults,
      target: 'production',
      projectSettings: { framework: null, buildCommand: null, outputDirectory: null, installCommand: null },
    }, token);

    if (status >= 400) throw new Error(`Deployment failed (${status}): ${JSON.stringify(data)}`);
    res.json({ success: true, deployId: data.id });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
