 const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const FormData = require('form-data');
const https = require('https');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const NJT_BASE = 'https://pcsdata.njtransit.com/api/BUSDV2';
const USERNAME = 'eddie2ooo';
const PASSWORD = '!sX#Rb@6';

let cachedToken = null;
let tokenExpiry = null;

async function getToken() {
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) {
    return cachedToken;
  }
  const form = new FormData();
  form.append('username', USERNAME);
  form.append('password', PASSWORD);
  const resp = await fetch(`${NJT_BASE}/authenticateUser`, {
    method: 'POST', body: form
  });
  const data = await resp.json();
  if (data.Authenticated === 'True') {
    cachedToken = data.UserToken;
    tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
    return cachedToken;
  }
  throw new Error('NJT authentication failed');
}

async function njtPost(endpoint, fields) {
  const token = await getToken();
  const form = new FormData();
  form.append('token', token);
  for (const [k, v] of Object.entries(fields)) {
    form.append(k, v);
  }
  const resp = await fetch(`${NJT_BASE}/${endpoint}`, {
    method: 'POST', body: form
  });
  return resp.json();
}

app.get('/', (req, res) => {
  res.json({ status: 'CommuteGuard proxy running' });
});

app.get('/buses/:stop', async (req, res) => {
  try {
    const data = await njtPost('getBusDV', {
      stop: req.params.stop,
      direction: req.query.direction || '',
      route: req.query.route || '',
      IP: ''
    });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/stops/:route', async (req, res) => {
  try {
    const data = await njtPost('getStops', {
      route: req.params.route,
      direction: req.query.direction || '',
      namecontains: req.query.namecontains || ''
    });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/trips/:route/:location', async (req, res) => {
  try {
    const data = await njtPost('getRouteTrips', {
      route: req.params.route,
      location: req.params.location
    });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`CommuteGuard proxy running on port ${PORT}`);
  setInterval(() => {
    https.get('https://commuteguard-proxy.onrender.com', (res) => {
      console.log(`Keep-alive ping: ${res.statusCode}`);
    }).on('error', (e) => {
      console.log(`Keep-alive ping failed: ${e.message}`);
    });
  }, 10 * 60 * 1000);
});
