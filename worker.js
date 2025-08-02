export default {
  async fetch(request, env) {
    try {
      // Initialize database tables on first run
      await initializeDatabase(env);

      const url = new URL(request.url);

      if (url.pathname === "/webhook/whatsapp") {
        if (request.method === "GET") return verifyWhatsAppWebhook(url, env);
        if (request.method === "POST")
          return await handleWhatsAppWebhook(request, env);
      }

      if (url.pathname === "/webhook/telegram" && request.method === "POST") {
        return await handleTelegramWebhook(request, env);
      }

      return new Response("Not Found", { status: 404 });
    } catch (e) {
      console.error("Worker Error:", e.stack || e.message);
      return new Response("Internal Error", { status: 500 });
    }
  },
};

// =============================
// DATABASE INITIALIZATION
// =============================
async function initializeDatabase(env) {
  try {
    // Create tables if they don't exist
    await env.DB.prepare(
      `
      CREATE TABLE IF NOT EXISTS contacts (
        wa_id TEXT PRIMARY KEY,
        thread_id TEXT,
        last_message_id TEXT,
        ai_enabled INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `
    ).run();

    await env.DB.prepare(
      `
      CREATE TABLE IF NOT EXISTS threads (
        thread_id TEXT PRIMARY KEY,
        wa_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (wa_id) REFERENCES contacts(wa_id)
      )
    `
    ).run();

    await env.DB.prepare(
      `
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `
    ).run();

    // Create indexes for better performance
    await env.DB.prepare(
      `
      CREATE INDEX IF NOT EXISTS idx_contacts_thread_id ON contacts(thread_id)
    `
    ).run();

    await env.DB.prepare(
      `
      CREATE INDEX IF NOT EXISTS idx_threads_wa_id ON threads(wa_id)
    `
    ).run();
  } catch (e) {
    console.log(
      "Database initialization (tables might already exist):",
      e.message
    );
  }
}

// =============================
// DATABASE HELPERS
// =============================
async function getContact(env, waId) {
  const result = await env.DB.prepare("SELECT * FROM contacts WHERE wa_id = ?")
    .bind(waId)
    .first();
  return result;
}

async function createOrUpdateContact(env, waId, data = {}) {
  const existing = await getContact(env, waId);

  if (existing) {
    // Update existing contact
    const updateFields = [];
    const values = [];

    if (data.threadId !== undefined) {
      updateFields.push("thread_id = ?");
      values.push(data.threadId);
    }
    if (data.lastMessageId !== undefined) {
      updateFields.push("last_message_id = ?");
      values.push(data.lastMessageId);
    }
    if (data.aiEnabled !== undefined) {
      updateFields.push("ai_enabled = ?");
      values.push(data.aiEnabled ? 1 : 0);
    }

    if (updateFields.length > 0) {
      updateFields.push("updated_at = CURRENT_TIMESTAMP");
      values.push(waId);

      await env.DB.prepare(
        `UPDATE contacts SET ${updateFields.join(", ")} WHERE wa_id = ?`
      )
        .bind(...values)
        .run();
    }
  } else {
    // Create new contact
    await env.DB.prepare(
      `
      INSERT INTO contacts (wa_id, thread_id, last_message_id, ai_enabled)
      VALUES (?, ?, ?, ?)
    `
    )
      .bind(
        waId,
        data.threadId || null,
        data.lastMessageId || null,
        data.aiEnabled !== undefined ? (data.aiEnabled ? 1 : 0) : 1
      )
      .run();
  }
}

async function getThreadByWaId(env, waId) {
  const result = await env.DB.prepare(
    "SELECT thread_id FROM contacts WHERE wa_id = ?"
  )
    .bind(waId)
    .first();
  return result?.thread_id;
}

async function getWaIdByThread(env, threadId) {
  const result = await env.DB.prepare(
    "SELECT wa_id FROM threads WHERE thread_id = ?"
  )
    .bind(threadId)
    .first();
  return result?.wa_id;
}

async function createThread(env, threadId, waId) {
  await env.DB.prepare(
    `
    INSERT OR REPLACE INTO threads (thread_id, wa_id) VALUES (?, ?)
  `
  )
    .bind(threadId, waId)
    .run();

  await createOrUpdateContact(env, waId, { threadId });
}

async function getSetting(env, key) {
  const result = await env.DB.prepare(
    "SELECT value FROM settings WHERE key = ?"
  )
    .bind(key)
    .first();
  return result?.value;
}

async function setSetting(env, key, value) {
  await env.DB.prepare(
    `
    INSERT OR REPLACE INTO settings (key, value, updated_at) 
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `
  )
    .bind(key, value)
    .run();
}

async function isAiEnabled(env, waId) {
  const contact = await getContact(env, waId);
  return contact ? contact.ai_enabled === 1 : true; // default enabled
}

async function setAiStatus(env, waId, enabled) {
  await createOrUpdateContact(env, waId, { aiEnabled: enabled });
}

async function getAllContacts(env) {
  const result = await env.DB.prepare(
    `
    SELECT wa_id, ai_enabled, updated_at, thread_id 
    FROM contacts 
    ORDER BY updated_at DESC
  `
  ).all();
  return result.results || [];
}

// =============================
// STATE & CACHE
// =============================
let isForumGroup = false;
let telegramInitialized = false;

// =============================
// WHATSAPP WEBHOOK
// =============================
async function verifyWhatsAppWebhook(url, env) {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token === env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

async function handleWhatsAppWebhook(request, env) {
  const data = await request.json();
  console.log("WhatsApp Webhook:", JSON.stringify(data, null, 2));

  if (data.entry?.[0]?.changes) {
    for (const change of data.entry[0].changes) {
      if (change.value?.messages) {
        for (const message of change.value.messages) {
          await processWhatsAppMessage(message, change.value, env);
        }
      }
    }
  }
  return new Response("OK", { status: 200 });
}

async function processWhatsAppMessage(message, value, env) {
  const contactWaId = message.from;

  // Update last message ID
  await createOrUpdateContact(env, contactWaId, { lastMessageId: message.id });

  if (!telegramInitialized) {
    await checkGroupType(env);
    telegramInitialized = true;
  }

  let threadId = null;
  if (isForumGroup) {
    threadId = await getThreadByWaId(env, contactWaId);
    if (!threadId) {
      threadId = await createTelegramThread(contactWaId, value, env);
      await createThread(env, threadId, contactWaId);
    }
  }

  const text = message.text?.body || `[${message.type} message]`;
  await forwardTextToTelegram(text, threadId, contactWaId, value, env);

  // === CEK AI ENABLED ===
  const aiEnabled = await isAiEnabled(env, contactWaId);

  if (aiEnabled && message.type === "text") {
    const globalInstruction =
      (await getSetting(env, "global_instruction")) || "";
    const prompt = globalInstruction
      ? `${globalInstruction}\n\nUser: ${text}`
      : text;

    const aiResponse = await callGeminiAI(prompt, env);
    if (aiResponse) {
      await forwardTextToTelegram(
        `🤖 AI: ${aiResponse}`,
        threadId,
        contactWaId,
        value,
        env
      );
      await forwardTextToWhatsApp(aiResponse, contactWaId, env);

      // === Tandai pesan terakhir sebagai read ===
      const contact = await getContact(env, contactWaId);
      if (contact?.last_message_id) {
        await markMessagesAsRead(contactWaId, contact.last_message_id, env);
      }
    }
  }
}

// =============================
// TELEGRAM WEBHOOK
// =============================
async function handleTelegramWebhook(request, env) {
  const update = await request.json();
  console.log("Telegram Webhook:", JSON.stringify(update, null, 2));

  if (update.message?.chat?.id == env.TELEGRAM_ADMIN_GROUP_ID) {
    await processTelegramMessage(update.message, env);
  }
  return new Response("OK", { status: 200 });
}

async function processTelegramMessage(message, env) {
  if (!telegramInitialized) {
    await checkGroupType(env);
    telegramInitialized = true;
  }

  // ==== PERINTAH AI ON/OFF ====
  if (message.text?.startsWith("/ai")) {
    const parts = message.text.split(" ");
    let contactWaId = null;
    let state = null;

    if (isForumGroup && message.message_thread_id) {
      // Di forum thread, auto-detect nomor dari thread
      contactWaId = await getWaIdByThread(env, message.message_thread_id);
      state = parts[1]; // /ai on|off

      if (!contactWaId) {
        await telegramRequest(env, "sendMessage", {
          chat_id: env.TELEGRAM_ADMIN_GROUP_ID,
          message_thread_id: message.message_thread_id,
          text: "❌ Thread ini belum terhubung ke nomor WhatsApp",
        });
        return;
      }
    } else {
      // Di group biasa, perlu specify nomor
      contactWaId = parts[1]; // /ai PHONE_NUMBER on|off
      state = parts[2];
    }

    if (contactWaId && state) {
      const enabled = state.toLowerCase() === "on";
      await setAiStatus(env, contactWaId, enabled);

      const responseText = `🤖 AI untuk ${contactWaId} sekarang ${state.toUpperCase()}`;
      const params = {
        chat_id: env.TELEGRAM_ADMIN_GROUP_ID,
        text: responseText,
      };

      if (isForumGroup && message.message_thread_id) {
        params.message_thread_id = message.message_thread_id;
      }

      await telegramRequest(env, "sendMessage", params);
    } else {
      const usage = isForumGroup
        ? "Usage: /ai on|off (dalam thread) atau /ai PHONE_NUMBER on|off"
        : "Usage: /ai PHONE_NUMBER on|off";

      await telegramRequest(env, "sendMessage", {
        chat_id: env.TELEGRAM_ADMIN_GROUP_ID,
        text: usage,
      });
    }
    return;
  }

  // ==== PERINTAH GLOBAL INSTRUCTION ====
  if (message.text?.startsWith("/instruction")) {
    const instr = message.text.replace("/instruction", "").trim();
    if (instr) {
      await setSetting(env, "global_instruction", instr);
      await telegramRequest(env, "sendMessage", {
        chat_id: env.TELEGRAM_ADMIN_GROUP_ID,
        text: `Global instruction diset:\n${instr}`,
      });
    } else {
      const current =
        (await getSetting(env, "global_instruction")) || "(kosong)";
      await telegramRequest(env, "sendMessage", {
        chat_id: env.TELEGRAM_ADMIN_GROUP_ID,
        text: `Current instruction: ${current}`,
      });
    }
    return;
  }

  // ==== PERINTAH STATUS AI ====
  if (message.text?.startsWith("/status")) {
    const parts = message.text.split(" ");
    let targetWaId = null;

    if (parts.length > 1) {
      // /status PHONE_NUMBER
      targetWaId = parts[1];
    } else if (isForumGroup && message.message_thread_id) {
      // /status dalam thread (auto-detect nomor)
      targetWaId = await getWaIdByThread(env, message.message_thread_id);
    }

    if (targetWaId) {
      // Status untuk nomor spesifik
      try {
        const contact = await getContact(env, targetWaId);

        if (contact) {
          const aiStatus = contact.ai_enabled === 1 ? "🟢 ON" : "🔴 OFF";
          const lastSeen = contact.updated_at
            ? new Date(contact.updated_at).toLocaleString("id-ID", {
                timeZone: "Asia/Jakarta",
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "Never";
          const threadInfo = contact.thread_id
            ? `Thread: ${contact.thread_id}`
            : "No thread";

          const responseText = `📱 <b>Status untuk ${targetWaId}:</b>\n\n🤖 AI: ${aiStatus}\n📅 Last seen: ${lastSeen}\n🧵 ${threadInfo}`;
          const params = {
            chat_id: env.TELEGRAM_ADMIN_GROUP_ID,
            text: responseText,
            parse_mode: "HTML",
          };

          if (isForumGroup && message.message_thread_id) {
            params.message_thread_id = message.message_thread_id;
          }

          await telegramRequest(env, "sendMessage", params);
        } else {
          const responseText = `❌ Nomor ${targetWaId} belum pernah mengirim pesan`;
          const params = {
            chat_id: env.TELEGRAM_ADMIN_GROUP_ID,
            text: responseText,
          };

          if (isForumGroup && message.message_thread_id) {
            params.message_thread_id = message.message_thread_id;
          }

          await telegramRequest(env, "sendMessage", params);
        }
      } catch (e) {
        console.error("Error getting contact status:", e);
        await telegramRequest(env, "sendMessage", {
          chat_id: env.TELEGRAM_ADMIN_GROUP_ID,
          text: `❌ Error getting status: ${e.message}`,
        });
      }
    } else {
      // Status semua nomor
      try {
        const allContacts = await getAllContacts(env);

        if (allContacts.length === 0) {
          await telegramRequest(env, "sendMessage", {
            chat_id: env.TELEGRAM_ADMIN_GROUP_ID,
            text: "📱 Belum ada kontak yang terdaftar",
          });
          return;
        }

        let statusText = "📱 <b>Status AI Semua Kontak:</b>\n\n";
        let onCount = 0;
        let offCount = 0;

        for (const contact of allContacts) {
          const aiStatus = contact.ai_enabled === 1 ? "🟢" : "🔴";
          const lastSeen = contact.updated_at
            ? new Date(contact.updated_at).toLocaleDateString("id-ID", {
                timeZone: "Asia/Jakarta",
              })
            : "Never";

          statusText += `${aiStatus} <code>${contact.wa_id}</code> - ${lastSeen}\n`;

          if (contact.ai_enabled === 1) onCount++;
          else offCount++;
        }

        statusText += `\n📊 <b>Summary:</b>\n🟢 AI ON: ${onCount}\n🔴 AI OFF: ${offCount}\n\n`;
        statusText += `<i>Usage:</i>\n<code>/status PHONE_NUMBER</code> - Detail nomor\n<code>/ai PHONE_NUMBER on|off</code> - Toggle AI`;

        if (isForumGroup) {
          statusText += `\n<code>/status</code> - Status dalam thread\n<code>/ai on|off</code> - Toggle AI dalam thread`;
        }

        await telegramRequest(env, "sendMessage", {
          chat_id: env.TELEGRAM_ADMIN_GROUP_ID,
          text: statusText,
          parse_mode: "HTML",
        });
      } catch (e) {
        console.error("Error getting all contacts:", e);
        await telegramRequest(env, "sendMessage", {
          chat_id: env.TELEGRAM_ADMIN_GROUP_ID,
          text: `❌ Error getting status: ${e.message}`,
        });
      }
    }
    return;
  }

  let contactWaId = null;
  let threadId = null;

  if (isForumGroup) {
    threadId = message.message_thread_id;
    if (!threadId) return;

    contactWaId = await getWaIdByThread(env, threadId);
    console.log(`Thread ${threadId} → Contact: ${contactWaId}`);

    if (!contactWaId) {
      const createdMessage = message.reply_to_message;
      if (createdMessage?.forum_topic_created?.name) {
        const match =
          createdMessage.forum_topic_created.name.match(/\((\d+)\)$/);
        if (match) {
          contactWaId = match[1];
          console.log("Recovered contact from topic name:", contactWaId);
          await createThread(env, threadId, contactWaId);
        }
      }
      if (!contactWaId) {
        await telegramRequest(env, "sendMessage", {
          chat_id: env.TELEGRAM_ADMIN_GROUP_ID,
          message_thread_id: threadId,
          text: "⚠️ Thread belum terhubung ke kontak WhatsApp dan nomor tidak ditemukan.",
        });
        return;
      }
    }
  } else {
    const replyMatch = message.text?.match(/^\/reply\s+(\d+)\s+(.+)$/s);
    const contactMatch = message.text?.match(/^@(\d+)\s+(.+)$/s);
    if (replyMatch) {
      contactWaId = replyMatch[1];
      message.text = replyMatch[2];
    } else if (contactMatch) {
      contactWaId = contactMatch[1];
      message.text = contactMatch[2];
    } else {
      await sendReplyInstructions(env);
      return;
    }
  }

  if (message.text) {
    try {
      await forwardTextToWhatsApp(message.text, contactWaId, env);
      console.log(`Telegram → WA: ${contactWaId} <= ${message.text}`);

      const contact = await getContact(env, contactWaId);
      if (contact?.last_message_id) {
        await markMessagesAsRead(contactWaId, contact.last_message_id, env);
      }
    } catch (e) {
      console.error("WA Send Error:", e.message);
      await telegramRequest(env, "sendMessage", {
        chat_id: env.TELEGRAM_ADMIN_GROUP_ID,
        message_thread_id: threadId,
        text: `❌ Gagal kirim ke WA: ${e.message}`,
      });
    }
  }
}

// =============================
// THREAD
// =============================
async function createTelegramThread(contactWaId, waValue, env) {
  if (!isForumGroup) throw new Error("Group is not a forum");
  const contactName = getContactDisplayName(contactWaId, waValue);
  const topic = await telegramRequest(env, "createForumTopic", {
    chat_id: env.TELEGRAM_ADMIN_GROUP_ID,
    name: `${contactName} (${contactWaId})`,
  });

  const threadId = topic.message_thread_id || topic.message?.message_thread_id;
  console.log("Thread created:", threadId);

  await telegramRequest(env, "sendMessage", {
    chat_id: env.TELEGRAM_ADMIN_GROUP_ID,
    message_thread_id: threadId,
    text: `🔥 New WhatsApp conversation\n👤 Contact: ${contactName}\n📞 Number: ${contactWaId}`,
    parse_mode: "HTML",
  });
  return threadId;
}

// =============================
// UTIL
// =============================
function getContactDisplayName(contactWaId, waValue) {
  const contactInfo = waValue.contacts?.find((c) => c.wa_id === contactWaId);
  return contactInfo?.profile?.name || contactWaId;
}

async function forwardTextToTelegram(
  text,
  threadId,
  contactWaId,
  waValue,
  env
) {
  const contactName = getContactDisplayName(contactWaId, waValue);
  const messageText = isForumGroup
    ? `💬 <b>${contactName}</b>\n\n${text}`
    : `💬 <b>${contactName}</b> (${contactWaId})\n\n${text}\n\n<i>Reply with: /reply ${contactWaId} your_message</i>`;

  const params = {
    chat_id: env.TELEGRAM_ADMIN_GROUP_ID,
    text: messageText,
    parse_mode: "HTML",
  };
  if (threadId) params.message_thread_id = threadId;

  try {
    await telegramRequest(env, "sendMessage", params);
  } catch (e) {
    if (String(e.message).includes("message thread not found")) {
      console.warn("Thread hilang, membuat ulang...");
      const newThreadId = await createTelegramThread(contactWaId, waValue, env);
      await createThread(env, newThreadId, contactWaId);
      params.message_thread_id = newThreadId;
      await telegramRequest(env, "sendMessage", params);
    } else {
      throw e;
    }
  }
}

async function forwardTextToWhatsApp(text, contactWaId, env) {
  return whatsappRequest(env, "messages", {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: contactWaId,
    type: "text",
    text: { body: text },
  });
}

async function markMessagesAsRead(contactWaId, messageId, env) {
  return whatsappRequest(env, "messages", {
    messaging_product: "whatsapp",
    status: "read",
    message_id: messageId,
  });
}

async function sendReplyInstructions(env) {
  await telegramRequest(env, "sendMessage", {
    chat_id: env.TELEGRAM_ADMIN_GROUP_ID,
    text: `📝 How to reply:\n<code>/reply PHONE_NUMBER message</code>\n@PHONE_NUMBER message`,
    parse_mode: "HTML",
  });
}

async function checkGroupType(env) {
  const chat = await telegramRequest(env, "getChat", {
    chat_id: env.TELEGRAM_ADMIN_GROUP_ID,
  });
  isForumGroup = chat.is_forum === true;
  console.log(`Group is ${isForumGroup ? "Forum" : "Regular"} type`);
}

// =============================
// GEMINI AI
// =============================
async function callGeminiAI(prompt, env) {
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-goog-api-key": env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    }
  );
  const json = await res.json();
  return json?.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

// =============================
// HTTP HELPER
// =============================
async function telegramRequest(env, method, params) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || "Telegram API error");
  return data.result;
}

async function whatsappRequest(env, endpoint, data) {
  const url = `https://graph.facebook.com/v19.0/${env.WHATSAPP_PHONE_NUMBER_ID}/${endpoint}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
  const response = await res.json();
  if (!res.ok) throw new Error(response.error?.message || "WhatsApp API error");
  return response;
}
