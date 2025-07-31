README.md (final bilingual dengan worker.js dan LICENSE)
markdown
Copy
Edit

# WABA ↔ Telegram Bridge (Cloudflare Worker)

**ID:** Bridge untuk menghubungkan **WhatsApp Business API (WABA)** dengan **Telegram**.  
**EN:** A bridge that connects **WhatsApp Business API (WABA)** with **Telegram**.

Menerima pesan WhatsApp → kirim ke Telegram, dan balasan dari Telegram → terkirim ke WhatsApp.  
Receive messages from WhatsApp → send to Telegram, and replies from Telegram → sent to WhatsApp.

Jika grup Telegram menggunakan **Forum Mode**, setiap kontak WhatsApp akan otomatis memiliki **thread sendiri**.  
If the Telegram group uses **Forum Mode**, each WhatsApp contact automatically gets its own **thread**.

---

## Fitur / Features

- **ID:** Pesan WhatsApp otomatis diteruskan ke Telegram, balasan Telegram terkirim ke WhatsApp.  
  **EN:** WhatsApp messages automatically forwarded to Telegram, Telegram replies sent to WhatsApp.
- **ID:** Pesan WhatsApp tidak langsung ditandai terbaca, baru setelah dibalas dari Telegram.  
  **EN:** WhatsApp messages are not marked as read until replied from Telegram.
- **ID:** Mendukung grup Telegram dengan mode Forum (tiap kontak WhatsApp = 1 thread).  
  **EN:** Supports Telegram Forum Groups (each WhatsApp contact = 1 thread).

---

## Teknologi / Technology

- **ID:** [Cloudflare Workers](https://developers.cloudflare.com/workers/) untuk serverless hosting.  
  **EN:** [Cloudflare Workers](https://developers.cloudflare.com/workers/) for serverless hosting.
- **ID:** [Cloudflare KV](https://developers.cloudflare.com/workers/runtime-apis/kv/) untuk menyimpan mapping nomor ↔ thread.  
  **EN:** [Cloudflare KV](https://developers.cloudflare.com/workers/runtime-apis/kv/) to store number ↔ thread mapping.
- **ID:** WhatsApp Cloud API & Telegram Bot API.  
  **EN:** WhatsApp Cloud API & Telegram Bot API.

---

## Prasyarat / Prerequisites

1. **ID:** Akun Cloudflare (gratis).  
   **EN:** Cloudflare account (free).
2. **ID:** Node.js & npm terinstal.  
   **EN:** Node.js & npm installed.
3. **ID:** VSCode (opsional untuk edit).  
   **EN:** VSCode (optional for editing).
4. **ID:** WhatsApp Cloud API (dapatkan `WHATSAPP_ACCESS_TOKEN` dan `WHATSAPP_PHONE_NUMBER_ID` dari [Meta Developer Dashboard](https://developers.facebook.com/)).  
   **EN:** WhatsApp Cloud API (get `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` from [Meta Developer Dashboard](https://developers.facebook.com/)).
5. **ID:** Bot Telegram (dapatkan token dari [@BotFather](https://t.me/BotFather)).  
   **EN:** Telegram Bot (get token from [@BotFather](https://t.me/BotFather)).
6. **ID:** ID grup Telegram (pakai bot seperti [@getidsbot](https://t.me/getidsbot)).  
   **EN:** Telegram group ID (use bot like [@getidsbot](https://t.me/getidsbot)).
7. **ID:** wrangler CLI:  
    **EN:** wrangler CLI:
   ```bash
   npm install -g wrangler
   ```
8. Clone Repository
   ```bash
   git clone https://github.com/<username>/waba-telegram-bridge.git
   cd waba-telegram-bridge
   ```
9. Edit wrangler.toml
   **ID:** Isi variabel sesuai konfigurasi:
   **EN:** Fill environment variables accordingly:

```bash
name = "waba-telegram-bridge"
main = "worker.js"
compatibility_date = "2024-07-30"

[[kv_namespaces]]
binding = "MAP_STORE"
id = "<akan diisi setelah membuat KV>" # <to be filled after creating KV>

[vars]
WHATSAPP_ACCESS_TOKEN = "YOUR_WA_TOKEN"
WHATSAPP_PHONE_NUMBER_ID = "YOUR_WA_PHONE_ID"
WHATSAPP_VERIFY_TOKEN = "YOUR_WA_VERIFY_TOKEN"
TELEGRAM_BOT_TOKEN = "YOUR_TELEGRAM_BOT_TOKEN"
TELEGRAM_ADMIN_GROUP_ID = "123456789" # Ganti dengan ID grup / Replace with group ID 3. Login Cloudflare
GEMINI_API_KEY = "" # Ganti dengan Gemini Api Key / Replace with Gemini Api Key
```

wrangler login
**ID:** Ikuti proses login di browser.
**EN:** Follow the login process in the browser.

4. Buat KV Namespace / Create KV Namespace

   ```bash
   wrangler kv namespace create "MAP_STORE"
   ```

   **ID:** Salin id yang muncul, tempel ke wrangler.toml.
   EN: Copy the returned id and paste into wrangler.toml.

5. Deploy
   ```bash
   wrangler deploy
   ```
   **ID:** Hasil akan muncul seperti:
   EN: The output will look like:

```bash
https://waba-telegram-bridge.<subdomain>.workers.dev
Konfigurasi Webhook / Webhook Setup
```

1. Set Webhook Telegram

   ```bash
   curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
    -H "Content-Type: application/json" \
    -d '{"url":"https://waba-telegram-bridge.<subdomain>.workers.dev/webhook/telegram"}'
   ```

   **ID:** Ganti <TELEGRAM_BOT_TOKEN> dan <subdomain> dengan milikmu.
   **EN:** Replace <TELEGRAM_BOT_TOKEN> and <subdomain> with yours.

2. Set Webhook WhatsApp
   **ID:** Di Meta Developer Dashboard → Webhooks masukkan URL:
   **EN:** On Meta Developer Dashboard → Webhooks, enter URL:

```bash
https://waba-telegram-bridge.<subdomain>.workers.dev/webhook/whatsapp
```

**ID:** Masukkan verify token sama seperti di wrangler.toml.
**EN:** Use the same verify token as in wrangler.toml.

Testing
**ID:** Kirim pesan ke nomor WhatsApp → pesan muncul di Telegram.
**EN:** Send message to WhatsApp number → message appears in Telegram.

**ID:** Balas di Telegram (thread atau /reply <nomor> <pesan>) → terkirim ke WhatsApp.
**EN:** Reply in Telegram (thread or /reply <number> <message>) → delivered to WhatsApp.

**ID:** Pesan WA otomatis ditandai read setelah dibalas.
**EN:** WhatsApp message automatically marked as read after reply.

Struktur Project / Project Structure

```bash
waba-telegram-bridge/
├── wrangler.toml # konfigurasi Cloudflare / Cloudflare config
├── worker.js # kode utama / main code
└── package.json # opsional / optional
```

---

## **worker.js (final)**

_(kode worker final sudah mendukung KV untuk mapping & delay read)_  
Saya bisa sertakan **di sini** jika mau, supaya README langsung lengkap dengan kode.

---

## **LICENSE (MIT)**

MIT License

Copyright (c) 2025 Hatim Zafr

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
