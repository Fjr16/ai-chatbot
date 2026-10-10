```js
import { GoogleGenAI } from "@google/genai";
console.log('import package google genai')

import "dotenv/config";
console.log('import env config');

// 1 - dengan syarat env vriabel name = GOOGLE_API_KEY / GEMINI_API_KEY
const ai = new GoogleGenAI({});

// 2 - variabel name in env bebas
// const ai = new GoogleGenAI({
//     apiKey:process.env.GOOGLE_KEY,
// });

console.log('mulai interaksinya')

const interaction = await ai.interactions.create({
  model: "gemini-3.8-flash",
  input: "Explain how AI works",
});

console.log('berhasil');
console.log(interaction.output_text);

```