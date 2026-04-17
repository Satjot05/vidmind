# ⚡ VidMind — AI Video Summarizer, Notes Maker & Quiz Generator

> Turn any YouTube video into a detailed summary, structured study notes and a 10-question quiz — instantly. Built with React + Python Flask + LLaMA 3.3 70B via Groq.



---

## 📌 Table of Contents

- [About the Project](#about-the-project)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [System Architecture](#system-architecture)
- [Repositories](#repositories)
- [Prerequisites](#prerequisites)
- [Frontend Setup (React)](#frontend-setup-react)
- [Backend Setup (Python Flask)](#backend-setup-python-flask)
- [Running the Full System](#running-the-full-system)
- [Environment Variables](#environment-variables)
- [How It Works](#how-it-works)
- [Supported Video Types](#supported-video-types)
- [API Endpoints](#api-endpoints)
- [Troubleshooting](#troubleshooting)
- [Project Structure](#project-structure)
- [Acknowledgements](#acknowledgements)

---

## 🧠 About the Project

VidMind is a full-stack AI-powered web application built as a 6th semester college project. It accepts any YouTube video URL and uses Meta's LLaMA 3.3 70B large language model (via Groq's free API) to automatically generate:

- A **detailed 400–500 word summary** covering all major topics
- **Structured study notes** (600–800 words) with headings, key terms, and exam questions
- A **10-question multiple choice quiz** with answer explanations and scoring

All outputs are in English and can be downloaded as PDF files.

---

## ✨ Features

- 🎥 Supports regular videos, YouTube Shorts, and Live stream recordings
- 📋 Detailed AI-generated summaries with introduction, key concepts and takeaways
- 📓 University-level study notes with glossary and possible exam questions
- 🧩 10-question MCQ quiz with instant scoring and per-question explanations
- ⬇️ Download summary, notes and quiz results as PDF
- 🌙 Dark / Light theme toggle
- 📱 Fully responsive — works on mobile, tablet and desktop
- 🔒 Secure — API keys never exposed to the browser
- ⚡ Auto model rotation on rate limits (LLaMA 3.3 → Qwen3 → LLaMA 3.1)

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite |
| Backend | Python 3.10+ + Flask |
| AI Model | Meta LLaMA 3.3 70B (via Groq API) |
| Transcript | youtube-transcript-api |
| Styling | CSS-in-JS (inline styles + CSS classes) |
| HTTP | Flask-CORS + Requests |

---

## 🏗️ System Architecture

```
User Browser (React — localhost:5173)
        │
        │  GET /transcript?id=VIDEO_ID
        │  POST /claude { prompt }
        ▼
Python Flask Server (localhost:5000)
        │
        ├──► YouTube Transcript API ──► YouTube Servers
        │         (fetches captions)
        │
        └──► Groq API ──► LLaMA 3.3 70B
                  (generates summary / notes / quiz)
```

The React frontend never calls external APIs directly — all requests go through the Python backend which acts as a secure proxy. This keeps API keys safe and bypasses browser CORS restrictions.

---

## 📁 Repositories

This project is split into two repositories:

| Repo | Description | Link |
|---|---|---|
| **Frontend** | React app (this repo) | Current repository |
| **Backend** | Python Flask server | [github.com/Satjot05/vidmind-Backend](https://github.com/Satjot05/vidmind-Backend) |

> ⚠️ **Both repos must be running simultaneously** for the application to work. The frontend runs on port `5173` and the backend on port `5000`.

---

## ✅ Prerequisites

Make sure you have the following installed:

- [Node.js](https://nodejs.org/) v18 or higher
- [Python](https://www.python.org/) 3.10 or higher
- [Git](https://git-scm.com/)
- A free [Groq API key](https://console.groq.com) (no credit card required)

---

## ⚛️ Frontend Setup (React)

### 1. Clone the frontend repo

```bash
git clone https://github.com/Satjot05/Ai-Video-Summarizer-Notes-and-Quiz-Generator.git
cd Ai-Video-Summarizer-Notes-and-Quiz-Generator
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start the development server

```bash
npm run dev -- --host
```

The app will be available at `http://localhost:5173`

> The `--host` flag makes it accessible on your local network (useful for testing on mobile devices on the same WiFi).

---

## 🐍 Backend Setup (Python Flask)

### 1. Clone the backend repo

```bash
git clone https://github.com/Satjot05/vidmind-Backend.git
cd vidmind-Backend
```

### 2. Install Python dependencies

```bash
pip install flask flask-cors youtube-transcript-api requests python-dotenv
```

### 3. Add your Groq API key

Open `server.py` and replace the placeholder:

```python
GROQ_API_KEY = "your_groq_api_key_here"
```

Or create a `.env` file in the backend folder:

```env
GROQ_API_KEY=your_groq_api_key_here
```

> Get your free API key at [console.groq.com](https://console.groq.com) — no credit card needed.

### 4. (Optional) Add YouTube cookies to bypass IP blocks

If you get a "YouTube is blocking requests" error, export your YouTube cookies:

1. Install the **"Get cookies.txt LOCALLY"** Chrome extension
2. Go to [youtube.com](https://youtube.com) while logged in
3. Click the extension → Export → save as `cookies.txt`
4. Place `cookies.txt` in the backend folder (same folder as `server.py`)

> **Important:** Add `cookies.txt` to your `.gitignore` — never commit it to GitHub.

### 5. Start the backend server

```bash
python server.py
```

You should see:
```
=========================================
  VidMind Python server — port 5000
  Cookies: FOUND ✅
=========================================
```

---

## 🚀 Running the Full System

Open **two terminals** and run both servers simultaneously:

**Terminal 1 — Backend:**
```bash
cd vidmind-Backend
python server.py
```

**Terminal 2 — Frontend:**
```bash
cd Ai-Video-Summarizer-Notes-and-Quiz-Generator
npm run dev
```

Then open `http://localhost:5173` in your browser and paste any YouTube URL!

---

## 🔑 Environment Variables

### Backend (`server.py` or `.env`)

| Variable | Description | Required |
|---|---|---|
| `GROQ_API_KEY` | Your Groq API key from console.groq.com | ✅ Yes |

### `.gitignore` (add these to both repos)

```
.env
cookies.txt
node_modules/
dist/
__pycache__/
*.pyc
```

---

## ⚙️ How It Works

1. **User pastes a YouTube URL** — the frontend extracts the 11-character video ID, supporting all URL formats (watch, shorts, live, youtu.be, embed)

2. **Transcript extraction** — the Python backend calls `youtube-transcript-api` with multiple fallback strategies:
   - Lists all available transcripts, prioritises manual English captions
   - Falls back to auto-generated captions in any language
   - Falls back to scraping YouTube's timedtext API directly

3. **AI processing** — the transcript is sent to Groq's API with carefully engineered prompts. Three separate API calls generate the summary, notes and quiz. If rate limited, the server automatically waits and rotates to a different model.

4. **Results displayed** — React renders the output in three tabs with syntax-highlighted markdown, and users can download any section as a styled PDF.

---

## 🎬 Supported Video Types

| Type | Support | Notes |
|---|---|---|
| Regular videos | ✅ Full support | Works with any video that has captions |
| YouTube Shorts | ✅ Supported | Must have captions enabled |
| Live stream recordings | ✅ Supported | Captions must be processed (2–4 hrs after stream ends) |
| Active live streams | ❌ Not supported | Captions not available during live |
| Videos with no captions | ❌ Not supported | Creator must enable captions |

---

## 📡 API Endpoints

### `GET /transcript`

Fetches the transcript for a YouTube video.

| Parameter | Type | Description |
|---|---|---|
| `id` | string | YouTube video ID (11 characters) |

**Response:**
```json
{
  "transcript": "Full transcript text...",
  "language": "en"
}
```

---

### `POST /claude`

Sends a prompt to the LLaMA model via Groq.

**Request body:**
```json
{
  "prompt": "Your prompt text here"
}
```

**Response:**
```json
{
  "text": "AI generated response..."
}
```

---

### `GET /`

Health check endpoint.

**Response:**
```json
{
  "status": "VidMind running!",
  "cookies": "FOUND"
}
```

---

## 🔧 Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `Failed to fetch` | Backend not running | Start `python server.py` |
| `Invalid API key` | Wrong or expired Groq key | Generate a new key at console.groq.com |
| `YouTube is blocking requests` | IP blocked by YouTube | Add `cookies.txt` (see setup guide above) |
| `Rate limit reached` | Groq free tier limit hit | Wait ~1 minute, server auto-retries |
| `No transcript available` | Video has no captions | Try a different video with captions enabled |
| `Invalid YouTube URL` | Unsupported URL format | Use a standard youtube.com or youtu.be link |
| `Quiz data unavailable` | AI returned malformed JSON | Re-analyze the video (parser has 4 fallbacks) |

---

## 📂 Project Structure

```
Frontend (React)
├── src/
│   ├── App.jsx          # Main application component
│   └── main.jsx         # React entry point
├── index.html
├── vite.config.js
└── package.json

Backend (Python)
├── server.py            # Flask API server
├── cookies.txt          # YouTube cookies (not committed)
├── .env                 # Environment variables (not committed)
└── requirements.txt     # Python dependencies
```

---

## 🙏 Acknowledgements

- [Meta AI](https://ai.meta.com/) — LLaMA 3.3 70B open source model
- [Groq](https://groq.com/) — Ultra-fast LPU inference API (free tier)
- [youtube-transcript-api](https://github.com/jdepoix/youtube-transcript-api) — YouTube caption extraction
- [Vite](https://vitejs.dev/) — Lightning fast React dev server
- [Flask](https://flask.palletsprojects.com/) — Lightweight Python web framework

---

## 📄 License

This project is licensed under the MIT License.

---

<div align="center">
  <strong>Built with ❤️ as a 6th Semester College Project</strong><br/>
  <sub>VidMind — AI Video Intelligence</sub>
</div>