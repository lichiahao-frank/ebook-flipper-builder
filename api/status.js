'use strict';

const https = require('https');
const os    = require('os');
const path  = require('path');
const fs    = require('fs');

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

function vercelAPI(method, apiPath, token) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.vercel.com',
      path: apiPath, method,
      headers: { Authorization: `Bearer ${token}` },
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
    req.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const deployId = req.query?.id;
  if (!deployId) return res.status(400).json({ error: 'Missing id' });

  const auth = getAuth();
  if (!auth?.token) return res.status(500).json({ error: '找不到 Vercel token' });
  const { token, teamId } = auth;

  const qs = teamId ? `?teamId=${teamId}` : '';
  const { data } = await vercelAPI('GET', `/v13/deployments/${deployId}${qs}`, token);

  if (data.readyState === 'READY') {
    const aliases = (data.alias || []).sort((a, b) => a.length - b.length);
    const url = aliases[0] ? `https://${aliases[0]}` : `https://${data.url}`;
    res.json({ readyState: 'READY', url });
  } else if (data.readyState === 'ERROR') {
    res.json({ readyState: 'ERROR', error: JSON.stringify(data.errorMessage) });
  } else {
    res.json({ readyState: data.readyState });
  }
};
