// api/channel.js — Vercel serverless endpoint
// GET /api/channel?ref=<handle|id|search>&type=<handle|id|search>&max=<n>
// Returns: { channel, videos }

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

async function resolveChannelId(ref, type, apiKey) {
  if (type === 'id') return ref;

  // Try forHandle (strip leading @ if present — YouTube API accepts both but is inconsistent)
  if (type === 'handle') {
    const clean = ref.startsWith('@') ? ref.slice(1) : ref;
    // Attempt 1: with @
    try {
      const data = await yt('channels', { part: 'id', forHandle: `@${clean}` }, apiKey);
      if (data.items?.[0]) return data.items[0].id;
    } catch (e) { /* fall through */ }
    // Attempt 2: without @
    try {
      const data = await yt('channels', { part: 'id', forHandle: clean }, apiKey);
      if (data.items?.[0]) return data.items[0].id;
    } catch (e) { /* fall through */ }
    // Attempt 3: forUsername (legacy, for older channels)
    try {
      const data = await yt('channels', { part: 'id', forUsername: clean }, apiKey);
      if (data.items?.[0]) return data.items[0].id;
    } catch (e) { /* fall through */ }
  }

  // Final fallback: search
  const clean = ref.startsWith('@') ? ref.slice(1) : ref;
  const data = await yt('search', { part: 'snippet', q: clean, type: 'channel', maxResults: '5' }, apiKey);
  if (!data.items?.length) return null;

  // Prefer exact match on custom URL / title if we can find one
  const wanted = clean.toLowerCase();
  for (const item of data.items) {
    const title = (item.snippet?.channelTitle || '').toLowerCase().replace(/\s+/g, '');
    if (title === wanted || title.includes(wanted) || wanted.includes(title)) {
      return item.id.channelId;
    }
  }
  // Otherwise return top result
  return data.items[0].id.channelId;
}

function computeVelocity(views, publishedAt) {
  if (!views || !publishedAt) return 0;
  const hours = Math.max((Date.now() - new Date(publishedAt).getTime()) / 3600000, 1);
  return views / hours;
}

export default async function handler(req, res) {
  // CORS — allow the artifact sandbox to call us
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Proxy-Secret');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Shared-secret check
  const expectedSecret = process.env.PROXY_SECRET;
  if (!expectedSecret) {
    return res.status(500).json({ error: 'Proxy misconfigured: PROXY_SECRET not set' });
  }
  const providedSecret = req.headers['x-proxy-secret'];
  if (providedSecret !== expectedSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const apiKey = process.env.YT_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Proxy misconfigured: YT_API_KEY not set' });
  }

  const { ref, type, max } = req.query;
  if (!ref) return res.status(400).json({ error: 'Missing ref parameter' });

  const maxResults = Math.min(parseInt(max) || 15, 50);

  try {
    const channelId = await resolveChannelId(ref, type || 'search', apiKey);
    if (!channelId) return res.status(404).json({ error: 'Channel not found' });

    const chData = await yt('channels', {
      part: 'contentDetails,snippet,statistics',
      id: channelId,
    }, apiKey);
    if (!chData.items?.[0]) return res.status(404).json({ error: 'Channel not found' });

    const channel = chData.items[0];
    const uploadsId = channel.contentDetails.relatedPlaylists.uploads;

    const plData = await yt('playlistItems', {
      part: 'snippet',
      playlistId: uploadsId,
      maxResults: String(maxResults),
    }, apiKey);

    let videos = [];
    if (plData.items?.length) {
      const videoIds = plData.items.map(i => i.snippet.resourceId.videoId).join(',');
      const vidData = await yt('videos', { part: 'statistics,snippet', id: videoIds }, apiKey);
      const statsById = {};
      for (const v of (vidData.items || [])) statsById[v.id] = v;

      videos = plData.items.map(i => {
        const id = i.snippet.resourceId.videoId;
        const stats = statsById[id];
        const views = stats ? parseInt(stats.statistics.viewCount || 0) : 0;
        const published = i.snippet.publishedAt;
        return {
          id,
          title: i.snippet.title,
          publishedAt: published,
          views,
          velocity: computeVelocity(views, published),
          url: `https://youtube.com/watch?v=${id}`,
          thumbnail: i.snippet.thumbnails?.medium?.url || i.snippet.thumbnails?.default?.url,
        };
      });
    }

    return res.status(200).json({
      channel: {
        id: channel.id,
        title: channel.snippet.title,
        thumbnail: channel.snippet.thumbnails?.default?.url,
        subscribers: parseInt(channel.statistics.subscriberCount || 0),
        videoCount: parseInt(channel.statistics.videoCount || 0),
        viewCount: parseInt(channel.statistics.viewCount || 0),
      },
      videos,
    });
  } catch (e) {
    const status = e.status || 500;
    return res.status(status).json({ error: e.message });
  }
}
