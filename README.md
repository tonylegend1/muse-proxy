# Muse Proxy

Tiny serverless proxy that sits between Muse Studio (running in Claude's artifact sandbox) and the YouTube Data API. Needed because the sandbox blocks direct calls to `googleapis.com`.

## What this does

- Accepts requests from Muse Studio (protected by a shared secret header)
- Forwards them to YouTube Data API v3 using your API key
- Returns the data as JSON
- Adds CORS headers so the artifact can read the response

Your API key never touches the browser. Only the proxy knows it.

## One-time setup (5 minutes)

### 1. Push this folder to GitHub

```
cd muse-proxy
git init
git add .
git commit -m "Initial proxy"
```

Create a new empty repo on GitHub called `muse-proxy`, then:

```
git remote add origin https://github.com/YOUR_USERNAME/muse-proxy.git
git branch -M main
git push -u origin main
```

### 2. Deploy to Vercel

1. Go to https://vercel.com — sign in with GitHub
2. Click **Add New → Project**
3. Import the `muse-proxy` repo
4. On the config screen, click **Environment Variables** and add two:
   - `YT_API_KEY` → your YouTube Data API v3 key (starts with `AIza...`)
   - `PROXY_SECRET` → a random string you make up (password-like, 24+ chars)
5. Click **Deploy**. Done in ~30 seconds.

Vercel will give you a URL like `https://muse-proxy-abc123.vercel.app`. **Copy both the URL and the secret you set** — you'll paste them into Muse Studio.

### 3. Verify it works

Open in a browser: `https://YOUR-URL.vercel.app/api/health`

You should see:
```json
{
  "status": "ok",
  "service": "muse-proxy",
  "has_api_key": true,
  "has_secret": true
}
```

If `has_api_key` or `has_secret` is false, go back to Vercel → Settings → Environment Variables and re-check.

## Endpoints

All endpoints except `/api/health` require the header `X-Proxy-Secret: <your secret>`.

- `GET /api/health` — liveness check (no auth)
- `GET /api/channel?ref=<id|handle>&type=<id|handle|search>` — channel + recent videos
- `GET /api/video?id=<videoId>` — video details

## Costs

Vercel free tier includes:
- 100 GB bandwidth/month
- 100 GB-hours compute/month

Muse Studio makes ~3–5 small calls per operation. You'd need thousands of uses per day to hit the free tier limit. In practice this is free forever for personal use.

## Rotating the secret

If your secret ever leaks, just change `PROXY_SECRET` in Vercel → Environment Variables → Redeploy. Then update Muse Studio with the new secret.
