# Google Cloud Vision API — Setup Guide

This guide covers enabling Cloud Vision for parallel OCR validation in the TW Water Automation project.

## Prerequisites

- A Google account
- Billing enabled on the GCP project (Vision API has a free tier: 1,000 requests/month)

---

## Steps

### 1. Create or select a GCP project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click the project picker at the top → **New Project** (or select an existing one)
3. Name it (e.g. `tw-water-automation`) and click **Create**

### 2. Enable the Cloud Vision API

1. In the left sidebar, go to **APIs & Services → Library**
2. Search for **Cloud Vision API**
3. Click it, then click **Enable**

### 3. Create an API key

1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → API key**
3. Copy the generated key

### 4. Restrict the API key (recommended)

1. Click **Edit API key** on the newly created key
2. Under **API restrictions**, select **Restrict key**
3. Choose **Cloud Vision API** from the dropdown
4. Click **Save**

### 5. Add the key to your environment

**Local development** — add to `.env.local`:
```
GOOGLE_CLOUD_VISION_API_KEY=AIza...
```

**Vercel deployment**:
1. Go to your Vercel project → **Settings → Environment Variables**
2. Add `GOOGLE_CLOUD_VISION_API_KEY` with the key value
3. Redeploy for the change to take effect

---

## Cost

Cloud Vision `DOCUMENT_TEXT_DETECTION` is billed per image:

| Tier | Price |
|------|-------|
| First 1,000 images/month | Free |
| 1,001 – 5,000,000 images/month | $1.50 per 1,000 images |

At ~30 daily uploads/month this project stays within the free tier indefinitely.

---

## Verification

After setting the key, upload a sheet image and check the server logs for:

```
[vision] ...
```

If the key is missing or invalid, Vision is silently skipped and extraction falls back to Claude-only mode.
