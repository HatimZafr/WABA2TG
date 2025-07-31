# WABA ↔ Telegram Bridge (Cloudflare Worker)

A bridge that connects **WhatsApp Business API (WABA)** with **Telegram**.

Receive messages from WhatsApp → send to Telegram, and replies from Telegram → sent to WhatsApp.

If the Telegram group uses **Forum Mode**, each WhatsApp contact automatically gets its own **thread**.

---

## Features

- WhatsApp messages automatically forwarded to Telegram, Telegram replies sent to WhatsApp.
- WhatsApp messages are not marked as read until replied from Telegram.
- Supports Telegram Forum Groups (each WhatsApp contact = 1 thread).

---

## Technology

- [Cloudflare Workers](https://developers.cloudflare.com/workers/) for serverless hosting.
- [Cloudflare KV](https://developers.cloudflare.com/workers/runtime-apis/kv/) to store number ↔ thread mapping.
- WhatsApp Cloud API & Telegram Bot API.

---

## Prerequisites

1.  Cloudflare account (free).
2.  Node.js & npm installed.
3.  VSCode (optional for editing).
4.  WhatsApp Cloud API (get `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` from [Meta Developer Dashboard](https://developers.facebook.com/)).
5.  Telegram Bot (get token from [@BotFather](https://t.me/BotFather)).
6.  Telegram group ID (use bot like [@getidsbot](https://t.me/getidsbot)).
7.  wrangler CLI:
    ```bash
    npm install -g wrangler
    ```
8.  Clone Repository
    ```bash
    git clone [https://github.com/](https://github.com/)<username>/waba-telegram-bridge.git
    cd waba-telegram-bridge
    ```
9.  Edit wrangler.toml
    Fill environment variables accordingly:

    ```bash
    name = "waba-telegram-bridge"
    main = "worker.js"
    compatibility_date = "2024-07-30"

    [[kv_namespaces]]
    binding = "MAP_STORE"
    id = "<to be filled after creating KV>"

    [vars]
    WHATSAPP_ACCESS_TOKEN = "YOUR_WA_TOKEN"
    WHATSAPP_PHONE_NUMBER_ID = "YOUR_WA_PHONE_ID"
    WHATSAPP_VERIFY_TOKEN = "YOUR_WA_VERIFY_TOKEN"
    TELEGRAM_BOT_TOKEN = "YOUR_TELEGRAM_BOT_TOKEN"
    TELEGRAM_ADMIN_GROUP_ID = "123456789" # Replace with your group ID
    GEMINI_API_KEY = "" # Replace with Gemini Api Key
    ```

10. Login Cloudflare

    ```bash
    wrangler login
    ```

    Follow the login process in the browser.

11. Create KV Namespace

    ```bash
    wrangler kv namespace create "MAP_STORE"
    ```

    Copy the returned id and paste into wrangler.toml.

12. Deploy

    ```bash
    wrangler deploy
    ```

    The output will look like:

    ```bash
    https://waba-telegram-bridge.<subdomain>.workers.dev
    ```

---

## Webhook Setup

1.  Set Webhook Telegram

    ```bash
    curl -X POST "[https://api.telegram.org/bot](https://api.telegram.org/bot)<TELEGRAM_BOT_TOKEN>/setWebhook" \
     -H "Content-Type: application/json" \
     -d '{"url":"https://waba-telegram-bridge.<subdomain>.workers.dev/webhook/telegram"}'
    ```

    Replace `<TELEGRAM_BOT_TOKEN>` and `<subdomain>` with yours.

2.  Set Webhook WhatsApp
    On Meta Developer Dashboard → Webhooks, enter URL:

    ```bash
    https://waba-telegram-bridge.<subdomain>.workers.dev/webhook/whatsapp
    ```

    Use the same verify token as in wrangler.toml.

---

## Usage & Testing

### Basic Messaging

- Send message to WhatsApp number → message appears in Telegram.
- Reply in Telegram (thread or `/reply <number> <message>`) → delivered to WhatsApp.
- WhatsApp message automatically marked as read after reply.

### AI Features

By default, the AI will respond to all incoming WhatsApp text messages.

- **Toggle AI for a Specific Contact:**
  To enable or disable the AI for a particular WhatsApp contact from Telegram, use the following command in your Telegram admin group:

  ```
  /ai <PHONE_NUMBER> on
  /ai <PHONE_NUMBER> off
  ```

  Example: `/ai 6281234567890 on`

- **Set Global AI Instruction:**
  You can provide a general instruction or persona for the AI to follow. This instruction will be prepended to every prompt sent to the Gemini AI. Use this command in your Telegram admin group:

  ```
  /instruction <YOUR_INSTRUCTION_TEXT>
  ```

  Example: `/instruction You are a helpful customer support bot that is always polite and concise.`

  To view the current global instruction:

  ```
  /instruction
  ```

---

## Project Structure

```bash
waba-telegram-bridge/
├── wrangler.toml # Cloudflare config
├── worker.js # main code
└── package.json # optional
```

## **worker.js (final)**

_(kode worker final sudah mendukung KV untuk mapping & delay read)_
Saya bisa sertakan **di sini** jika mau, supaya README langsung lengkap dengan kode.

---

## LICENSE (MIT)

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

```
----
```
