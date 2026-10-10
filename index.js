import "dotenv/config";

import { GoogleGenAI, Models } from "@google/genai";
import express from "express";
import multer from "multer";
import cors from "cors";

const app = express();
const upload = multer();
const ai = new GoogleGenAI();
const PORT = 3000;

// insialisasi aplikasi
app
.use(upload.single("file")) //menggunakan package multer untuk inisiate single upload
// method chaining
.use(cors())
.use(express.json())

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

//bungkus gan
.listen(PORT, () => {
    console.log('running on Port 3000');
});



