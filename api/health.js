// api/health.js — tiny liveness check
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({
    status: 'ok',
    service: 'muse-proxy',
    time: new Date().toISOString(),
    has_api_key: !!process.env.YT_API_KEY,
    has_secret: !!process.env.PROXY_SECRET,
  });
}
