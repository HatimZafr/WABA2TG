export default {
  async fetch(request, env) {
    try {
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
// STATE & KV
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
  await env.MAP_STORE.put(`lastMessage:${contactWaId}`, message.id);

  if (!telegramInitialized) {
    await checkGroupType(env);
    telegramInitialized = true;
  }

  let threadId = null;
  if (isForumGroup) {
    threadId = await env.MAP_STORE.get(`contact:${contactWaId}`);
    if (!threadId) {
      threadId = await createTelegramThread(contactWaId, value, env);
      await env.MAP_STORE.put(`contact:${contactWaId}`, threadId);
      await env.MAP_STORE.put(`thread:${threadId}`, contactWaId);
    }
  }

  const text = message.text?.body || `[${message.type} message]`;
  await forwardTextToTelegram(text, threadId, contactWaId, value, env);

  // === CEK AI ENABLED ===
  const aiStatus = await env.MAP_STORE.get(`ai:${contactWaId}`);
  const aiEnabled = aiStatus !== "off"; // default ON kecuali user set off

  if (aiEnabled && message.type === "text") {
    const globalInstruction =
      (await env.MAP_STORE.get("global_instruction")) || "";
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
      const lastMessageId = await env.MAP_STORE.get(
        `lastMessage:${contactWaId}`
      );
      if (lastMessageId) {
        await markMessagesAsRead(contactWaId, lastMessageId, env);
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
    const [, number, state] = message.text.split(" ");
    if (number && state) {
      await env.MAP_STORE.put(
        `ai:${number}`,
        state.toLowerCase() === "on" ? "on" : "off"
      );
      await telegramRequest(env, "sendMessage", {
        chat_id: env.TELEGRAM_ADMIN_GROUP_ID,
        text: `AI untuk ${number} sekarang ${state.toUpperCase()}`,
      });
    } else {
      await telegramRequest(env, "sendMessage", {
        chat_id: env.TELEGRAM_ADMIN_GROUP_ID,
        text: "Usage: /ai PHONE_NUMBER on|off",
      });
    }
    return;
  }

  // ==== PERINTAH GLOBAL INSTRUCTION ====
  if (message.text?.startsWith("/instruction")) {
    const instr = message.text.replace("/instruction", "").trim();
    if (instr) {
      await env.MAP_STORE.put("global_instruction", instr);
      await telegramRequest(env, "sendMessage", {
        chat_id: env.TELEGRAM_ADMIN_GROUP_ID,
        text: `Global instruction diset:\n${instr}`,
      });
    } else {
      const current =
        (await env.MAP_STORE.get("global_instruction")) || "(kosong)";
      await telegramRequest(env, "sendMessage", {
        chat_id: env.TELEGRAM_ADMIN_GROUP_ID,
        text: `Current instruction: ${current}`,
      });
    }
    return;
  }

  let contactWaId = null;
  let threadId = null;

  if (isForumGroup) {
    threadId = message.message_thread_id;
    if (!threadId) return;

    contactWaId = await env.MAP_STORE.get(`thread:${threadId}`);
    console.log(`Thread ${threadId} → Contact: ${contactWaId}`);

    if (!contactWaId) {
      const createdMessage = message.reply_to_message;
      if (createdMessage?.forum_topic_created?.name) {
        const match =
          createdMessage.forum_topic_created.name.match(/\((\d+)\)$/);
        if (match) {
          contactWaId = match[1];
          console.log("Recovered contact from topic name:", contactWaId);
          await env.MAP_STORE.put(`thread:${threadId}`, contactWaId);
          await env.MAP_STORE.put(`contact:${contactWaId}`, threadId);
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
      const lastMessageId = await env.MAP_STORE.get(
        `lastMessage:${contactWaId}`
      );
      if (lastMessageId)
        await markMessagesAsRead(contactWaId, lastMessageId, env);
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
      await env.MAP_STORE.put(`contact:${contactWaId}`, newThreadId);
      await env.MAP_STORE.put(`thread:${newThreadId}`, contactWaId);
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
