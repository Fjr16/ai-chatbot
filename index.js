import "dotenv/config";

import fs from "node:fs/promises";
import { GoogleGenAI } from "@google/genai";
import express from "express";
import multer from "multer";
import cors from "cors";
import QRCode from "qrcode-terminal";
import {
    makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    jidNormalizedUser,
} from "@whiskeysockets/baileys";
import { getReconnectDelayMs, isAuthResetRequired } from "./wa-connection.js";

const app = express();
const upload = multer();
const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
});

const PORT = Number(process.env.PORT || 3000);
const AUTH_DIR = "baileys_auth";
const SELF_CHAT_MODE = process.env.WA_SELF_CHAT_MODE !== "false";
const SELF_CHAT_COOLDOWN_MS = Number(process.env.WA_SELF_CHAT_COOLDOWN_MS || 15000);
const SELF_CHAT_MAX_PER_HOUR = Number(process.env.WA_SELF_CHAT_MAX_PER_HOUR || 20);
const WA_KEEPALIVE_INTERVAL_MS = Number(process.env.WA_KEEPALIVE_INTERVAL_MS || 60000);
const WA_CONNECT_TIMEOUT_MS = Number(process.env.WA_CONNECT_TIMEOUT_MS || 45000);
const WA_RECONNECT_DELAY_MS = Number(process.env.WA_RECONNECT_DELAY_MS || 5000);
const WA_AUTH_RESET_RECONNECT_DELAY_MS = Number(process.env.WA_AUTH_RESET_RECONNECT_DELAY_MS || 15000);
const DEFAULT_CHAT_CONFIG = {
    temperature: 0.7,
    top_k: 40,
    top_p: 0.9,
};

const processedMessageIds = new Set();
const lastReplyTimes = new Map();
const messageCountByPhone = new Map();
const chatHistoryByJid = new Map();
const userSessionState = new Map();
let botJid = null;
let socketIsReady = false;
let waSocket = null;
let waStartupInProgress = false;
let waRestartTimer = null;
let isShuttingDown = false;
let waRestartCount = 0;
let lastWaRestartAt = 0;
let waLastStatus = {
    connection: "idle",
    qr: false,
    botJid: null,
    lastUpdatedAt: null,
    lastError: null,
    lastDisconnectCode: null,
    lastDisconnectReason: null,
};

const updateWaStatus = (status) => {
    waLastStatus = {
        ...waLastStatus,
        ...status,
        lastUpdatedAt: new Date().toISOString(),
    };

    console.log("[WA STATUS]", JSON.stringify(waLastStatus));
};

const resetBaileysAuth = async (retries = 6) => {
    for (let attempt = 1; attempt <= retries; attempt += 1) {
        try {
            await fs.rm(AUTH_DIR, { recursive: true, force: true });
            await fs.mkdir(AUTH_DIR, { recursive: true });
            console.log(`Auth folder ${AUTH_DIR} dibersihkan untuk session WA baru.`);
            return;
        } catch (error) {
            const isBusy = error?.code === "ENOTEMPTY" || error?.code === "EBUSY";

            if (!isBusy || attempt === retries) {
                console.error("Gagal membersihkan auth WA:", error);
                throw error;
            }

            console.warn(`Auth WA masih terpakai, retry cleanup ${attempt}/${retries}...`);
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    }
};

const parseConfigValue = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeConversation = (conversation = []) => {
    return conversation
        .filter((item) => item && typeof item.text === "string" && item.text.trim())
        .map((item) => {
            const role = item.role === "model" || item.role === "assistant" ? "model" : "user";
            return `${role}: ${item.text.trim()}`;
        })
        .join("\n");
};

const getChatHistoryKey = (jid) => {
    if (!jid) {
        return "global";
    }

    return jidNormalizedUser(jid) || String(jid);
};

const getChatHistory = (jid) => {
    const key = getChatHistoryKey(jid);
    if (!chatHistoryByJid.has(key)) {
        chatHistoryByJid.set(key, []);
    }

    return chatHistoryByJid.get(key);
};

const getUserSession = (jid) => {
    const key = getChatHistoryKey(jid);
    if (!userSessionState.has(key)) {
        userSessionState.set(key, {
            history: [],
            previousInteractionId: null,
        });
    }

    return userSessionState.get(key);
};

const rememberChatTurn = (jid, role, text) => {
    const session = getUserSession(jid);
    const cleanText = String(text || "").trim();
    if (!cleanText) {
        return;
    }

    session.history.push({ role, text: cleanText });
    if (session.history.length > 10) {
        session.history.splice(0, session.history.length - 10);
    }
};

const getFriendlyErrorMessage = (error) => {
    const statusCode = error?.statusCode || error?.status || 500;

    if (statusCode >= 500) {
        return "Ada masalah pada server, hubungi developer.";
    }

    return "Ada masalah pada server, hubungi developer.";
};

const getTextFromMessage = (message) => {
    if (!message || !message.message) return "";

    const content = message.message;

    return (
        content.conversation ||
        content.extendedTextMessage?.text ||
        content.imageMessage?.caption ||
        content.videoMessage?.caption ||
        content.documentMessage?.caption ||
        content.audioMessage?.caption ||
        ""
    );
};

const generateAiReply = async (promptText, options = {}) => {
    const {
        conversation = [],
        config = {},
        temperature,
        topK,
        topP,
        model = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite",
        previousInteractionId,
    } = options;

    const requestConfig = {
        ...DEFAULT_CHAT_CONFIG,
        ...(config && typeof config === "object" ? config : {}),
        ...(temperature !== undefined ? { temperature } : {}),
        ...(topK !== undefined ? { top_k: topK } : {}),
        ...(topP !== undefined ? { top_p: topP } : {}),
    };

    const generationConfig = {
        temperature: parseConfigValue(requestConfig.temperature, DEFAULT_CHAT_CONFIG.temperature),
        top_k: parseConfigValue(requestConfig.top_k ?? requestConfig.topK, DEFAULT_CHAT_CONFIG.top_k),
        top_p: parseConfigValue(requestConfig.top_p ?? requestConfig.topP, DEFAULT_CHAT_CONFIG.top_p),
    };

    const prompt = conversation.length ? normalizeConversation(conversation) : promptText;

    if (!prompt || !String(prompt).trim()) {
        throw new Error("Prompt tidak boleh kosong.");
    }

    const requestPayload = {
        model,
        input: prompt,
        generation_config: generationConfig,
        system_instruction: `
            - kamu adalah ai agent sebagai assisten personal seseorang atau user yang terintegrasi dengan platform whatsapp
            - kamu harus memiliki persona yang ramah, walaupun user menggunakan kata yang kasar
            - jawab dengan singkat, padat, dan jelas namun tidak menghilangkan persona kamu yang ramah
            - jika anda tidak memiliki informasi tentang topik yang ditanyakan maka jawab dengan jelas bahwa anda tidak memiliki informasi tentang topik tersebut
            - setiap topik yang ditanyakan jawab dengan menyertakan sumber anda dan juga waktu dari sumber yang anda ambil, agar user dapat menilai apakah informasi masih relevan untuk keadaan user sekarang
            - jelaskan juga konteks jawaban yang diberikan, misal suatu istilah berasal dari beberapa sumber yang memiliki arti yang berbeda-beda tergantung konteksnya, maka jabarkan dulu konteks tersebut
            - format jawaban harus rapi dan mudah dibaca dengan struktur seperti:
              1. Ringkasan
              2. Penjelasan utama
              3. Konteks
              4. Sumber
              5. Kesimpulan
            - setiap topik atau konteks yang berbeda harus dipisahkan dengan satu baris kosong agar terlihat jelas dan tidak menumpuk
            - gunakan format WhatsApp-style: setiap label dan kalimat baru diletakkan di baris baru, bukan satu paragraf panjang
            - jangan tampilkan simbol markdown seperti #, ##, ###, **, * di depan teks
            - gunakan label sederhana seperti: Ringkasan:, Penjelasan utama:, Konteks:, Sumber:, Kesimpulan:
            - setiap baris harus berisi satu ide utama yang singkat dan jelas, lalu beri jeda satu baris sebelum topik berikutnya
            - jika memakai poin, gunakan tanda bulat seperti • dan bukan markdown list seperti - atau *
            - hindari terlalu banyak kalimat dalam satu blok, buat jeda antar kalimat agar terasa lebih bersih, friendly, dan nyaman dibaca di ponsel
            - pola respons yang diharapkan seperti contoh berikut:
              Halo! Senang sekali bisa menyapa kamu kembali. 😊

              Ringkasan: ...

              Penjelasan utama: ...

              Konteks: ...

              Sumber: ...

              Kesimpulan: ...
            - jika ada istilah atau konsep, beri penjelasan singkat agar mudah dipahami
        `,
    };

    if (previousInteractionId) {
        requestPayload.previous_interaction_id = previousInteractionId;
    }

    const interaction = await ai.interactions.create(requestPayload);
    return interaction?.output_text || "Tidak ada jawaban dari model.";
};

const normalizePhoneNumber = (value = "") => {
    if (!value) {
        return "";
    }

    return String(value)
        .replace(/[^\d]/g, "")
        .replace(/^0/, "62")
        .replace(/^\+?62/, "62");
};

const shouldProcessSelfMessage = (remoteJid, fromMe = false) => {
    if (!SELF_CHAT_MODE || !remoteJid || !fromMe) {
        return false;
    }

    if (String(remoteJid).endsWith("@g.us")) {
        return false;
    }

    return String(remoteJid).endsWith("@s.whatsapp.net") || String(remoteJid).endsWith("@lid");
};

const handleSelfChatReply = async (sock, message) => {
    if (!message || !message.key || !message.message) {
        return;
    }

    const remoteJid = message.key.remoteJid;
    if (!remoteJid) {
        return;
    }

    // hanya proses pesan dari akun sendiri dan chat personal
    if (!message.key.fromMe || String(remoteJid).endsWith("@g.us")) {
        return;
    }

    if (!shouldProcessSelfMessage(remoteJid, message.key.fromMe)) {
        return;
    }

    const messageText = getTextFromMessage(message);
    if (!messageText || !messageText.trim()) {
        return;
    }

    const messageId = message.key.id;
    if (!messageId || processedMessageIds.has(messageId)) {
        return;
    }

    const senderKey = jidNormalizedUser(remoteJid);
    const now = Date.now();
    const lastReply = lastReplyTimes.get(senderKey) || 0;
    const hourlyCount = messageCountByPhone.get(senderKey) || 0;

    if (now - lastReply < SELF_CHAT_COOLDOWN_MS) {
        console.log(`Self-chat cooldown aktif untuk ${senderKey}`);
        return;
    }

    if (hourlyCount >= SELF_CHAT_MAX_PER_HOUR) {
        console.log(`Self-chat dibatasi untuk ${senderKey} karena spam protection`);
        return;
    }

    processedMessageIds.add(messageId);
    if (processedMessageIds.size > 5000) {
        const oldest = Array.from(processedMessageIds).slice(0, 4000);
        oldest.forEach((id) => processedMessageIds.delete(id));
    }

    lastReplyTimes.set(senderKey, now);
    messageCountByPhone.set(senderKey, hourlyCount + 1);

    try {
        const session = getUserSession(remoteJid);
        session.history.push({ role: "user", text: messageText.trim() });
        if (session.history.length > 10) {
            session.history.splice(0, session.history.length - 10);
        }

        const replyText = await generateAiReply("", {
            conversation: session.history.slice(-10),
            previousInteractionId: session.previousInteractionId,
        });

        await sock.sendMessage(remoteJid, { text: replyText });
        rememberChatTurn(remoteJid, "assistant", replyText);

        const lastInteraction = await ai.interactions.create({
            model: process.env.GEMINI_MODEL || "gemini-3.1-flash-lite",
            input: `User: ${messageText.trim()}\nAssistant: ${replyText}`,
        });

        session.previousInteractionId = lastInteraction?.id || session.previousInteractionId;
        console.log(`Balasan WA dikirim ke ${remoteJid}`);
    } catch (error) {
        console.error("Gagal mengirim balasan WA:", error);
    }
};

const startWaSelfChat = async (options = {}) => {
    const { forceReset = false } = options;

    if (!SELF_CHAT_MODE) {
        console.log("Mode self-chat WA disabled. Atur WA_SELF_CHAT_MODE=true untuk aktifkan.");
        return;
    }

    if (waStartupInProgress) {
        return;
    }

    if (waSocket && waSocket.ws && !waSocket.ws.isClosed && !waSocket.ws.isClosing) {
        console.log("WA socket masih aktif, startup baru dibatalkan untuk mencegah duplikasi koneksi.");
        return;
    }

    const now = Date.now();
    if (now - lastWaRestartAt < 15000) {
        console.warn("Startup WA baru dibatalkan untuk mencegah loop restart yang berulang.");
        return;
    }

    waStartupInProgress = true;
    lastWaRestartAt = now;

    if (waRestartTimer) {
        clearTimeout(waRestartTimer);
        waRestartTimer = null;
    }

    if (forceReset) {
        try {
            await resetBaileysAuth();
        } catch (error) {
            console.error("Reset auth WA gagal, proses startup dihentikan:", error);
            waStartupInProgress = false;
            return;
        }
    }

    try {
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            auth: state,
            markOnlineOnConnect: true,
            emitOwnEvents: true,
            keepAliveIntervalMs: WA_KEEPALIVE_INTERVAL_MS,
            connectTimeoutMs: WA_CONNECT_TIMEOUT_MS,
        });

        waSocket = sock;

        sock.ev.on("creds.update", saveCreds);

        sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
            if (qr) {
                updateWaStatus({
                    connection: "qr",
                    qr: true,
                    lastError: "waiting_for_qr",
                    botJid: null,
                });
                console.log("\nSilakan scan QR code untuk masuk ke WhatsApp:\n");
                QRCode.generate(qr, { small: true, margin: 1 });
            }

            if (connection === "open") {
                socketIsReady = true;
                botJid = sock.user?.id || null;
                waRestartCount = 0;
                waStartupInProgress = false;
                updateWaStatus({
                    connection: "open",
                    qr: false,
                    botJid,
                    lastError: null,
                    lastDisconnectCode: null,
                    lastDisconnectReason: null,
                });
                console.log("WA self-chat connected. Bot JID:", botJid);
            }

            if (connection === "close") {
                socketIsReady = false;
                waStartupInProgress = false;
                waSocket = null;

                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const errorMessage = lastDisconnect?.error?.output?.payload?.message || "";
                const shouldResetAuth = isAuthResetRequired(lastDisconnect);

                updateWaStatus({
                    connection: "close",
                    qr: false,
                    botJid,
                    lastError: errorMessage || "unknown_disconnect",
                    lastDisconnectCode: statusCode || null,
                    lastDisconnectReason: errorMessage || null,
                });

                console.log("WA connection closed. Code:", statusCode, "Reason:", errorMessage || "unknown");

                if (shouldResetAuth) {
                    waRestartCount += 1;
                    console.warn("WA mendeteksi konflik sesi. Membersihkan auth folder dan login ulang dari awal.");

                    try {
                        await resetBaileysAuth();
                    } catch (error) {
                        console.error("Auth WA gagal dibersihkan pada close event:", error);
                    }
                }

                if (!isShuttingDown && waRestartCount < 3) {
                    const reconnectDelay = getReconnectDelayMs({
                        shouldResetAuth,
                        restartCount: waRestartCount,
                        defaultDelayMs: WA_RECONNECT_DELAY_MS,
                        resetDelayMs: WA_AUTH_RESET_RECONNECT_DELAY_MS,
                        maxDelayMs: WA_AUTH_RESET_RECONNECT_DELAY_MS,
                    });

                    waRestartTimer = setTimeout(() => {
                        startWaSelfChat({ forceReset: shouldResetAuth }).catch((err) => {
                            console.error("Restart WA self-chat gagal:", err);
                        });
                    }, reconnectDelay);
                } else if (waRestartCount >= 3) {
                    console.error("Loop restart WA terdeteksi. Stop otomatis untuk mencegah siklus booting terus-menerus.");
                }
            }
        });

        sock.ev.on("messages.upsert", async ({ messages }) => {
            for (const message of messages) {
                try {
                    const remoteJid = message?.key?.remoteJid || "unknown";
                    const fromMe = message?.key?.fromMe;
                    const text = getTextFromMessage(message) || "[no-text]";

                    console.log("[DEBUG] incoming message:", {
                        remoteJid,
                        fromMe,
                        id: message?.key?.id,
                        text,
                        type: message?.message ? Object.keys(message.message)[0] : "unknown",
                    });

                    await handleSelfChatReply(sock, message);
                } catch (error) {
                    console.error("Error saat memproses pesan self-chat:", error);
                }
            }
        });
    } catch (error) {
        waSocket = null;
        waStartupInProgress = false;
        console.error("Koneksi WA gagal dibuat:", error);

        if (!isShuttingDown && waRestartCount < 3) {
            const reconnectDelay = getReconnectDelayMs({
                shouldResetAuth: true,
                restartCount: waRestartCount,
                defaultDelayMs: WA_RECONNECT_DELAY_MS,
                resetDelayMs: WA_AUTH_RESET_RECONNECT_DELAY_MS,
                maxDelayMs: WA_AUTH_RESET_RECONNECT_DELAY_MS,
            });

            waRestartTimer = setTimeout(() => {
                startWaSelfChat({ forceReset: true }).catch((err) => {
                    console.error("Restart WA self-chat gagal:", err);
                });
            }, reconnectDelay);
        }
    }
};

// insialisasi aplikasi
app
    .use(upload.single("file"))
    .use(cors())
    .use(express.json())
    .use(express.static("public"));

app.get("/api/wa-status", (req, res) => {
    return res.status(200).json({
        success: true,
        selfChatMode: SELF_CHAT_MODE,
        connected: socketIsReady,
        botJid,
        waStatus: waLastStatus,
        socketReady: socketIsReady,
        startupInProgress: waStartupInProgress,
        restartCount: waRestartCount,
    });
});

app.post("/api/generate-text", async (req, res) => {
    const { prompt } = req.body;

    try {
        const message = await generateAiReply(prompt, { model: process.env.GEMINI_MODEL || "gemini-3.1-flash-lite" });

        return res.status(200).json({
            success: true,
            message,
        });
    } catch (error) {
        console.log("Raw error response:", { error });
        const statusCode = error.statusCode || error.status || 500;
        const errorMessage = statusCode >= 500 ? "Ada masalah server, laporkan pada developer" : (error.message || "Terjadi kesalahan.");

        return res.status(statusCode).json({
            success: false,
            error: {
                status: statusCode,
                message: errorMessage,
            },
        });
    }
});

app.post("/api/process/ai", async (req, res) => {
    const { prompt } = req.body;
    const inputParts = [];

    if (prompt) {
        inputParts.push({
            type: "text",
            text: prompt,
        });
    }

    if (req.file) {
        const base64File = req.file?.buffer.toString("base64");
        const mimeType = req.file?.mimetype || "";
        let fileType = "document";

        if (mimeType.startsWith("image/")) {
            fileType = "image";
        } else if (mimeType.startsWith("audio/")) {
            fileType = "audio";
        } else if (mimeType.startsWith("video/")) {
            fileType = "video";
        }

        inputParts.push({
            type: fileType,
            data: base64File,
            mime_type: mimeType,
        });
    }

    try {
        const interaction = await ai.interactions.create({
            model: process.env.GEMINI_MODEL || "gemini-3.1-flash-lite",
            input: inputParts.length === 1 && inputParts[0].text ? inputParts[0].text : inputParts,
        });

        return res.status(200).json({
            success: true,
            message: interaction.output_text,
        });
    } catch (error) {
        console.log("Raw error response:", { error });
        const statusCode = error.statusCode || error.status || 500;
        const errorMessage = statusCode >= 500 ? "Ada masalah server, laporkan pada developer" : (error.message || "Terjadi kesalahan.");

        return res.status(statusCode).json({
            success: false,
            error: {
                status: statusCode,
                message: errorMessage,
            },
        });
    }
});

app.post("/api/chat", async (req, res) => {
    const {
        conversation = [],
        config = {},
        temperature,
        topK,
        topP,
        model = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite",
        previous_interaction_id: previousInteractionId,
    } = req.body || {};

    const requestConfig = {
        ...DEFAULT_CHAT_CONFIG,
        ...(config && typeof config === "object" ? config : {}),
        ...(temperature !== undefined ? { temperature } : {}),
        ...(topK !== undefined ? { top_k: topK } : {}),
        ...(topP !== undefined ? { top_p: topP } : {}),
    };

    const generationConfig = {
        temperature: parseConfigValue(requestConfig.temperature, DEFAULT_CHAT_CONFIG.temperature),
        top_k: parseConfigValue(requestConfig.top_k ?? requestConfig.topK, DEFAULT_CHAT_CONFIG.top_k),
        top_p: parseConfigValue(requestConfig.top_p ?? requestConfig.topP, DEFAULT_CHAT_CONFIG.top_p),
    };

    const promptText = normalizeConversation(conversation);

    if (!promptText.trim()) {
        return res.status(400).json({
            success: false,
            error: {
                status: 400,
                message: "Ada masalah pada server, hubungi developer.",
            },
        });
    }

    try {
        const modelMessage = await generateAiReply(promptText, {
            config: generationConfig,
            model,
            previousInteractionId,
        });

        return res.status(200).json({
            success: true,
            message: modelMessage,
        });
    } catch (error) {
        console.log("Raw error response:", { error });
        console.log("API generation Error:", {
            message: error.message,
            stack: error.stack,
            response: error?.response,
        });

        const statusCode = error.statusCode || error.status || 500;
        const errorMessage = getFriendlyErrorMessage({ statusCode });

        return res.status(statusCode).json({
            success: false,
            error: {
                status: statusCode,
                message: errorMessage,
            },
        });
    }
});

startWaSelfChat().catch((error) => {
    console.error("Gagal menjalankan self-chat WA:", error);
});

app.listen(PORT, () => {
    console.log(`running on Port ${PORT}`);
});



