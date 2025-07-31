# WABA ↔ Telegram Bridge (Cloudflare Worker)

A bridge that connects **WhatsApp Business API (WABA)** with **Telegram**.

Receive messages from WhatsApp → send to Telegram, and replies from Telegram → sent to WhatsApp.

If the Telegram group uses **Forum Mode**, each WhatsApp contact automatically gets its own **thread**.

---

## Features

- WhatsApp messages automatically forwarded to Telegram, Telegram replies sent to WhatsApp.
- WhatsApp messages are not marked as read until replied from Telegram.
- Supports Telegram Forum Groups (each WhatsApp contact = 1 thread).
- **AI Integration:** Automatically responds to WhatsApp text messages using Google Gemini AI.
- **AI Toggle:** Enable or disable AI responses for specific WhatsApp contacts from Telegram.
- **Global AI Instruction:** Set a universal instruction for the AI from Telegram to guide its responses.

---

## Technology

- [Cloudflare Workers](https://developers.cloudflare.com/workers/) for serverless hosting.
- [Cloudflare KV](https://developers.cloudflare.com/workers/runtime-apis/kv/) to store number ↔ thread mapping, AI settings, and global instructions.
- WhatsApp Cloud API & Telegram Bot API.
- Google Gemini API for AI responses.

---

## Prerequisites

1.  **Cloudflare Account:** You'll need a free Cloudflare account.
2.  **Node.js & npm:** Make sure Node.js and npm are installed on your machine.
3.  **VSCode (Optional):** Visual Studio Code is recommended for editing the worker code.
4.  **WhatsApp Cloud API:**
    - Obtain your `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` from your [Meta Developer Dashboard](https://developers.facebook.com/).
5.  **Telegram Bot Setup:**
    - **Create Your Bot:**
      - Open Telegram and search for **@BotFather**.
      - Start a chat with **@BotFather** and send the command `/newbot`.
      - Follow the on-screen instructions to choose a display name and a unique username for your bot (the username must end with "bot", e.g., `MyAwesomeBridgeBot`).
      - **@BotFather** will then provide you with an **HTTP API Token**. This is your `TELEGRAM_BOT_TOKEN`. Keep this token secure!
    - **Create Telegram Admin Group & Grant Permissions:**
      - Create a **new Telegram group**. This will be your administration panel for WhatsApp messages.
      - **Add your newly created bot to this group.**
      - **Make Your Bot an Administrator:** Go to the group's settings, tap on **Administrators**, then **Add Admin**. Select your bot from the list.
      - When prompted for permissions, ensure you enable at least the following:
        - **"Manage Topics"** (crucial if you plan to use Forum Mode for separate threads per WhatsApp contact).
        - **"Post Messages"**.
        - You can enable other permissions as you deem necessary, but these two are essential for the bridge's core functionality.
      - **(Optional but Recommended for Forum Mode):** If your group doesn't have it enabled by default, go to the group settings and toggle on **"Topics"** to turn your group into a forum. This allows the bot to create separate threads for each WhatsApp contact.
    - **Get Telegram Group ID:**
      - Once your bot is in the group and has admin rights, send any message in the group (e.g., "hello").
      - Open Telegram again and search for **@getidsbot**.
      - **Forward one of the messages from your group to @getidsbot.**
      - **@getidsbot** will reply with the **Chat ID** of your group. This is your `TELEGRAM_ADMIN_GROUP_ID`.
6.  **Google Gemini API Key:** Obtain your `GEMINI_API_KEY` from [Google AI Studio](https://ai.google.dev/).
7.  **wrangler CLI:** Install Cloudflare's CLI tool globally:
    ```bash
    npm install -g wrangler
    ```
8.  **Clone Repository:**
    ```bash
    git clone [https://github.com/](https://github.com/)<username>/waba-telegram-bridge.git
    cd waba-telegram-bridge
    ```
9.  **Edit `wrangler.toml`:**
    Open the `wrangler.toml` file in your project directory and fill in the environment variables with the tokens and IDs you obtained in the previous steps:

    ```bash
    name = "waba-telegram-bridge"
    main = "worker.js"
    compatibility_date = "2024-07-30"

    [[kv_namespaces]]
    binding = "MAP_STORE"
    id = "<to be filled after creating KV>" # This ID will be generated in the next step.

    [vars]
    WHATSAPP_ACCESS_TOKEN = "YOUR_WA_TOKEN"
    WHATSAPP_PHONE_NUMBER_ID = "YOUR_WA_PHONE_ID"
    WHATSAPP_VERIFY_TOKEN = "YOUR_WA_VERIFY_TOKEN" # Choose any random string, e.g., "mysecrettoken123"
    TELEGRAM_BOT_TOKEN = "YOUR_TELEGRAM_BOT_TOKEN"
    TELEGRAM_ADMIN_GROUP_ID = "123456789" # Replace with your Telegram Group Chat ID (e.g., -1001234567890)
    GEMINI_API_KEY = "YOUR_GEMINI_API_KEY"
    ```

10. **Login to Cloudflare:**
    ```bash
    wrangler login
    ```
    Follow the browser-based login process to authenticate `wrangler` with your Cloudflare account.
11. **Create KV Namespace:**
    Cloudflare KV (Key-Value) store is used to map WhatsApp numbers to Telegram threads.
    ```bash
    wrangler kv namespace create "MAP_STORE"
    ```
    After running this command, `wrangler` will output an `id`. **Copy this `id` and paste it into the `id` field under `[[kv_namespaces]]` in your `wrangler.toml` file.**
12. **Deploy Your Worker:**
    ```bash
    wrangler deploy
    ```
    This command will deploy your worker to Cloudflare. The output will provide you with the public URL of your worker, which will look something like `https://waba-telegram-bridge.<subdomain>.workers.dev`. Keep this URL handy.

---

## Webhook Setup

Now that your worker is deployed, you need to tell WhatsApp and Telegram where to send their messages.

1.  **Set Telegram Webhook:**
    Open your terminal and run the following `curl` command. Replace `<TELEGRAM_BOT_TOKEN>` with your bot's token and `<subdomain>` with the subdomain from your deployed worker's URL.

    ```bash
    curl -X POST "[https://api.telegram.org/bot](https://api.telegram.org/bot)<TELEGRAM_BOT_TOKEN>/setWebhook" \
     -H "Content-Type: application/json" \
     -d '{"url":"https://waba-telegram-bridge.<subdomain>.workers.dev/webhook/telegram"}'
    ```

2.  **Set WhatsApp Webhook:**
    - Go to your [Meta Developer Dashboard](https://developers.facebook.com/).
    - Navigate to your WhatsApp Business API app.
    - Go to **Webhooks** under the WhatsApp product.
    - Click **"Edit callback URL"**.
    - For the **Callback URL**, enter your worker's URL followed by `/webhook/whatsapp`:
      ```
      https://waba-telegram-bridge.<subdomain>.workers.dev/webhook/whatsapp
      ```
    - For the **Verify token**, use the same token you set for `WHATSAPP_VERIFY_TOKEN` in your `wrangler.toml` file.
    - Click **"Verify and Save"**.
    - After saving, click **"Manage"** next to the Webhooks URL and **subscribe** to the `messages` field.

---

## Usage & Testing

### Basic Messaging

- **WhatsApp to Telegram:** Send a message to your configured WhatsApp Business API number. The message should appear in your Telegram admin group (and a new thread if Forum Mode is enabled).
- **Telegram to WhatsApp:**
  - If using **Forum Mode**: Simply reply directly within the thread corresponding to the WhatsApp contact.
  - If **not** using Forum Mode: Use the `/reply` command in the Telegram group:
    ```
    /reply <PHONE_NUMBER> <your_message_here>
    ```
    Alternatively, you can use `@<PHONE_NUMBER> <your_message_here>`.
- **Read Receipts:** WhatsApp messages will automatically be marked as read once a reply is sent from Telegram.

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
