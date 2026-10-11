import "dotenv/config";

import { GoogleGenAI, Models } from "@google/genai";
import express from "express";
import multer from "multer";
import cors from "cors";

const app = express();
const upload = multer();
const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
});
const PORT = 3000;
const DEFAULT_CHAT_CONFIG = {
    temperature: 0.7,
    top_k: 40,
    top_p: 0.9,
};

const parseConfigValue = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeConversation = (conversation = []) => {
    return conversation
        .filter((item) => item && typeof item.text === 'string' && item.text.trim())
        .map((item) => {
            const role = item.role === 'model' || item.role === 'assistant' ? 'model' : 'user';
            return `${role}: ${item.text.trim()}`;
        })
        .join('\n');
};

const getFriendlyErrorMessage = (error) => {
    const statusCode = error?.statusCode || error?.status || 500;

    if (statusCode >= 500) {
        return 'Ada masalah pada server, hubungi developer.';
    }

    return 'Ada masalah pada server, hubungi developer.';
};

// insialisasi aplikasi
app
.use(upload.single("file")) //menggunakan package multer untuk inisiate single upload
// method chaining
.use(cors())
.use(express.json())
.use(express.static('public'))

// insialisasi route
// endpoint 1 : generate text
.post("/api/generate-text", async (req,res) => {
    const { prompt } = req.body;

    try {
        const interaction = await ai.interactions.create({
            model:"gemini-3.1-flash-lite",
            input:prompt
        });

        res.status(200).json({
            success:true,
            message:interaction.output_text
        });
    } catch (error) {
        console.log("Raw error response:", {error});
        console.log('API generation Error:', {
            message:error.message,
            stack:error.stack,
            response:error?.response,
        });

        // 2. Ekstrak kode dan status dengan aman (fallback ke 500 jika tidak ada)
        const statusCode = error.statusCode || error.status || 500;
        // 3. Ambil pesan error yang paling deskriptif
        const errorMessage = statusCode >= 500 
        ? "Ada masalah server, laporkan pada developer" 
        : (error.message || "Terjadi kesalahan.");

        // 4. Kirim respons terstruktur ke klien
        return res.status(statusCode).json({
            success: false,
            error: {
                status: statusCode,
                message: errorMessage,
            }
        });

    }
})

// endpoint 2 : understanding any input from user
.post("/api/process/ai", async (req,res) => {
    const { prompt } = req.body;
    const inputParts = [];
    if (prompt) {
        inputParts.push({
            type:"text",
            text:prompt
        });
    } 

    if(req.file){
        const base64File = req.file?.buffer.toString('base64');
        const mimeType = req.file?.mimetype || "";
        let fileType = 'document';
        if (mimeType.startsWith('image/')){
            fileType = 'image';
        }else if(mimeType.startsWith('audio/')){
            fileType = 'audio';
        }else if (mimeType.startsWith('video/')){
            fileType = 'video';
        }

        inputParts.push({
            type:fileType,
            data:base64File,
            mime_type:mimeType
        });
    }

    try {
        const interaction = await ai.interactions.create({
            model:"gemini-3.1-flash-lite",
            input:(inputParts.length === 1 && inputParts[0].text) ? inputParts[0].text : inputParts
        });

        res.status(200).json({
            success:true,
            message:interaction.output_text
        });
    } catch (error) {
        console.log("Raw error response:", {error});
        console.log('API generation Error:', {
            message:error.message,
            stack:error.stack,
            response:error?.response,
        });

        // 2. Ekstrak kode dan status dengan aman (fallback ke 500 jika tidak ada)
        const statusCode = error.statusCode || error.status || 500;
        // 3. Ambil pesan error yang paling deskriptif
        const errorMessage = statusCode >= 500 
        ? "Ada masalah server, laporkan pada developer" 
        : (error.message || "Terjadi kesalahan.");

        // 4. Kirim respons terstruktur ke klien
        return res.status(statusCode).json({
            success: false,
            error: {
                status: statusCode,
                message: errorMessage,
            }
        });

    }
})

.post("/api/chat", async (req,res) => {
    const {
        conversation = [],
        config = {},
        temperature,
        topK,
        topP,
        model = 'gemini-3.1-flash-lite',
        previous_interaction_id: previousInteractionId,
    } = req.body || {};
    const requestConfig = {
        ...DEFAULT_CHAT_CONFIG,
        ...(config && typeof config === 'object' ? config : {}),
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
                message: 'Ada masalah pada server, hubungi developer.',
            }
        });
    }

    try {
        const requestPayload = {
            model,
            input: promptText,
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
            `
        };

        if (previousInteractionId) {
            requestPayload.previous_interaction_id = previousInteractionId;
        }

        const interaction = await ai.interactions.create(requestPayload);

        const modelMessage = interaction?.output_text || 'Tidak ada jawaban dari model.';

        res.status(200).json({
            success: true,
            message: modelMessage,
            interactionId: interaction?.id,
        });
    } catch (error) {
        console.log("Raw error response:", { error });
        console.log('API generation Error:', {
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
            }
        });
    }
})


//bungkus gan
.listen(PORT, () => {
    console.log('running on Port 3000');
});



