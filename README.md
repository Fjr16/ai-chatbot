# Multimodal AI Chatbot

A full-stack, multimodal AI chatbot web application powered by **Express.js** and the official **Google GenAI SDK** (`@google/genai`). 

This application allows users to interact with Gemini models using **text, image, audio, and document inputs**, with full support for custom system instructions and fine-tuned generation parameters such as **Temperature**, **Top-K**, and **Top-P**.

---

## ✨ Key Features

- **Multimodal Inputs**: Supports text, images (`.jpg`, `.png`, `.webp`), audio (`.mp3`, `.wav`, `.ogg`), and documents (`.pdf`, `.txt`, etc.).
- **Custom System Instructions**: Set persona, guidelines, or specific behaviors for the model.
- **Generation Parameter Fine-tuning**:
  - **Temperature**: Adjust creativity vs. determinism.
  - **Top-K & Top-P**: Fine-tune nucleus and top-k token sampling.
- **File Processing with Multer**: Seamless file upload handling on the server side.
- **CORS Enabled**: Ready for decoupled frontend integration or third-party client calls.

---

## 🛠️ Tech Stack

- **Runtime Environment**: Node.js
- **Framework**: Express.js
- **AI SDK**: `@google/genai` (Google AI Studio / Gemini API)
- **Middleware**:
  - `multer` for handling multi-part/form-data (file uploads)
  - `cors` for Cross-Origin Resource Sharing
  - `dotenv` for environment variable management

---

## 📁 Repository Structure

```text
├── public/           # Client-side files (HTML, CSS, Frontend JS)
├── uploads/          # Temporary directory for uploaded files
├── .env.example      # Sample environment configuration
├── index.js         # Express server & Gemini API integration
├── package.json      # Dependencies and scripts
└── README.md         # Project documentation
```

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- A **Google AI Studio API Key** (Get one at [Google AI Studio](https://aistudio.google.com/))

### 1. Clone the Repository

```bash
git clone https://github.com/Fjr16/ai-chatbot.git
cd ai-chatbot
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Environment Setup

Create a `.env` file in the root folder based on `.env.example`:

```bash
cp .env.example .env
```

Open `.env` and add your API key:

```env
PORT=3000
GEMINI_API_KEY=your_google_ai_studio_api_key_here
```

### 4. Run the Server (index.js)

Start the application using:

```bash
npm start
```

```bash
node index
```

Or run in development mode (if `nodemon` is configured):

```bash
npm run dev
```

```bash
npx nodemon index.js
```

Open your browser and navigate to `http://localhost:3000`.

---

## 🎛️ Configuration Parameters

| Parameter | Type | Description |
| :--- | :--- | :--- |
| **System Instruction** | `string` | Sets the identity, instructions, and constraints for the AI chatbot. |
| **Temperature** | `float` | Controls output randomness (`0.0` for precise/factual, `1.0` for creative). |
| **Top-K** | `int` | Limits token selection to the $k$ most probable tokens. |
| **Top-P** | `float` | Cumulative probability cutoff for token selection. |

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
