// api/video.js — Vercel serverless endpoint
// GET /api/video?id=<videoId>
// Returns: video details object

const YT = 'https://www.googleapis.com/youtube/v3';

async function yt(endpoint, params, apiKey) {
  const qs = new URLSearchParams({ ...params, key: apiKey }).toString();
  const res = await fetch(`${YT}/${endpoint}?${qs}`);
  if (!res.ok) {
    let msg;
    try {
      const json = await res.json();
      msg = json?.error?.message || JSON.stringify(json).slice(0, 300);
    } catch {
      msg = (await res.text().catch(() => '')).slice(0, 300);
    }
    const err = new Error(`YouTube ${res.status}: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function computeVelocity(views, publishedAt) {
  if (!views || !publishedAt) return 0;
  const hours = Math.max((Date.now() - new Date(publishedAt).getTime()) / 3600000, 1);
  return views / hours;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Proxy-Secret');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const expectedSecret = process.env.PROXY_SECRET;
  if (!expectedSecret) {
    return res.status(500).json({ error: 'Proxy misconfigured: PROXY_SECRET not set' });
  }
  if (req.headers['x-proxy-secret'] !== expectedSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const apiKey = process.env.YT_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Proxy misconfigured: YT_API_KEY not set' });
  }

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing id parameter' });

  try {
    const data = await yt('videos', { part: 'statistics,snippet', id }, apiKey);
    if (!data.items?.[0]) return res.status(404).json({ error: 'Video not found' });
    const v = data.items[0];
    const views = parseInt(v.statistics.viewCount || 0);
    const published = v.snippet.publishedAt;
    return res.status(200).json({
      id: v.id,
      title: v.snippet.title,
      description: (v.snippet.description || '').slice(0, 2000),
      channelName: v.snippet.channelTitle,
      channelId: v.snippet.channelId,
      publishedAt: published,
      views,
      likes: parseInt(v.statistics.likeCount || 0),
      comments: parseInt(v.statistics.commentCount || 0),
      velocity: computeVelocity(views, published),
      url: `https://youtube.com/watch?v=${id}`,
      thumbnail: v.snippet.thumbnails?.high?.url || v.snippet.thumbnails?.medium?.url,
    });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ error: e.message });
  }
}
