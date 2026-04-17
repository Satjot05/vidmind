import { useState, useRef, useEffect, useCallback } from "react";

const TABS = ["Summary", "Notes", "Quiz", "Mind Map"];

const extractVideoId = (url) => {
  if (!url) return null;
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
};

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:5000";

const fetchTranscript = async (videoId) => {
  const res = await fetch(`${BACKEND_URL}/transcript?id=${videoId}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return { text: data.transcript, timestamped: data.timestamped };
};

const fetchVideoTitle = async (videoId) => {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    const data = await res.json();
    return data.title || null;
  } catch { return null; }
};

// ── STREAMING processAll: calls onResult(key, rawText) as each task finishes ─
const processAllStream = async (transcript, prompts, onResult) => {
  const res = await fetch(`${BACKEND_URL}/process-all`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript, prompts }),
  });

  if (!res.ok) throw new Error(`Server error: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n\n");
    buffer = lines.pop(); // keep incomplete chunk
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const data = JSON.parse(line.slice(6));
        if (data.done) return;
        if (data.key && data.result) {
          onResult(data.key, data.result, data.error);
        }
      } catch (e) {
        console.warn("SSE parse error:", e);
      }
    }
  }
};

const parseQuiz = (raw) => {
  if (!raw) return null;
  let clean = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(clean); } catch { }
  try { const m = clean.match(/\[[\s\S]*\]/); if (m) return JSON.parse(m[0]); } catch { }
  try {
    const s = clean.indexOf("["), e = clean.lastIndexOf("]");
    if (s !== -1 && e > s) return JSON.parse(clean.slice(s, e + 1));
  } catch { }
  try {
    const fixed = clean.slice(clean.indexOf("["), clean.lastIndexOf("]") + 1).replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(fixed);
  } catch { }
  return null;
};

const parseMindMap = (raw) => {
  if (!raw) return null;
  let clean = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(clean); } catch { }
  try {
    const s = clean.indexOf("{"), e = clean.lastIndexOf("}");
    if (s !== -1 && e > s) return JSON.parse(clean.slice(s, e + 1));
  } catch { }
  return null;
};

const parseSummary = (raw) => {
  if (!raw) return null;
  let clean = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(clean); } catch { }
  try {
    const s = clean.indexOf("{"), e = clean.lastIndexOf("}");
    if (s !== -1 && e > s) return JSON.parse(clean.slice(s, e + 1));
  } catch { }
  return null;
};

const parseNotes = (raw) => {
  if (!raw) return null;
  let clean = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(clean); } catch { }
  try {
    const s = clean.indexOf("{"), e = clean.lastIndexOf("}");
    if (s !== -1 && e > s) return JSON.parse(clean.slice(s, e + 1));
  } catch { }
  return null;
};

const PARSERS = {
  summary: parseSummary,
  notes:   parseNotes,
  quiz:    parseQuiz,
  mindmap: parseMindMap,
};

const KEY_MAP = {
  summary: "Summary",
  notes:   "Notes",
  quiz:    "Quiz",
  mindmap: "MindMap",
};

// Tab ready badges — shown when a tab's data is available while others still load
const TAB_READY_LABELS = {
  Summary: "📋",
  Notes:   "📓",
  Quiz:    "🧩",
  "Mind Map": "🗺️",
};

const RESULT_KEY_FOR_TAB = {
  Summary:    "Summary",
  Notes:      "Notes",
  Quiz:       "Quiz",
  "Mind Map": "MindMap",
};

const openPdf = (htmlContent, title) => {
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<title>${title}</title>
<style>
  @media print { body { margin: 0; } .no-print { display: none; } }
  body { font-family: 'Segoe UI', sans-serif; max-width: 820px; margin: 32px auto; padding: 0 28px; color: #1a1a2e; line-height: 1.8; font-size: 14px; }
  h1 { color: #7c3aed; border-bottom: 3px solid #7c3aed; padding-bottom: 10px; margin-bottom: 6px; font-size: 24px; }
  h2 { color: #5b21b6; margin-top: 28px; border-left: 4px solid #7c3aed; padding-left: 11px; font-size: 17px; }
  h3 { color: #6d28d9; font-size: 15px; margin-top: 18px; }
  strong { background: #ede9fe; padding: 1px 5px; border-radius: 3px; color: #4c1d95; }
  ul { padding-left: 20px; } li { margin-bottom: 5px; }
  .meta { color: #888; font-size: 12px; margin-bottom: 28px; }
  .print-btn { position: fixed; top: 18px; right: 18px; background: #7c3aed; color: #fff; border: none; padding: 10px 22px; border-radius: 8px; font-size: 14px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 14px rgba(124,58,237,0.4); }
  .print-btn:hover { background: #6d28d9; }
</style>
</head>
<body>
<button class="print-btn no-print" onclick="window.print()">⬇ Save as PDF</button>
<h1>${title}</h1>
<p class="meta">Generated by VidMind AI • ${new Date().toLocaleDateString()}</p>
${htmlContent}
</body>
</html>`;
  const win = window.open("", "_blank");
  win.document.write(html);
  win.document.close();
};

const downloadNotesPdf = (notes, videoTitle) => {
  if (!notes) return;
  let html = "";
  if (notes.overview) html += `<h2>Overview</h2><p>${notes.overview}</p>`;
  if (notes.objectives?.length) {
    html += `<h2>Learning Objectives</h2><ul>${notes.objectives.map(o => `<li>${o}</li>`).join("")}</ul>`;
  }
  if (notes.sections?.length) {
    notes.sections.forEach(s => {
      html += `<h2>${s.title}</h2>`;
      if (s.content) html += `<p>${s.content}</p>`;
      if (s.keyPoints?.length) html += `<ul>${s.keyPoints.map(p => `<li>${p}</li>`).join("")}</ul>`;
    });
  }
  if (notes.keyTerms?.length) {
    html += `<h2>Key Terms</h2>`;
    notes.keyTerms.forEach(t => {
      html += `<p><strong>${t.term}</strong>: ${t.definition}</p>`;
    });
  }
  if (notes.examQuestions?.length) {
    html += `<h2>Possible Exam Questions</h2><ol>${notes.examQuestions.map(q => `<li>${q}</li>`).join("")}</ol>`;
  }
  openPdf(html, videoTitle ? `Study Notes – ${videoTitle}` : "Study Notes");
};

const downloadQuizPdf = (quiz, score, submitted) => {
  let content = "";
  if (submitted) {
    const pct = Math.round((score / quiz.length) * 100);
    const emoji = pct >= 80 ? "🎉" : pct >= 50 ? "👍" : "📚";
    content += `<div style="background:#f3f0ff;border:2px solid #7c3aed;border-radius:10px;padding:16px 20px;margin-bottom:28px;">
      <div style="font-size:22px;font-weight:800;color:#5b21b6;">${emoji} Score: ${score}/${quiz.length} (${pct}%)</div></div>`;
  }
  quiz.forEach((q, i) => {
    content += `<div style="margin-bottom:24px;padding:16px;border:1px solid #e9e3ff;border-radius:8px;">
      <div style="font-weight:700;color:#1e1a33;margin-bottom:10px;font-size:15px;"><span style="color:#7c3aed;margin-right:6px;">Q${i+1}.</span>${q.q}</div>
      <ul style="list-style:none;padding:0;">`;
    q.options.forEach((opt, ai) => {
      const correct = ai === q.answer;
      content += `<li style="padding:7px 12px;margin-bottom:4px;border-radius:6px;background:${correct?"#f0fdf4":"#fafafa"};color:${correct?"#16a34a":"#374151"};font-weight:${correct?"700":"400"};">${["A","B","C","D"][ai]}. ${opt}${correct?" ✓":""}</li>`;
    });
    content += `</ul>${q.explanation ? `<div style="margin-top:10px;background:#faf5ff;padding:10px 14px;border-radius:6px;font-size:13px;color:#6d28d9;border-left:3px solid #7c3aed;">💡 ${q.explanation}</div>` : ""}</div>`;
  });
  openPdf(content, "VidMind Quiz");
};

// ── PROMPTS ───────────────────────────────────────────────────────────────────

const SUMMARY_PROMPT = (tx) => `You are an expert educational content creator. Analyze this YouTube video transcript and return ONLY a JSON object. No intro, no markdown, no code blocks. Start with { and end with }.

Use this exact structure:
{
  "intro": "2-3 sentence overview of what the video is about and who it's for",
  "sections": [
    {
      "title": "Section title (3-6 words)",
      "summary": "2-3 sentence description of what this section covers",
      "keyPoints": ["Point 1", "Point 2", "Point 3"]
    }
  ],
  "keyTakeaways": ["Takeaway 1", "Takeaway 2", "Takeaway 3", "Takeaway 4", "Takeaway 5"],
  "conclusion": "2-3 sentence conclusion about what the viewer learned or should do next"
}

Rules:
- sections must have 4-7 entries representing logical topics or chapters of the video
- Do NOT include timestamps — focus on content and concepts, not timing
- keyPoints: 2-4 bullet points per section, concise (under 12 words each)
- keyTakeaways: exactly 5 items, each under 20 words
- Write in English only. Return ONLY the JSON.

Transcript:\n${tx.slice(0, 6000)}`;

const NOTES_PROMPT = (tx) => `You are an expert study notes creator. Analyze this YouTube video transcript and return ONLY a JSON object. No intro, no markdown, no code blocks. Start with { and end with }.

Use EXACTLY this structure:
{
  "overview": "3-4 sentence paragraph overview of the topic and why it matters",
  "objectives": ["You will learn X", "You will understand Y", "You will be able to Z"],
  "sections": [
    {
      "title": "Section Title Here",
      "content": "2-3 sentence explanation of what this section covers and why it's important",
      "keyPoints": [
        "Detailed point explaining a concept clearly in 1-2 sentences",
        "Another detailed point with specific facts or examples",
        "Another important point from this section"
      ]
    }
  ],
  "keyTerms": [
    { "term": "Term Name", "definition": "Clear 1-2 sentence definition of this term" }
  ],
  "examQuestions": [
    "A short-answer question a teacher might ask about this content?",
    "Another exam-style question?",
    "A third question testing understanding?"
  ]
}

Rules:
- overview: 3-4 sentences, substantive and informative
- objectives: exactly 3-5 items, start each with "You will"
- sections: 4-6 sections covering all major topics
- sections[].keyPoints: 3-5 bullet points per section, each 1-2 full sentences (NOT fragments)
- keyTerms: 5-8 important terms with clear definitions
- examQuestions: exactly 5 questions
- Write in English only, be thorough and educational
- Return ONLY the JSON object, nothing else

Transcript:\n${tx.slice(0, 6000)}`;

const QUIZ_PROMPT = (tx) => `Generate exactly 10 multiple choice questions from the transcript below. English only.
YOUR ENTIRE RESPONSE MUST BE ONLY A JSON ARRAY. No intro text, no explanation, no markdown, no code blocks. Start with [ and end with ].
Format: [{"q":"Question?","options":["Option A","Option B","Option C","Option D"],"answer":0,"explanation":"Why this answer is correct"}]
Rules: answer is the 0-based index (0,1,2 or 3). Exactly 10 questions covering different parts. Mix conceptual, factual and application questions.
Transcript:\n${tx.slice(0, 3000)}`;

const MINDMAP_PROMPT = (tx) => `Analyze this YouTube video transcript and create a mind map data structure in JSON format. English only.
YOUR ENTIRE RESPONSE MUST BE ONLY A JSON OBJECT. No intro, no markdown, no code blocks. Start with { and end with }.
Create a 3-level hierarchical mind map with this exact structure:
{
  "root": "Central Topic (3-5 words max)",
  "branches": [
    {
      "id": "b1",
      "label": "Main Topic 1",
      "color": "#7c3aed",
      "children": [
        {
          "id": "b1c1",
          "label": "Subtopic detail here",
          "children": [
            { "id": "b1c1g1", "label": "Specific detail point one" },
            { "id": "b1c1g2", "label": "Specific detail point two" }
          ]
        },
        {
          "id": "b1c2",
          "label": "Another subtopic",
          "children": [
            { "id": "b1c2g1", "label": "Detail about this subtopic" }
          ]
        }
      ]
    }
  ]
}
Rules:
- Root node: 3-5 words summarizing the whole video
- Create exactly 4-6 main branches (key themes/topics)
- Each branch has 2-4 children (specific points)
- Each child should have 1-3 grandchildren (deeper detail points, not all children need grandchildren)
- Branch labels: 2-4 words
- Children labels: 3-6 words
- Grandchildren labels: STRICTLY 3-4 words maximum (short and concise)
- Use these colors for branches in order: "#7c3aed","#0891b2","#059669","#d97706","#dc2626","#7c3aed"
- Total nodes should not exceed 50
Transcript:\n${tx.slice(0, 4000)}`;

// ── ANIMATED BACKGROUND ───────────────────────────────────────────────────────
const BG_PARTICLES = [
  { cx: "10%", cy: "20%", r: 260, dur: "18s", delay: "0s" },
  { cx: "85%", cy: "15%", r: 200, dur: "22s", delay: "-6s" },
  { cx: "70%", cy: "75%", r: 280, dur: "26s", delay: "-10s" },
  { cx: "20%", cy: "80%", r: 180, dur: "20s", delay: "-4s" },
  { cx: "50%", cy: "50%", r: 150, dur: "30s", delay: "-14s" },
];
const DOTS = Array.from({ length: 28 }, (_, i) => ({
  x: (((i * 137.5) % 100)).toFixed(1) + "%",
  y: (((i * 97.3) % 100)).toFixed(1) + "%",
  dur: (12 + (i % 7) * 3) + "s",
  delay: "-" + ((i * 2.3) % 20).toFixed(1) + "s",
  size: i % 3 === 0 ? 2.5 : 1.5,
}));

const AnimatedBackground = ({ dark }) => (
  <div style={{ position: "fixed", inset: 0, zIndex: 0, overflow: "hidden", pointerEvents: "none" }}>
    <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" style={{ position: "absolute", inset: 0 }}>
      <defs>
        {BG_PARTICLES.map((p, i) => (
          <radialGradient key={i} id={"orb" + i} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={dark ? "#7c3aed" : "#8b5cf6"} stopOpacity={dark ? "0.12" : "0.08"} />
            <stop offset="100%" stopColor={dark ? "#7c3aed" : "#8b5cf6"} stopOpacity="0" />
          </radialGradient>
        ))}
      </defs>
      {BG_PARTICLES.map((p, i) => (
        <circle key={i} cx={p.cx} cy={p.cy} r={p.r} fill={"url(#orb" + i + ")"}>
          <animateMotion dur={p.dur} repeatCount="indefinite" begin={p.delay}
            path={"M0,0 Q" + (p.r * 0.4) + "," + (-p.r * 0.3) + " " + (p.r * 0.2) + "," + (p.r * 0.5) + " Q" + (-p.r * 0.3) + "," + (p.r * 0.4) + " 0,0"} />
        </circle>
      ))}
      {DOTS.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={d.size} fill={dark ? "#a78bfa" : "#7c3aed"} opacity={dark ? "0.18" : "0.12"}>
          <animate attributeName="cy" dur={d.dur} begin={d.delay} repeatCount="indefinite"
            values={d.y + ";" + (parseFloat(d.y) - 6).toFixed(1) + "%;" + d.y}
            calcMode="spline" keySplines="0.4 0 0.6 1; 0.4 0 0.6 1" />
        </circle>
      ))}
    </svg>
  </div>
);

const VidMindLogo = ({ size = 36 }) => (
  <svg width={size} height={size} viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#6d28d9" /><stop offset="100%" stopColor="#4c1d95" />
      </linearGradient>
      <linearGradient id="playGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#ffffff" /><stop offset="100%" stopColor="#c4b5fd" stopOpacity="0.9" />
      </linearGradient>
    </defs>
    <rect width="36" height="36" rx="10" fill="url(#bgGrad)" />
    <rect width="36" height="36" rx="10" fill="none" stroke="#a78bfa" strokeWidth="0.8" opacity="0.5" />
    <line x1="18" y1="8" x2="18" y2="28" stroke="#a78bfa" strokeWidth="0.8" opacity="0.4" />
    <polygon points="6,11 6,25 17,18" fill="url(#playGrad)" opacity="0.95" />
    <rect x="20" y="11" width="9" height="2.5" rx="1.25" fill="#c4b5fd" opacity="1" />
    <rect x="20" y="15" width="7" height="2.5" rx="1.25" fill="#c4b5fd" opacity="0.75" />
    <rect x="20" y="19" width="8.5" height="2.5" rx="1.25" fill="#c4b5fd" opacity="0.55" />
    <rect x="20" y="23" width="5.5" height="2.5" rx="1.25" fill="#c4b5fd" opacity="0.35" />
  </svg>
);

// ── HORIZONTAL TREE MIND MAP ──────────────────────────────────────────────────
const HorizontalMindMap = ({ data, dark }) => {
  // Grandchildren start collapsed for a clean initial view
  const [collapsed, setCollapsed] = useState(() => {
    const init = {};
    (data?.branches || []).forEach(b => {
      (b.children || []).forEach(c => {
        if (c.children?.length > 0) init[c.id] = true;
      });
    });
    return init;
  });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const containerRef = useRef(null);
  const panRef = useRef({ pressed: false, active: false, startX: 0, startY: 0, originX: 0, originY: 0 });
  const pinchRef = useRef({ active: false, startDist: 0, startScale: 1 });
  const scaleRef = useRef(1);
  const [isDragging, setIsDragging] = useState(false);

  const clampScale = (s) => Math.min(Math.max(s, 0.2), 4);
  useEffect(() => { scaleRef.current = scale; }, [scale]);

  const onPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    panRef.current = { pressed: true, active: false, startX: e.clientX, startY: e.clientY, originX: pan.x, originY: pan.y };
  };
  const onPointerMove = (e) => {
    const pr = panRef.current;
    if (!pr.pressed) return;
    if (!pr.active) {
      const dx = e.clientX - pr.startX;
      const dy = e.clientY - pr.startY;
      if (Math.hypot(dx, dy) < 4) return;
      pr.active = true;
      setIsDragging(true);
    }
    setPan({ x: pr.originX + (e.clientX - pr.startX), y: pr.originY + (e.clientY - pr.startY) });
  };
  const onPointerUp = () => {
    if (panRef.current.active) setIsDragging(false);
    panRef.current.pressed = false;
    panRef.current.active = false;
  };
  const onTouchStart = (e) => {
    if (e.touches.length === 2) {
      panRef.current.active = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchRef.current = { active: true, startDist: Math.hypot(dx, dy), startScale: scaleRef.current };
    }
  };
  const onTouchMove = (e) => {
    if (pinchRef.current.active && e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const ns = clampScale(pinchRef.current.startScale * (Math.hypot(dx, dy) / pinchRef.current.startDist));
      setScale(ns);
    }
  };
  const onTouchEnd = () => { pinchRef.current.active = false; };

  if (!data || !data.root || !data.branches) return (
    <div style={{ textAlign: "center", padding: 60, color: dark ? "#6b6880" : "#9b8ec4" }}>
      Mind map data unavailable. Try re-analyzing the video.
    </div>
  );

  const toggle = (id) => setCollapsed(c => ({ ...c, [id]: !c[id] }));
  const branches = data.branches || [];

  // ── Dimensions ─────────────────────────────────────────────────────────────
  const ROOT_X = 20,  ROOT_W = 140, ROOT_H = 44;
  const BR_X   = 190, BR_W   = 130, BR_H   = 36;
  const CH_X   = 350, CH_W   = 145, CH_H   = 30;
  const GC_X   = 525, GC_W   = 158, GC_H   = 52;
  const V_BR = 14, V_CH = 6, V_GC = 6;
  const SVG_W = 720;

  // ── Recursive height helpers ────────────────────────────────────────────────
  const gcGroupH = (child) => {
    const gcs = child.children || [];
    if (!gcs.length || collapsed[child.id]) return 0;
    return gcs.length * GC_H + Math.max(0, gcs.length - 1) * V_GC;
  };
  const childH = (child) => Math.max(CH_H, gcGroupH(child));
  const branchH = (branch) => {
    const kids = branch.children || [];
    if (collapsed[branch.id] || !kids.length) return BR_H;
    const total = kids.reduce((s, c) => s + childH(c), 0) + Math.max(0, kids.length - 1) * V_CH;
    return Math.max(BR_H, total);
  };

  // ── SVG total height ────────────────────────────────────────────────────────
  const totalH = branches.reduce((s, b) => s + branchH(b) + V_BR, -V_BR);
  const SVG_H  = Math.max(totalH + 80, 420);
  const rootY  = SVG_H / 2 - ROOT_H / 2;

  // ── Position all nodes ──────────────────────────────────────────────────────
  const hex2rgb = (hex, a) => {
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${a})`;
  };
  const hCurve = (x1, y1, x2, y2) => {
    const mx = (x1 + x2) / 2;
    return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  };

  let curY = (SVG_H - totalH) / 2;
  const posB = branches.map(b => {
    const bH   = branchH(b);
    const bCY  = curY + bH / 2;
    const bY   = bCY - BR_H / 2;
    const kids = b.children || [];
    const kidsH = kids.reduce((s, c) => s + childH(c), 0) + Math.max(0, kids.length - 1) * V_CH;
    let    ky   = collapsed[b.id] ? 0 : curY + (bH - kidsH) / 2;
    const posC = kids.map(c => {
      const cH   = childH(c);
      const cCY  = ky + cH / 2;
      const cY   = cCY - CH_H / 2;
      const gcs  = c.children || [];
      const gcH  = gcGroupH(c);
      const gcY0 = collapsed[c.id] ? 0 : ky + (cH - gcH) / 2;
      ky += cH + V_CH;
      return { ...c, cY, cCY, gcY0 };
    });
    curY += bH + V_BR;
    return { ...b, bY, bCY, posC };
  });

  const btnBase = { border: `1px solid ${dark ? 'rgba(255,255,255,0.1)' : 'rgba(109,40,217,0.2)'}`, color: dark ? '#9d9ab0' : '#6b5ea8', background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(109,40,217,0.07)', borderRadius: 7, fontFamily: "'Sora',sans-serif", cursor: 'pointer' };

  return (
    <div style={{ position: "relative", width: "100%", userSelect: "none" }}>
      {/* ── Controls ── */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: dark ? "#6b6880" : "#9b8ec4" }}>Drag to pan · Click any node to expand/collapse</span>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button onClick={() => { setScale(s => clampScale(s * 1.2)); }} style={{ ...btnBase, width: 26, height: 26, fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>+</button>
          <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono',monospace", color: dark ? '#6b6880' : '#9b8ec4', minWidth: 38, textAlign: 'center' }}>{Math.round(scale * 100)}%</span>
          <button onClick={() => { setScale(s => clampScale(s * 0.8)); }} style={{ ...btnBase, width: 26, height: 26, fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>−</button>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button onClick={() => { setCollapsed(c => { const n = {...c}; branches.forEach(b => { n[b.id] = false; (b.children||[]).forEach(ch => { if(ch.children?.length) n[ch.id] = false; }); }); return n; }); }}
            style={{ ...btnBase, padding: "5px 12px", fontSize: 11 }}>Expand All</button>
          <button onClick={() => { setPan({ x: 0, y: 0 }); setScale(1); setCollapsed(() => { const init = {}; branches.forEach(b => { (b.children||[]).forEach(c => { if(c.children?.length) init[c.id] = true; }); }); return init; }); }}
            style={{ ...btnBase, padding: "5px 12px", fontSize: 11 }}>Reset</button>
        </div>
      </div>

      {/* ── SVG Canvas ── */}
      <div
        ref={containerRef}
        style={{ borderRadius: 14, overflow: "hidden", border: `1px solid ${dark ? "rgba(255,255,255,0.09)" : "rgba(109,40,217,0.12)"}`, background: dark ? "rgba(15,15,20,0.6)" : "rgba(245,243,255,0.6)", cursor: isDragging ? "grabbing" : "grab", touchAction: "none" }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
      >
        <svg width="100%" viewBox={`0 0 ${SVG_W} ${SVG_H}`} style={{ display: "block", minHeight: 420 }}>
          <g transform={`translate(${pan.x},${pan.y}) scale(${scale})`} style={{ transformOrigin: '0 0' }}>

            {/* ── Curves: root → branch ── */}
            {posB.map(b => (
              <path key={"rc-"+b.id} d={hCurve(ROOT_X+ROOT_W, rootY+ROOT_H/2, BR_X, b.bCY)}
                fill="none" stroke={b.color} strokeWidth="1.5" strokeOpacity={dark?0.45:0.4} />
            ))}

            {/* ── Curves: branch → child ── */}
            {posB.map(b => {
              if (collapsed[b.id]) return null;
              return b.posC.map(c => (
                <path key={"bc-"+c.id} d={hCurve(BR_X+BR_W, b.bCY, CH_X, c.cCY)}
                  fill="none" stroke={b.color} strokeWidth="1" strokeOpacity={dark?0.32:0.28} />
              ));
            })}

            {/* ── Curves: child → grandchild ── */}
            {posB.map(b => {
              if (collapsed[b.id]) return null;
              return b.posC.map(c => {
                if (collapsed[c.id] || !c.children?.length) return null;
                return (c.children || []).map((gc, gi) => {
                  const gcCY = c.gcY0 + gi * (GC_H + V_GC) + GC_H / 2;
                  return (
                    <path key={"cgc-"+gc.id} d={hCurve(CH_X+CH_W, c.cCY, GC_X, gcCY)}
                      fill="none" stroke={b.color} strokeWidth="0.75" strokeOpacity={dark?0.22:0.18} />
                  );
                });
              });
            })}

            {/* ── Root node ── */}
            <g>
              <rect x={ROOT_X} y={rootY} width={ROOT_W} height={ROOT_H} rx={10} fill="#7c3aed" />
              <rect x={ROOT_X-4} y={rootY-4} width={ROOT_W+8} height={ROOT_H+8} rx={14}
                fill="none" stroke="#7c3aed" strokeWidth="1" strokeOpacity={0.25} />
              <foreignObject x={ROOT_X+6} y={rootY+2} width={ROOT_W-12} height={ROOT_H-4} style={{ pointerEvents:'none' }}>
                <div xmlns="http://www.w3.org/1999/xhtml" style={{ height:"100%", display:"flex", alignItems:"center", justifyContent:"center", textAlign:"center", fontFamily:"'Sora','Segoe UI',sans-serif", fontSize:"12px", fontWeight:"700", color:"#fff", lineHeight:"1.3", overflow:"hidden", wordBreak:"break-word" }}>
                  {data.root}
                </div>
              </foreignObject>
            </g>

            {/* ── Branch + Child + Grandchild nodes ── */}
            {posB.map(b => {
              const bCollapsed = collapsed[b.id];
              const hasKids    = b.children?.length > 0;
              return (
                <g key={b.id}>
                  {/* Branch rect */}
                  <rect x={BR_X} y={b.bY} width={BR_W} height={BR_H} rx={8}
                    fill={hex2rgb(b.color, dark?0.22:0.12)} stroke={b.color} strokeWidth={1.5} strokeOpacity={0.75}
                    style={{ cursor: hasKids?'pointer':'default' }}
                    onClick={() => hasKids && toggle(b.id)} />
                  <foreignObject x={BR_X+6} y={b.bY+2} width={BR_W-(hasKids?26:12)} height={BR_H-4} style={{ pointerEvents:'none' }}>
                    <div xmlns="http://www.w3.org/1999/xhtml" style={{ height:"100%", display:"flex", alignItems:"center", fontFamily:"'Sora','Segoe UI',sans-serif", fontSize:"11.5px", fontWeight:"600", color: dark?"#e0d7ff":"#3b1a8f", lineHeight:"1.3", overflow:"hidden", wordBreak:"break-word" }}>
                      {b.label}
                    </div>
                  </foreignObject>
                  {/* Branch toggle */}
                  {hasKids && (
                    <g style={{ cursor:'pointer' }} onClick={() => toggle(b.id)}>
                      <circle cx={BR_X+BR_W-10} cy={b.bY+BR_H/2} r={8} fill={b.color} opacity={0.9} />
                      <text x={BR_X+BR_W-10} y={b.bY+BR_H/2+0.5} textAnchor="middle" dominantBaseline="central"
                        fontSize="10" fontWeight="700" fill="#fff" style={{ pointerEvents:'none' }}>
                        {bCollapsed ? '▸' : '◂'}
                      </text>
                    </g>
                  )}

                  {/* Child nodes */}
                  {!bCollapsed && b.posC.map(c => {
                    const cCollapsed = collapsed[c.id];
                    const hasGCs     = c.children?.length > 0;
                    return (
                      <g key={c.id}>
                        {/* Child rect */}
                        <rect x={CH_X} y={c.cY} width={CH_W} height={CH_H} rx={7}
                          fill={hex2rgb(b.color, dark?0.13:0.08)} stroke={b.color} strokeWidth={1} strokeOpacity={0.5}
                          style={{ cursor: hasGCs?'pointer':'default' }}
                          onClick={() => hasGCs && toggle(c.id)} />
                        <foreignObject x={CH_X+7} y={c.cY+1} width={CH_W-(hasGCs?24:14)} height={CH_H-2} style={{ pointerEvents:'none' }}>
                          <div xmlns="http://www.w3.org/1999/xhtml" style={{ height:"100%", display:"flex", alignItems:"center", fontFamily:"'Sora','Segoe UI',sans-serif", fontSize:"10.5px", fontWeight:"500", color: dark?"#c4b5fd":"#5b21b6", lineHeight:"1.3", overflow:"hidden", wordBreak:"break-word" }}>
                            {c.label}
                          </div>
                        </foreignObject>
                        {/* Child toggle (only if has grandchildren) */}
                        {hasGCs && (
                          <g style={{ cursor:'pointer' }} onClick={() => toggle(c.id)}>
                            <circle cx={CH_X+CH_W-9} cy={c.cY+CH_H/2} r={7} fill={b.color} opacity={0.85} />
                            <text x={CH_X+CH_W-9} y={c.cY+CH_H/2+0.5} textAnchor="middle" dominantBaseline="central"
                              fontSize="9" fontWeight="700" fill="#fff" style={{ pointerEvents:'none' }}>
                              {cCollapsed ? '▸' : '◂'}
                            </text>
                          </g>
                        )}

                        {/* Grandchild nodes */}
                        {!cCollapsed && (c.children || []).map((gc, gi) => {
                          const gcY = c.gcY0 + gi * (GC_H + V_GC);
                          return (
                            <g key={gc.id}>
                              <rect x={GC_X} y={gcY} width={GC_W} height={GC_H} rx={6}
                                fill={hex2rgb(b.color, dark?0.07:0.04)} stroke={b.color} strokeWidth={0.75} strokeOpacity={0.38} />
                              <foreignObject x={GC_X+6} y={gcY+4} width={GC_W-12} height={GC_H-8} style={{ pointerEvents:'none' }}>
                                <div xmlns="http://www.w3.org/1999/xhtml" style={{ height:"100%", display:"flex", alignItems:"center", fontFamily:"'Sora','Segoe UI',sans-serif", fontSize:"9px", fontWeight:"500", color: dark?"#a78bfa":"#6d28d9", lineHeight:"1.45", wordBreak:"break-word", whiteSpace:"normal", overflowWrap:"break-word", overflow:"hidden" }}>
                                  {gc.label}
                                </div>
                              </foreignObject>
                            </g>
                          );
                        })}
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {/* ── Branch legend pills ── */}
      <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
        {branches.map(b => (
          <button key={b.id} onClick={() => b.children?.length && toggle(b.id)}
            style={{ display:"flex", alignItems:"center", gap:5, background: dark?"rgba(255,255,255,0.04)":"rgba(109,40,217,0.05)", border:`1px solid ${dark?"rgba(255,255,255,0.08)":"rgba(109,40,217,0.12)"}`, borderRadius:20, padding:"3px 10px", cursor: b.children?.length?"pointer":"default" }}>
            <div style={{ width:8, height:8, borderRadius:"50%", background:b.color, flexShrink:0 }} />
            <span style={{ fontSize:11, color: dark?"#9d9ab0":"#6b5ea8", fontWeight:500 }}>{b.label}</span>
            {b.children?.length > 0 && <span style={{ fontSize:10, color: dark?"#6b6880":"#a89fd0" }}>{collapsed[b.id] ? `+${b.children.length}` : "−"}</span>}
          </button>
        ))}
      </div>
    </div>
  );
};

// ── NOTES TAB ─────────────────────────────────────────────────────────────────
const SECTION_ACCENT_COLORS = [
  { bar: "#7c3aed", bg: d => d ? "rgba(124,58,237,0.07)" : "rgba(124,58,237,0.04)", label: d => d ? "#c4b5fd" : "#5b21b6" },
  { bar: "#0891b2", bg: d => d ? "rgba(8,145,178,0.07)" : "rgba(8,145,178,0.04)", label: d => d ? "#7dd3fc" : "#0c4a6e" },
  { bar: "#059669", bg: d => d ? "rgba(5,150,105,0.07)" : "rgba(5,150,105,0.04)", label: d => d ? "#6ee7b7" : "#064e3b" },
  { bar: "#d97706", bg: d => d ? "rgba(217,119,6,0.07)" : "rgba(217,119,6,0.04)", label: d => d ? "#fcd34d" : "#78350f" },
  { bar: "#dc2626", bg: d => d ? "rgba(220,38,38,0.07)" : "rgba(220,38,38,0.04)", label: d => d ? "#fca5a5" : "#7f1d1d" },
  { bar: "#7c3aed", bg: d => d ? "rgba(124,58,237,0.07)" : "rgba(124,58,237,0.04)", label: d => d ? "#c4b5fd" : "#5b21b6" },
];

const NotesTab = ({ notes, videoTitle, dark, T }) => {
  const [showAllTerms, setShowAllTerms] = useState(false);
  if (!notes) return (
    <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 14, padding: 28, backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}>
      <p style={{ color: T.textSub, fontSize: 14 }}>Notes unavailable. Try re-analyzing the video.</p>
    </div>
  );
  const visibleTerms = showAllTerms ? (notes.keyTerms || []) : (notes.keyTerms || []).slice(0, 6);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: T.textSub, marginBottom: 3 }}>Study Notes</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: T.text, letterSpacing: "-0.5px" }}>{videoTitle || "Video Notes"}</div>
        </div>
        <button className="btn-download" onClick={() => downloadNotesPdf(notes, videoTitle)}>⬇ Download PDF</button>
      </div>
      {notes.overview && (
        <div style={{ marginBottom: 28, paddingBottom: 28, borderBottom: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: T.textSub, marginBottom: 10 }}>Overview</div>
          <p style={{ fontSize: 15, lineHeight: 2, color: T.proseText, margin: 0 }}>{notes.overview}</p>
        </div>
      )}
      {notes.objectives?.length > 0 && (
        <div style={{ marginBottom: 28, paddingBottom: 28, borderBottom: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: T.textSub, marginBottom: 12 }}>What you'll learn</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {notes.objectives.map((obj, i) => (
              <div key={i} style={{ display: "inline-flex", alignItems: "center", gap: 7, background: dark ? "rgba(255,255,255,0.05)" : "rgba(124,58,237,0.06)", border: `1px solid ${dark ? "rgba(255,255,255,0.1)" : "rgba(124,58,237,0.18)"}`, borderRadius: 100, padding: "5px 12px 5px 6px" }}>
                <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#7c3aed", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#fff", flexShrink: 0 }}>{i+1}</div>
                <span style={{ fontSize: 12, color: T.proseText, lineHeight: 1.4 }}>{obj}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {notes.sections?.length > 0 && (
        <div style={{ marginBottom: 28, paddingBottom: 28, borderBottom: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: T.textSub, marginBottom: 20 }}>Detailed Notes</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            {notes.sections.map((sec, i) => {
              const accent = SECTION_ACCENT_COLORS[i % SECTION_ACCENT_COLORS.length];
              return (
                <div key={i} style={{ display: "flex", gap: 0, background: accent.bg(dark), borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ width: 4, flexShrink: 0, background: accent.bar, borderRadius: "4px 0 0 4px" }} />
                  <div style={{ flex: 1, padding: "16px 18px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: accent.label(dark), letterSpacing: "0.5px" }}>{String(i+1).padStart(2,"0")}</span>
                      <h3 style={{ fontSize: 15, fontWeight: 700, color: T.text, margin: 0 }}>{sec.title}</h3>
                    </div>
                    {sec.content && <p style={{ fontSize: 13.5, lineHeight: 1.85, color: T.proseText, margin: "0 0 12px" }}>{sec.content}</p>}
                    {sec.keyPoints?.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {sec.keyPoints.map((pt, j) => (
                          <div key={j} style={{ display: "flex", alignItems: "flex-start", gap: 10, paddingLeft: 4 }}>
                            <div style={{ width: 5, height: 5, borderRadius: "50%", background: accent.bar, flexShrink: 0, marginTop: 7, opacity: 0.8 }} />
                            <span style={{ fontSize: 13, color: T.proseLi, lineHeight: 1.75 }}>{pt}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {notes.keyTerms?.length > 0 && (
        <div style={{ marginBottom: 28, paddingBottom: 28, borderBottom: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: T.textSub, marginBottom: 14 }}>Key Terms & Definitions</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {visibleTerms.map((t, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: "0 16px", padding: "10px 0", borderBottom: `1px solid ${T.border}` }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: dark ? "#c4b5fd" : "#5b21b6", lineHeight: 1.6 }}>{t.term}</div>
                <div style={{ fontSize: 13, color: T.textSub, lineHeight: 1.7 }}>{t.definition}</div>
              </div>
            ))}
          </div>
          {notes.keyTerms.length > 6 && (
            <button onClick={() => setShowAllTerms(v => !v)} style={{ marginTop: 12, background: "none", border: "none", color: "#8b5cf6", fontSize: 13, cursor: "pointer", fontFamily: "'Sora',sans-serif", fontWeight: 600, padding: 0 }}>
              {showAllTerms ? "↑ Show fewer" : `↓ Show ${notes.keyTerms.length - 6} more terms`}
            </button>
          )}
        </div>
      )}
      {notes.examQuestions?.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: T.textSub, marginBottom: 14 }}>Practice Questions</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {notes.examQuestions.map((q, i) => (
              <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "12px 16px", background: dark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)", border: `1px solid ${T.border}`, borderRadius: 10 }}>
                <div style={{ minWidth: 28, height: 28, borderRadius: 8, background: dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: T.textSub, flexShrink: 0 }}>Q{i+1}</div>
                <span style={{ fontSize: 13.5, color: T.proseText, lineHeight: 1.75, paddingTop: 4 }}>{q}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ── SKELETON LOADER — shown while a tab is still generating ──────────────────
const SkeletonLoader = ({ dark, label }) => (
  <div style={{ padding: "32px 0" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
      <div style={{ width: 28, height: 28, borderRadius: "50%", border: `2px solid ${dark ? "rgba(124,58,237,0.5)" : "rgba(124,58,237,0.3)"}`, borderTopColor: "#7c3aed", animation: "spin 0.8s linear infinite" }} />
      <span style={{ fontSize: 14, color: dark ? "#9d9ab0" : "#6b5ea8", fontWeight: 600 }}>Generating {label}…</span>
    </div>
    {[100, 85, 92, 70, 88].map((w, i) => (
      <div key={i} style={{ height: 14, borderRadius: 7, background: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)", marginBottom: 12, width: w + "%", animation: `pulse 1.6s ease-in-out ${i * 0.12}s infinite` }} />
    ))}
  </div>
);

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [url, setUrl] = useState("");
  const [transcript, setTranscript] = useState("");
  const [videoId, setVideoId] = useState("");
  const [activeTab, setActiveTab] = useState("Summary");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState({ Summary: null, Notes: null, Quiz: null, MindMap: null });
  // Track which tabs have finished loading
  const [tabReady, setTabReady] = useState({ Summary: false, Notes: false, Quiz: false, MindMap: false });
  const [quizState, setQuizState] = useState({ answers: {}, submitted: false });
  const [error, setError] = useState("");
  const [step, setStep] = useState("input");
  const [dark, setDark] = useState(true);
  const [videoTitle, setVideoTitle] = useState("");

  const [loadingPct, setLoadingPct] = useState(0);
  const progressRef = useRef({ displayed: 0, target: 0, interval: null });

  // Start a smooth animated progress bar.
  // The bar slowly creeps forward on its own, then jumps ahead when real
  // milestones fire — the same pattern used by GitHub, Vercel, YouTube.
  const startProgress = useCallback(() => {
    const pr = progressRef.current;
    if (pr.interval) clearInterval(pr.interval);
    pr.displayed = 0;
    pr.target = 0;
    setLoadingPct(0);
    pr.interval = setInterval(() => {
      const p = progressRef.current;
      // Two-phase creep:
      //  • Before 90%: advance displayed directly at 1.5%/tick = ~19%/s
      //    → hits 90% in ~6s regardless of real events
      //  • 90-99%: slow trickle so it never stalls at 99%
      // Real milestone bumps (bumpProgress) push target ahead and displayed
      // chases it instantly, so fast completions always look snappy.
      if (p.displayed < p.target) {
        // Chase real target fast
        const chase = Math.max(2.5, (p.target - p.displayed) * 0.25);
        p.displayed = Math.min(p.displayed + chase, p.target);
      } else if (p.displayed < 90) {
        // Steady fake creep toward 90%
        p.displayed = Math.min(p.displayed + 1.5, 90);
        p.target = p.displayed;
      } else if (p.displayed < 99) {
        // Very slow trickle 90→99
        p.displayed = Math.min(p.displayed + 0.08, 99);
        p.target = p.displayed;
      }
      setLoadingPct(Math.round(p.displayed));
    }, 80);
  }, []);

  // Jump the target forward by delta (real milestone)
  const bumpProgress = useCallback((delta) => {
    const pr = progressRef.current;
    pr.target = Math.min(pr.target + delta, 99);
  }, []);

  const finishProgress = useCallback(() => {
    const pr = progressRef.current;
    if (pr.interval) { clearInterval(pr.interval); pr.interval = null; }
    pr.displayed = 100;
    pr.target = 100;
    setLoadingPct(100);
  }, []);

  const resetProgress = useCallback(() => {
    const pr = progressRef.current;
    if (pr.interval) { clearInterval(pr.interval); pr.interval = null; }
    pr.displayed = 0;
    pr.target = 0;
    setLoadingPct(0);
  }, []);

  const T = dark ? {
    bg: "#0f0f14", bgSurface: "#17161f", bgCard: "rgba(255,255,255,0.035)",
    border: "rgba(255,255,255,0.09)", borderFocus: "rgba(124,58,237,0.6)",
    navBg: "rgba(15,15,20,0.88)", text: "#eceaf5", textSub: "#9d9ab0",
    textFaint: "#52505f", inputBg: "rgba(255,255,255,0.05)",
    wordsBg: "rgba(255,255,255,0.06)", wordsColor: "#6b6880",
    proseText: "#c5c2d5", proseH2: "#c4b5fd", proseH3: "#a78bfa", proseLi: "#b8b4cc",
    quizQ: "#eceaf5", quizOptBg: "rgba(255,255,255,0.04)", quizOptBdr: "rgba(255,255,255,0.1)",
    scoreSub: "#9d9ab0", tabBarBg: "rgba(255,255,255,0.04)",
    badge: { bg: "rgba(124,58,237,0.12)", border: "rgba(124,58,237,0.3)", color: "#a78bfa" },
    featureIcon: "#e8e4f0", featureTitle: "#eceaf5", vidMeta: "#6b6880",
    btnGhost: { bg: "rgba(255,255,255,0.06)", border: "rgba(255,255,255,0.1)", color: "#9d9ab0" },
    iconBtn: { bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.09)", color: "#9d9ab0" },
    errorBg: "rgba(239,68,68,0.1)", errorBdr: "rgba(239,68,68,0.3)", errorTxt: "#fca5a5",
  } : {
    bg: "#f0eeff", bgSurface: "#ffffff", bgCard: "rgba(124,58,237,0.04)",
    border: "rgba(109,40,217,0.12)", borderFocus: "rgba(124,58,237,0.5)",
    navBg: "rgba(240,238,255,0.92)", text: "#1e1a33", textSub: "#6b5ea8",
    textFaint: "#a89fd0", inputBg: "rgba(109,40,217,0.05)",
    wordsBg: "rgba(109,40,217,0.08)", wordsColor: "#7c5cbf",
    proseText: "#2d2645", proseH2: "#5b21b6", proseH3: "#7c3aed", proseLi: "#3d3460",
    quizQ: "#1e1a33", quizOptBg: "rgba(109,40,217,0.04)", quizOptBdr: "rgba(109,40,217,0.15)",
    scoreSub: "#6b5ea8", tabBarBg: "rgba(109,40,217,0.06)",
    badge: { bg: "rgba(124,58,237,0.1)", border: "rgba(124,58,237,0.25)", color: "#6d28d9" },
    featureIcon: "#1e1a33", featureTitle: "#1e1a33", vidMeta: "#9b8ec4",
    btnGhost: { bg: "rgba(109,40,217,0.07)", border: "rgba(109,40,217,0.2)", color: "#6b5ea8" },
    iconBtn: { bg: "rgba(109,40,217,0.06)", border: "rgba(109,40,217,0.15)", color: "#7c5cbf" },
    errorBg: "rgba(220,38,38,0.07)", errorBdr: "rgba(220,38,38,0.25)", errorTxt: "#b91c1c",
  };

  const handleProcess = async () => {
    setError("");
    const vid = extractVideoId(url.trim());
    if (!vid) { setError("Invalid YouTube URL. Please enter a valid link."); return; }
    setVideoId(vid);
    setLoading(true);
    startProgress();                        // kick off smooth animated bar
    setTabReady({ Summary: false, Notes: false, Quiz: false, MindMap: false });
    setResults({ Summary: null, Notes: null, Quiz: null, MindMap: null });

    try {
      // Transcript + title fetch — bump target to 15% so bar animates there
      bumpProgress(15);
      const [txData, title] = await Promise.all([fetchTranscript(vid), fetchVideoTitle(vid)]);
      setTranscript(txData.text);
      setVideoTitle(title || "");
      bumpProgress(5); // snap to ~20% now that transcript is really done

      // Show result screen immediately so users see tabs populate
      setStep("result");

      // Stream AI results — each task arrival bumps +20% and marks tab ready
      await processAllStream(
        txData.text,
        {
          summary: SUMMARY_PROMPT(txData.text),
          notes:   NOTES_PROMPT(txData.text),
          quiz:    QUIZ_PROMPT(txData.text),
          mindmap: MINDMAP_PROMPT(txData.text),
        },
        (key, raw, err) => {
          const tabKey = KEY_MAP[key];
          const parsed = PARSERS[key]?.(raw) ?? null;
          setResults(prev => ({ ...prev, [tabKey]: parsed }));
          setTabReady(prev => ({ ...prev, [tabKey]: true }));
          bumpProgress(20); // each of 4 tasks = ~80% total → overall ~95%
        }
      );

      finishProgress();
    } catch (e) {
      setError(e.message || "Something went wrong.");
      setStep("input");
    }
    setLoading(false);
  };

  const handleQuizAnswer = (qi, ai) => {
    if (quizState.submitted) return;
    setQuizState(s => ({ ...s, answers: { ...s.answers, [qi]: ai } }));
  };
  const submitQuiz = () => setQuizState(s => ({ ...s, submitted: true }));
  const resetQuiz  = () => setQuizState({ answers: {}, submitted: false });
  const resetAll   = () => {
    setStep("input"); setUrl(""); setTranscript(""); setVideoId("");
    setResults({ Summary: null, Notes: null, Quiz: null, MindMap: null });
    setTabReady({ Summary: false, Notes: false, Quiz: false, MindMap: false });
    setQuizState({ answers: {}, submitted: false }); setError(""); setVideoTitle("");
    resetProgress();
  };

  const score = quizState.submitted && results.Quiz
    ? results.Quiz.filter((q, i) => quizState.answers[i] === q.answer).length : 0;

  const allDone = Object.values(tabReady).every(Boolean);

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text, fontFamily: "'Sora','Segoe UI',sans-serif", transition: "background 0.25s, color 0.25s", position: "relative" }}>
      <AnimatedBackground dark={dark} />
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #7c3aed55; border-radius: 4px; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity: 0.4; } 50% { opacity: 0.8; } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        .tab-result-enter { animation: fadeIn 0.3s ease; }
        .tab-btn { background: none; border: none; cursor: pointer; padding: 9px 18px; font-family: 'Sora',sans-serif; font-size: 13px; font-weight: 600; border-radius: 8px; transition: all 0.18s; white-space: nowrap; position: relative; }
        .tab-btn.active { background: linear-gradient(135deg,#7c3aed,#a855f7); color: #fff; box-shadow: 0 4px 14px rgba(124,58,237,0.45); }
        .tab-ready-dot { position: absolute; top: 5px; right: 5px; width: 6px; height: 6px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 4px rgba(34,197,94,0.6); }
        .quiz-opt { display: flex; align-items: center; width: 100%; text-align: left; padding: 13px 16px; border-radius: 10px; cursor: pointer; font-family: 'Sora',sans-serif; font-size: 14px; margin-bottom: 9px; transition: all 0.18s; line-height: 1.5; border: 1.5px solid transparent; position: relative; overflow: hidden; }
        .quiz-opt:hover:not(:disabled):not(.selected):not(.correct):not(.wrong) { transform: translateX(3px); border-color: rgba(124,58,237,0.3) !important; background: rgba(124,58,237,0.06) !important; }
        .quiz-opt.selected { border-color: #7c3aed !important; background: rgba(124,58,237,0.18) !important; box-shadow: 0 0 0 3px rgba(124,58,237,0.15), inset 0 0 0 1px rgba(124,58,237,0.4) !important; color: #c4b5fd !important; }
        .quiz-opt.correct { background: rgba(34,197,94,0.14) !important; border-color: #22c55e !important; box-shadow: 0 0 0 3px rgba(34,197,94,0.12) !important; color: #16a34a !important; }
        .quiz-opt.wrong   { background: rgba(239,68,68,0.1) !important; border-color: #ef4444 !important; box-shadow: 0 0 0 3px rgba(239,68,68,0.1) !important; color: #dc2626 !important; }
        .quiz-opt .opt-letter { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 6px; background: rgba(124,58,237,0.08); border: 1px solid rgba(124,58,237,0.18); font-family: 'JetBrains Mono',monospace; font-size: 11px; font-weight: 600; color: #8b5cf6; margin-right: 12px; flex-shrink: 0; transition: all 0.18s; }
        .quiz-opt.selected .opt-letter { background: #7c3aed; border-color: #7c3aed; color: #fff; box-shadow: 0 2px 8px rgba(124,58,237,0.4); }
        .quiz-opt.correct .opt-letter { background: #22c55e; border-color: #22c55e; color: #fff; }
        .quiz-opt.wrong   .opt-letter { background: #ef4444; border-color: #ef4444; color: #fff; }
        .explanation-box { border-radius: 8px; padding: 12px 16px; margin-top: 10px; font-size: 13px; line-height: 1.6; }
        .btn-primary { background: linear-gradient(135deg,#7c3aed,#a855f7); color:#fff; border:none; padding: 13px 28px; border-radius: 12px; font-size: 15px; font-weight: 700; font-family:'Sora',sans-serif; cursor:pointer; transition: all 0.2s; box-shadow: 0 4px 18px rgba(124,58,237,0.38); white-space: nowrap; }
        .btn-primary:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 8px 28px rgba(124,58,237,0.55); }
        .btn-primary:disabled { opacity: 0.45; cursor: not-allowed; }
        .btn-download { display: inline-flex; align-items: center; gap: 6px; background: rgba(124,58,237,0.12); border: 1px solid rgba(124,58,237,0.28); color: #8b5cf6; padding: 7px 14px; border-radius: 8px; font-family:'Sora',sans-serif; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.18s; }
        .btn-download:hover { background: rgba(124,58,237,0.22); color: #fff; border-color: #7c3aed; }
        .feature-card:hover { transform: translateY(-3px); box-shadow: 0 8px 30px rgba(124,58,237,0.12); }
        .feature-card { transition: all 0.2s; }
        @media (max-width: 768px) { .nav-inner { padding: 12px 20px !important; } .page-inner { padding: 32px 20px !important; } .feature-grid { grid-template-columns: repeat(2,1fr) !important; } }
        @media (max-width: 640px) {
          .hero-title { font-size: 34px !important; letter-spacing: -1px !important; }
          .feature-grid { grid-template-columns: 1fr !important; }
          .input-row { flex-direction: column !important; }
          .input-row button { width: 100% !important; padding: 14px !important; }
          .tab-btn { padding: 8px 12px !important; font-size: 12px !important; }
          .result-header { flex-direction: column !important; align-items: flex-start !important; }
          .download-row { flex-wrap: wrap !important; gap: 6px !important; }
          .nav-inner { padding: 10px 16px !important; gap: 8px !important; }
          .nav-logo-text { display: none !important; }
          .page-inner { padding: 24px 14px !important; }
          .card-pad { padding: 18px 14px !important; }
          .video-bar { flex-direction: column !important; align-items: flex-start !important; }
          .video-thumb { width: 100% !important; height: 160px !important; border-radius: 10px !important; }
          .score-bar { flex-direction: column !important; align-items: flex-start !important; }
          .tabs-row { max-width: 100% !important; overflow-x: auto !important; }
          .quiz-opt { padding: 11px 12px !important; font-size: 13px !important; }
          .btn-primary { padding: 13px 20px !important; font-size: 14px !important; }
          .btn-download { padding: 6px 12px !important; font-size: 11px !important; }
        }
        @media (max-width: 480px) {
          .hero-title { font-size: 28px !important; letter-spacing: -0.5px !important; }
          .tabs-row .tab-btn { flex: 1 !important; text-align: center !important; padding: 8px 4px !important; font-size: 10px !important; }
          .nav-right-btns { gap: 6px !important; }
          .nav-new-video { display: none !important; }
          .mobile-new-video { display: flex !important; }
        }
        .mobile-new-video { display: none; }
      `}</style>

      {/* ── NAVBAR ── */}
      <nav style={{ borderBottom: `1px solid ${T.border}`, position: "sticky", top: 0, zIndex: 100, background: T.navBg, backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", boxShadow: dark ? "0 1px 0 rgba(124,58,237,0.1), 0 4px 24px rgba(0,0,0,0.3)" : "0 1px 0 rgba(124,58,237,0.08), 0 4px 20px rgba(109,40,217,0.06)" }}>
        <div className="nav-inner" style={{ width: "100%", padding: "12px 40px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <VidMindLogo size={34} />
            <div>
              <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: "-0.4px", color: T.text }}>VidMind</div>
              <div className="nav-logo-text" style={{ fontSize: 10, color: T.textSub, letterSpacing: "0.4px", lineHeight: 1 }}>AI Video Intelligence</div>
            </div>
          </div>
          <div className="nav-right-btns" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {step === "result" && (
              <button className="nav-new-video" onClick={resetAll} style={{ display: "flex", alignItems: "center", gap: 6, background: T.btnGhost.bg, border: `1px solid ${T.btnGhost.border}`, color: T.btnGhost.color, padding: "7px 14px", borderRadius: 9, fontFamily: "'Sora',sans-serif", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>
                ← New Video
              </button>
            )}
            <a href="https://github.com/Satjot05/Vidmind" target="_blank" rel="noreferrer"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: 9, border: `1px solid ${T.iconBtn.border}`, background: T.iconBtn.bg, color: T.iconBtn.color, textDecoration: "none" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/></svg>
            </a>
            <button onClick={() => setDark(d => !d)} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: 9, border: `1px solid ${T.iconBtn.border}`, background: T.iconBtn.bg, color: T.iconBtn.color, cursor: "pointer" }}>
              {dark
                ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
                : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>}
            </button>
          </div>
        </div>
      </nav>

      {/* ── PAGE BODY ── */}
      <div className="page-inner" style={{ position: "relative", zIndex: 1, maxWidth: 880, margin: "0 auto", padding: "44px 24px" }}>

        {/* ── INPUT SCREEN ── */}
        {step === "input" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ marginBottom: 52 }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: T.badge.bg, border: `1px solid ${T.badge.border}`, borderRadius: 100, padding: "5px 16px", fontSize: 11, color: T.badge.color, fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase", marginBottom: 22 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: T.badge.color, display: "inline-block" }} />
                Free · No API Key · English Output
              </div>
              <h1 className="hero-title" style={{ fontSize: "clamp(32px,5.5vw,56px)", fontWeight: 800, letterSpacing: "-2px", lineHeight: 1.1, marginBottom: 18 }}>
                Turn any YouTube<br />
                <span style={{ background: "linear-gradient(135deg,#7c3aed,#e879f9)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>video into knowledge</span>
              </h1>
              <p style={{ color: T.textSub, fontSize: 16, maxWidth: 520, margin: "0 auto", lineHeight: 1.75 }}>
                Paste a YouTube link and get a detailed AI summary, structured study notes, a 10-question quiz, and an interactive mind map — all generated in parallel.
              </p>
            </div>

            <div className="feature-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 44 }}>
              {[
                { icon: "📋", title: "Detailed Summary",   desc: "Section-based overview with key takeaways from every topic" },
                { icon: "📓", title: "Study Notes",        desc: "Rich structured notes with key terms and exam questions" },
                { icon: "🧩", title: "10-Question Quiz",   desc: "MCQs with answer explanations to test your understanding" },
                { icon: "🗺️", title: "Mind Map",           desc: "Horizontal tree map like NotebookLM — collapsible branches" },
              ].map(f => (
                <div className="feature-card" key={f.title} style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 14, padding: "22px 16px", textAlign: "left" }}>
                  <div style={{ fontSize: 24, marginBottom: 10 }}>{f.icon}</div>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: T.featureTitle }}>{f.title}</div>
                  <div style={{ color: T.textSub, fontSize: 12, lineHeight: 1.65 }}>{f.desc}</div>
                </div>
              ))}
            </div>

            <div style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 18, padding: "24px", boxShadow: dark ? "0 0 40px rgba(124,58,237,0.15)" : "0 4px 32px rgba(124,58,237,0.1)" }}>
              <div className="input-row" style={{ display: "flex", gap: 10, marginBottom: error ? 14 : 0, flexWrap: "wrap" }}>
                <input type="text"
                  placeholder="https://youtube.com/watch?v=..."
                  value={url} onChange={e => setUrl(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && !loading && handleProcess()}
                  style={{ flex: 1, minWidth: 0, background: T.inputBg, border: `1px solid ${T.border}`, color: T.text, padding: "13px 16px", borderRadius: 11, fontSize: 14, fontFamily: "'Sora',sans-serif", outline: "none", transition: "border 0.2s" }}
                  onFocus={e => e.target.style.borderColor = "#7c3aed"}
                  onBlur={e => e.target.style.borderColor = T.border}
                />
                <button className="btn-primary" onClick={handleProcess} disabled={loading || !url.trim()}>
                  {loading ? "Processing..." : "Analyze →"}
                </button>
              </div>
              {error && (
                <div style={{ background: T.errorBg, border: `1px solid ${T.errorBdr}`, borderRadius: 9, padding: "11px 14px", color: T.errorTxt, fontSize: 13, textAlign: "left", marginTop: 4 }}>⚠️ {error}</div>
              )}
              {loading && (
                <div style={{ marginTop: 20 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontSize: 13, color: T.textSub, fontWeight: 600 }}>
                      {loadingPct < 15 ? "Fetching transcript…" : loadingPct === 100 ? "Done!" : "Generating content…"}
                    </span>
                    <span style={{ fontSize: 13, color: "#a78bfa", fontFamily: "'JetBrains Mono',monospace", fontWeight: 700 }}>{loadingPct}%</span>
                  </div>
                  <div style={{ height: 6, background: dark ? "rgba(255,255,255,0.08)" : "rgba(109,40,217,0.1)", borderRadius: 100, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${loadingPct}%`, background: "linear-gradient(90deg,#7c3aed,#a855f7)", borderRadius: 100, transition: "width 0.3s ease" }} />
                  </div>
                </div>
              )}
            </div>
            <p style={{ marginTop: 16, color: T.textFaint, fontSize: 12 }}>Works with any YouTube video that has captions enabled</p>
          </div>
        )}

        {/* ── RESULT SCREEN ── */}
        {step === "result" && (
          <div>
            <div className="video-bar" style={{ marginBottom: 28, display: "flex", gap: 14, alignItems: "center", background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 14, padding: 14 }}>
              <img className="video-thumb" src={`https://img.youtube.com/vi/${videoId}/mqdefault.jpg`} alt="thumb" style={{ width: 110, height: 62, borderRadius: 9, objectFit: "cover", flexShrink: 0 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 11, color: T.textSub, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 600 }}>Analyzed video</div>
                {videoTitle && <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 5, lineHeight: 1.4, wordBreak: "break-word" }}>{videoTitle}</div>}
                <div style={{ fontSize: 12, color: "#a78bfa", wordBreak: "break-all", marginBottom: 4 }}>youtube.com/watch?v={videoId}</div>
                <div style={{ fontSize: 12, color: T.vidMeta }}>~{Math.ceil(transcript.split(" ").length / 150)} min read · {transcript.split(" ").length} words</div>
              </div>
              {/* Overall progress while streaming */}
              {!allDone && (
                <div style={{ flexShrink: 0, textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: T.textSub, marginBottom: 5 }}>
                    {Object.values(tabReady).filter(Boolean).length}/4 ready
                  </div>
                  <div style={{ width: 80, height: 4, background: dark ? "rgba(255,255,255,0.08)" : "rgba(109,40,217,0.1)", borderRadius: 100, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${(Object.values(tabReady).filter(Boolean).length / 4) * 100}%`, background: "linear-gradient(90deg,#7c3aed,#a855f7)", borderRadius: 100, transition: "width 0.4s ease" }} />
                  </div>
                </div>
              )}
            </div>

            <button className="mobile-new-video" onClick={resetAll} style={{ width: "100%", marginBottom: 14, alignItems: "center", justifyContent: "center", gap: 6, background: T.btnGhost.bg, border: `1px solid ${T.btnGhost.border}`, color: T.btnGhost.color, padding: "10px 14px", borderRadius: 10, fontFamily: "'Sora',sans-serif", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>
              ← New Video
            </button>

            {/* ── TABS with ready dots ── */}
            <div className="tabs-row" style={{ display: "flex", gap: 5, marginBottom: 24, background: T.tabBarBg, border: `1px solid ${T.border}`, borderRadius: 11, padding: 5, width: "fit-content", maxWidth: "100%", overflowX: "auto" }}>
              {TABS.map(tb => {
                const resultKey = RESULT_KEY_FOR_TAB[tb];
                const isReady = tabReady[resultKey];
                return (
                  <button key={tb} className={"tab-btn" + (activeTab === tb ? " active" : "")}
                    onClick={() => setActiveTab(tb)} style={{ color: activeTab === tb ? "#fff" : T.textSub }}>
                    {TAB_READY_LABELS[tb]}{tb}
                    {/* Green dot when ready but not the active tab */}
                    {isReady && activeTab !== tb && <span className="tab-ready-dot" />}
                    {/* Spinner dot when still loading */}
                    {!isReady && loading && activeTab !== tb && (
                      <span style={{ position: "absolute", top: 5, right: 5, width: 6, height: 6, borderRadius: "50%", border: "1.5px solid #7c3aed", borderTopColor: "transparent", animation: "spin 0.8s linear infinite", display: "inline-block" }} />
                    )}
                  </button>
                );
              })}
            </div>

            {/* ── SUMMARY TAB ── */}
            {activeTab === "Summary" && (() => {
              const sd = results.Summary;
              if (!sd) return <SkeletonLoader dark={dark} label="Summary" />;
              if (!sd.sections) return (
                <div className="card-pad" style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 28 }}>
                  <p style={{ color: T.textSub, fontSize: 14 }}>Summary unavailable. Try re-analyzing.</p>
                </div>
              );
              return (
                <div className="tab-result-enter">
                  <div style={{ background: dark ? "rgba(124,58,237,0.08)" : "rgba(124,58,237,0.05)", border: `1px solid ${dark?"rgba(124,58,237,0.22)":"rgba(124,58,237,0.18)"}`, borderRadius: 14, padding: "18px 22px", marginBottom: 28, display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <span style={{ fontSize: 20, lineHeight: 1, flexShrink: 0, marginTop: 2 }}>🎬</span>
                    <p style={{ fontSize: 15, lineHeight: 1.8, color: T.proseText, margin: 0 }}>{sd.intro}</p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: T.textSub }}>Topics Covered</div>
                    <div style={{ flex: 1, height: 1, background: T.border }} />
                    <div style={{ fontSize: 11, color: T.textFaint }}>{(sd.sections || []).length} sections</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 32 }}>
                    {(sd.sections || []).map((sec, i) => (
                      <div key={i} style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 12, padding: "16px 20px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                          <div style={{ width: 24, height: 24, borderRadius: 7, background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.25)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 11, fontWeight: 700, color: "#a78bfa", fontFamily: "'JetBrains Mono',monospace" }}>{i+1}</div>
                          <div style={{ fontWeight: 700, fontSize: 14, color: T.text }}>{sec.title}</div>
                        </div>
                        <p style={{ fontSize: 13, color: T.textSub, lineHeight: 1.7, margin: "0 0 10px 34px" }}>{sec.summary}</p>
                        {(sec.keyPoints || []).length > 0 && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginLeft: 34 }}>
                            {sec.keyPoints.map((pt, j) => (
                              <div key={j} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: T.proseLi, lineHeight: 1.6 }}>
                                <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#8b5cf6", flexShrink: 0, marginTop: 5 }} />{pt}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {(sd.keyTakeaways || []).length > 0 && (
                    <div style={{ marginBottom: 24 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: T.textSub }}>Key Takeaways</div>
                        <div style={{ flex: 1, height: 1, background: T.border }} />
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 9 }}>
                        {sd.keyTakeaways.map((tk, i) => (
                          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 10, padding: "11px 13px" }}>
                            <div style={{ width: 20, height: 20, borderRadius: 6, background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.25)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 10, fontWeight: 700, color: "#a78bfa", fontFamily: "'JetBrains Mono',monospace" }}>{i+1}</div>
                            <span style={{ fontSize: 13, color: T.proseText, lineHeight: 1.6 }}>{tk}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {sd.conclusion && (
                    <div style={{ background: dark ? "rgba(34,197,94,0.06)" : "rgba(22,163,74,0.05)", border: `1px solid ${dark?"rgba(34,197,94,0.18)":"rgba(22,163,74,0.2)"}`, borderRadius: 12, padding: "15px 18px", display: "flex", gap: 11, alignItems: "flex-start" }}>
                      <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>💡</span>
                      <p style={{ fontSize: 14, color: T.proseText, lineHeight: 1.75, margin: 0 }}>{sd.conclusion}</p>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── NOTES TAB ── */}
            {activeTab === "Notes" && (
              !results.Notes
                ? <SkeletonLoader dark={dark} label="Notes" />
                : <div className="tab-result-enter card-pad" style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 14, padding: "28px 32px", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}>
                    <NotesTab notes={results.Notes} videoTitle={videoTitle} dark={dark} T={T} />
                  </div>
            )}

            {/* ── QUIZ TAB ── */}
            {activeTab === "Quiz" && (
              !results.Quiz
                ? <SkeletonLoader dark={dark} label="Quiz" />
                : (
                  <div className="tab-result-enter">
                    {quizState.submitted && (
                      <div className="score-bar" style={{ background: score >= 8 ? (dark ? "rgba(34,197,94,0.08)" : "rgba(22,163,74,0.07)") : score >= 5 ? (dark ? "rgba(251,191,36,0.08)" : "rgba(202,138,4,0.07)") : (dark ? "rgba(239,68,68,0.08)" : "rgba(220,38,38,0.07)"), border: "1px solid " + (score >= 8 ? "#22c55e44" : score >= 5 ? "#fbbf2444" : "#ef444444"), borderRadius: 14, padding: "18px 22px", marginBottom: 22, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 19, marginBottom: 3, color: T.text }}>{score >= 8 ? "🎉 Excellent!" : score >= 5 ? "👍 Good Try!" : "📚 Keep Studying!"}</div>
                          <div style={{ color: T.scoreSub, fontSize: 14 }}>Scored {score}/{results.Quiz.length} · {Math.round((score/results.Quiz.length)*100)}% correct</div>
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button onClick={resetQuiz} style={{ background: T.btnGhost.bg, border: `1px solid ${T.btnGhost.border}`, color: T.btnGhost.color, padding: "8px 16px", borderRadius: 9, fontFamily: "'Sora',sans-serif", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>🔁 Retry</button>
                          <button className="btn-download" onClick={() => downloadQuizPdf(results.Quiz, score, quizState.submitted)}>⬇ PDF</button>
                        </div>
                      </div>
                    )}
                    {results.Quiz.map((q, qi) => (
                      <div key={qi} style={{ background: T.bgCard, border: `1px solid ${T.border}`, borderRadius: 14, padding: "22px", marginBottom: 16 }}>
                        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 16, lineHeight: 1.6, color: T.quizQ }}>
                          <span style={{ color: "#7c3aed", marginRight: 8, fontFamily: "JetBrains Mono,monospace", fontSize: 12 }}>Q{qi+1}</span>
                          {q.q}
                        </div>
                        {q.options.map((opt, ai) => {
                          let cls = "quiz-opt";
                          if (quizState.answers[qi] === ai) cls += " selected";
                          if (quizState.submitted && ai === q.answer) cls += " correct";
                          else if (quizState.submitted && quizState.answers[qi] === ai) cls += " wrong";
                          return (
                            <button key={ai} className={cls} onClick={() => handleQuizAnswer(qi, ai)} disabled={quizState.submitted}
                              style={{ background: T.quizOptBg, border: `1px solid ${T.quizOptBdr}`, color: T.textSub }}>
                              <span className="opt-letter">{["A","B","C","D"][ai]}</span>
                              <span>{opt}</span>
                            </button>
                          );
                        })}
                        {quizState.submitted && q.explanation && (
                          <div className="explanation-box" style={{ background: dark ? "rgba(124,58,237,0.07)" : "rgba(124,58,237,0.06)", border: `1px solid ${dark ? "rgba(124,58,237,0.2)" : "rgba(124,58,237,0.18)"}`, color: T.proseH3 }}>
                            💡 <strong>Explanation:</strong> {q.explanation}
                          </div>
                        )}
                      </div>
                    ))}
                    {!quizState.submitted && (
                      <button className="btn-primary" style={{ width: "100%", marginTop: 6 }} onClick={submitQuiz}
                        disabled={Object.keys(quizState.answers).length < results.Quiz.length}>
                        Submit Quiz ({Object.keys(quizState.answers).length}/{results.Quiz.length} answered)
                      </button>
                    )}
                  </div>
                )
            )}

            {/* ── MIND MAP TAB ── */}
            {activeTab === "Mind Map" && (
              !results.MindMap
                ? <SkeletonLoader dark={dark} label="Mind Map" />
                : (
                  <div className="tab-result-enter card-pad" style={{ background: T.bgSurface, border: `1px solid ${T.border}`, borderRadius: 14, padding: 28 }}>
                    <div className="result-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22, gap: 12, flexWrap: "wrap" }}>
                      <h2 style={{ fontSize: 20, fontWeight: 700, color: T.text }}>🗺️ Mind Map</h2>
                      <span style={{ fontSize: 12, color: T.textSub, background: T.wordsBg, padding: "3px 11px", borderRadius: 20 }}>
                        {results.MindMap ? `${(results.MindMap.branches || []).length} branches · ${(results.MindMap.branches || []).reduce((a, b) => a + (b.children || []).length, 0)} subtopics` : ""}
                      </span>
                    </div>
                    <HorizontalMindMap data={results.MindMap} dark={dark} />
                  </div>
                )
            )}
          </div>
        )}
      </div>
    </div>
  );
}