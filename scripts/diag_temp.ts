import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

import * as fs from 'fs';

async function main() {
  const imgPath = '/sessions/peaceful-sharp-ritchie/mnt/outputs/july1_sheet.jpg';
  const buf = fs.readFileSync(imgPath);
  const base64 = buf.toString('base64');

  // --- Qwen ---
  const hfToken = process.env.HF_TOKEN;
  console.log('HF_TOKEN present:', !!hfToken);
  if (hfToken) {
    const QWEN_PROMPT = `You are reading a handwritten daily water meter sheet from India.
Read the TOWER SECTION (top of sheet). 4 towers: Venus, Mercury, Neptune, Jupiter, each with DO and DR rows.
Find the "Total Litres" (3rd column) value for Mercury DR specifically, and also r_yesterday and r_today for that row.
Indian number format: 1,76,000 = 176000.
Return ONLY JSON: {"Mercury_DR_r_yesterday": null, "Mercury_DR_r_today": null, "Mercury_DR_total_ltrs": null}`;
    const resp = await fetch('https://router.huggingface.co/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${hfToken}` },
      body: JSON.stringify({
        model: 'Qwen/Qwen3-VL-8B-Instruct',
        provider: 'novita',
        max_tokens: 300,
        temperature: 0,
        messages: [{ role: 'user', content: [
          { type: 'text', text: QWEN_PROMPT },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
        ]}],
      }),
    });
    const data: any = await resp.json();
    console.log('QWEN raw:', JSON.stringify(data).slice(0, 800));
  }

  // --- Gemini ---
  const geminiKey = process.env.GEMINI_API_KEY;
  console.log('GEMINI_API_KEY present:', !!geminiKey);
  if (geminiKey) {
    const prompt = `You are reading a handwritten daily water meter sheet from India.
Find the TOWER SECTION row labeled "MERCURY DR". Read its r_yesterday (1st column), r_today (2nd column), and Total Litres (3rd column) values EXACTLY as handwritten -- do not compute or infer, just transcribe the digits you see.
Indian number format: 1,76,000 = 176000.
Return ONLY JSON: {"r_yesterday": null, "r_today": null, "total_ltrs": null}`;
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { text: prompt },
          { inline_data: { mime_type: 'image/jpeg', data: base64 } },
        ]}],
        generationConfig: { temperature: 0 },
      }),
    });
    const data: any = await resp.json();
    console.log('GEMINI raw:', JSON.stringify(data).slice(0, 1500));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
