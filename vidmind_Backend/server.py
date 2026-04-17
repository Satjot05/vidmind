from flask import Flask, jsonify, request, Response, stream_with_context
from flask_cors import CORS
import requests
import os
import re
import json
import http.cookiejar
import itertools
from concurrent.futures import ThreadPoolExecutor, as_completed

app = Flask(__name__)
CORS(app, origins="*")

# ── API KEYS (loaded from environment variables) ──────────────────────────────
# Set GROQ_KEYS as a comma-separated string in your environment, e.g.:
#   GROQ_KEYS=gsk_key1,gsk_key2,gsk_key3
# Or set individual keys: GROQ_KEY_1, GROQ_KEY_2, etc.

def _load_groq_keys():
    # Try comma-separated GROQ_KEYS first
    raw = os.environ.get("GROQ_KEYS", "")
    keys = [k.strip() for k in raw.split(",") if k.strip()]
    if keys:
        return keys
    # Fall back to individually numbered keys
    numbered = []
    for i in range(1, 20):
        k = os.environ.get(f"GROQ_KEY_{i}", "").strip()
        if k:
            numbered.append(k)
        elif i > 1:
            break
    if numbered:
        return numbered
    raise RuntimeError(
        "No Groq API keys found! Set GROQ_KEYS env var (comma-separated) "
        "or GROQ_KEY_1, GROQ_KEY_2, etc."
    )

GROQ_KEYS = _load_groq_keys()
_key_cycle = itertools.cycle(GROQ_KEYS)

def get_key():
    return next(_key_cycle)

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
COOKIE_PATH  = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cookies.txt")

# ── TRANSCRIPT ────────────────────────────────────────────────────────────────

def make_ytt():
    from youtube_transcript_api import YouTubeTranscriptApi
    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    })
    if os.path.exists(COOKIE_PATH):
        jar = http.cookiejar.MozillaCookieJar(COOKIE_PATH)
        jar.load(ignore_discard=True, ignore_expires=True)
        session.cookies = jar
    try:
        return YouTubeTranscriptApi(http_client=session)
    except TypeError:
        return YouTubeTranscriptApi()

def build_timestamped(segments):
    parts = []
    for s in segments:
        mins = int(s.start // 60)
        secs = int(s.start % 60)
        parts.append(f"[{mins}:{secs:02d}] {s.text}")
    return " ".join(parts)

def fetch_best_transcript(video_id):
    ytt = make_ytt()
    try:
        tlist = list(ytt.list(video_id))
        print(f"[TRANSCRIPT] Found {len(tlist)} transcript(s)")
        manual_en, auto_en, manual_any, auto_any = None, None, None, None
        for t in tlist:
            lang = t.language_code.lower()
            is_generated = t.is_generated
            if lang.startswith("en") and not is_generated:
                manual_en = t
            elif lang.startswith("en") and is_generated:
                auto_en = t
            elif not is_generated and manual_any is None:
                manual_any = t
            elif is_generated and auto_any is None:
                auto_any = t
        chosen = manual_en or auto_en or manual_any or auto_any or (tlist[0] if tlist else None)
        if chosen:
            fetched = chosen.fetch()
            text = " ".join([s.text for s in fetched])
            timestamped = build_timestamped(fetched)
            return text, timestamped, chosen.language_code
    except Exception as e:
        print(f"[TRANSCRIPT] Strategy 1 failed: {e}")

    for lang in [["en"], ["en-US"], ["en-GB"], None]:
        try:
            fetched = ytt.fetch(video_id, languages=lang) if lang else ytt.fetch(video_id)
            text = " ".join([s.text for s in fetched])
            timestamped = build_timestamped(fetched)
            return text, timestamped, str(lang)
        except Exception as e:
            print(f"[TRANSCRIPT] Strategy 2 lang={lang} failed: {e}")

    try:
        url = f"https://www.youtube.com/watch?v={video_id}"
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
        page = requests.get(url, headers=headers, timeout=10)
        matches = re.findall(r'"baseUrl":"(https://www\.youtube\.com/api/timedtext[^"]+)"', page.text)
        if matches:
            caption_url = matches[0].replace("\\u0026", "&")
            caption_res = requests.get(caption_url, headers=headers, timeout=10)
            texts = re.findall(r'<text start="([^"]+)"[^>]*>([^<]+)</text>', caption_res.text)
            if texts:
                import html
                plain_parts = []
                ts_parts = []
                for start_str, t in texts:
                    clean = html.unescape(t)
                    plain_parts.append(clean)
                    try:
                        start = float(start_str)
                        mins = int(start // 60)
                        secs = int(start % 60)
                        ts_parts.append(f"[{mins}:{secs:02d}] {clean}")
                    except:
                        ts_parts.append(clean)
                text = " ".join(plain_parts)
                timestamped = " ".join(ts_parts)
                return text, timestamped, "en"
    except Exception as e:
        print(f"[TRANSCRIPT] Strategy 3 failed: {e}")

    raise Exception(
        "No transcript available for this video. This can happen with: "
        "(1) Shorts with no captions, "
        "(2) Live streams that haven't been processed yet, "
        "(3) Videos with captions disabled by the creator."
    )

@app.route("/transcript", methods=["GET"])
def get_transcript():
    video_id = request.args.get("id")
    if not video_id:
        return jsonify({"error": "No video ID provided"}), 400
    try:
        text, timestamped, lang = fetch_best_transcript(video_id)
        print(f"[TRANSCRIPT] ✅ {len(text)} chars, lang={lang}")
        return jsonify({"transcript": text, "timestamped": timestamped, "language": lang})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ── GROQ AI ───────────────────────────────────────────────────────────────────

MODELS = [
    {"name": "llama-3.3-70b-versatile", "max_chars": 6000},
    {"name": "qwen/qwen3-32b",          "max_chars": 4000},
    {"name": "llama-3.1-8b-instant",    "max_chars": 2500},
]

NOTES_MAX_TOKENS   = 2000
DEFAULT_MAX_TOKENS = 1000

def trim_prompt(prompt, max_chars):
    if len(prompt) <= max_chars:
        return prompt
    marker = "Transcript:"
    idx = prompt.rfind(marker)
    if idx != -1:
        header = prompt[:idx + len(marker) + 1]
        transcript = prompt[idx + len(marker) + 1:]
        allowed = max_chars - len(header) - 50
        return header + transcript[:max(allowed, 500)]
    return prompt[:max_chars]

def call_groq(prompt, retries=3, max_tokens=None):
    import time
    if max_tokens is None:
        max_tokens = DEFAULT_MAX_TOKENS

    for attempt in range(retries):
        m = MODELS[min(attempt, len(MODELS) - 1)]
        model = m["name"]
        safe_prompt = trim_prompt(prompt, m["max_chars"])
        api_key = get_key()
        print(f"[AI] Attempt {attempt+1}/{retries} — model={model} prompt_len={len(safe_prompt)} max_tokens={max_tokens}")
        try:
            response = requests.post(
                GROQ_API_URL,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}"
                },
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": safe_prompt}],
                    "max_tokens": max_tokens,
                    "temperature": 0.7
                },
                timeout=60  # reduced from 90
            )
            data = response.json()
            if response.status_code == 200:
                content = data["choices"][0]["message"]["content"]
                finish_reason = data["choices"][0].get("finish_reason", "")
                if finish_reason == "length":
                    print(f"[AI] Response truncated, retrying with next model")
                    continue
                return content, None

            err_msg = data.get("error", {}).get("message", "")
            if response.status_code in (429, 413):
                wait_match = re.search(r"try again in (\d+\.?\d*)s", err_msg)
                # FIXED: cap wait at 8s instead of 40s
                wait = min(float(wait_match.group(1)) if wait_match else 5, 8)
                print(f"[AI] Rate limited, waiting {wait}s")
                time.sleep(wait)
                continue
            return None, err_msg

        except Exception as ex:
            if attempt < retries - 1:
                time.sleep(3)
            else:
                return None, str(ex)

    return None, "All models are currently busy. Please wait a moment and try again."

# ── ROUTES ────────────────────────────────────────────────────────────────────

@app.route("/claude", methods=["POST"])
def claude_proxy():
    body = request.get_json()
    prompt = body.get("prompt", "")
    text, err = call_groq(prompt)
    if text:
        return jsonify({"text": text})
    return jsonify({"error": err}), 500

@app.route("/process-all", methods=["POST"])
def process_all():
    """
    Streams results back via SSE as each AI task completes,
    instead of waiting for all 4 to finish before responding.
    Each event: data: {"key": "summary"|"notes"|"quiz"|"mindmap", "result": "...", "error": null}
    Final event: data: {"done": true}
    """
    body = request.get_json()
    prompts = body.get("prompts", {})
    tasks = {k: v for k, v in prompts.items() if v}
    token_map = {"notes": NOTES_MAX_TOKENS}

    def generate():
        def run_task(key, prompt):
            max_tokens = token_map.get(key, DEFAULT_MAX_TOKENS)
            text, err = call_groq(prompt, max_tokens=max_tokens)
            return key, text, err

        with ThreadPoolExecutor(max_workers=4) as executor:
            futures = {executor.submit(run_task, k, p): k for k, p in tasks.items()}
            for future in as_completed(futures):
                key, text, err = future.result()
                payload = json.dumps({"key": key, "result": text, "error": err})
                print(f"[AI] ✅ Task '{key}' complete, streaming back")
                yield f"data: {payload}\n\n"

        yield 'data: {"done": true}\n\n'

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        }
    )

@app.route("/", methods=["GET"])
def health():
    return jsonify({
        "status": "VidMind running!",
        "keys_loaded": len(GROQ_KEYS),
        "cookies": "FOUND" if os.path.exists(COOKIE_PATH) else "NOT FOUND"
    })

if __name__ == "__main__":
    print("=========================================")
    print("  VidMind Python server — port 5000")
    print(f"  API keys loaded: {len(GROQ_KEYS)} ✅")
    print("  Streaming SSE: ENABLED ✅")
    print("  Notes max_tokens: 2000 ✅")
    print("  Cookies:", "FOUND ✅" if os.path.exists(COOKIE_PATH) else "NOT FOUND ❌")
    print("=========================================")
    app.run(host="0.0.0.0", port=5000, debug=False)