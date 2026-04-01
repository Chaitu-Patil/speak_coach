// ── PWA REGISTRATION ─────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ── HELPERS ──────────────────────────────────────────────
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function scoreColor(s) {
  if (s >= 8.5) return '#2dd4bf';
  if (s >= 7)   return '#4ade80';
  if (s >= 5)   return '#fbbf24';
  return '#fb7185';
}

function gradeLabel(s) {
  if (s >= 8.5) return ['Excellent', 'grade-excellent'];
  if (s >= 7)   return ['Good', 'grade-good'];
  if (s >= 5)   return ['Fair', 'grade-fair'];
  return ['Needs Work', 'grade-needs-work'];
}

function fileSize(bytes) {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function animateRing(el, score, max, circumference, delay = 0) {
  setTimeout(() => {
    const offset = circumference - (score / max) * circumference;
    el.style.strokeDashoffset = offset;
    el.style.stroke = scoreColor(score);
  }, delay);
}

// ── FILE HANDLING ─────────────────────────────────────────
let videoFile = null;
let videoBase64 = null;

const dropZone   = document.getElementById('dropZone');
const fileInput  = document.getElementById('fileInput');
const previewWrap = document.getElementById('videoPreviewWrap');
const videoEl    = document.getElementById('videoPreview');
const filenameEl = document.getElementById('videoFilename');
const filesizeEl = document.getElementById('videoFilesize');

dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const f = e.dataTransfer.files[0];
  if (f && f.type.startsWith('video/')) loadFile(f);
});

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) loadFile(fileInput.files[0]);
});

function loadFile(file) {
  videoFile = file;
  const url = URL.createObjectURL(file);
  videoEl.src = url;
  filenameEl.textContent = file.name;
  filesizeEl.textContent = fileSize(file.size);
  dropZone.style.display = 'none';
  previewWrap.classList.add('visible');
  hideError();

  // Read as base64
  const reader = new FileReader();
  reader.onload = e => {
    const dataUrl = e.target.result;
    videoBase64 = dataUrl.split(',')[1];
  };
  reader.readAsDataURL(file);
}

function changeVideo() {
  videoFile = null;
  videoBase64 = null;
  videoEl.src = '';
  dropZone.style.display = '';
  previewWrap.classList.remove('visible');
  fileInput.value = '';
}

// ── ERROR ─────────────────────────────────────────────────
function showError(msg) {
  const el = document.getElementById('errorMsg');
  el.textContent = msg;
  el.classList.add('visible');
}
function hideError() {
  document.getElementById('errorMsg').classList.remove('visible');
}

// ── LOADING STEPS ─────────────────────────────────────────
const STEPS = [
  { id: 'step1', icon: '📤', text: 'Uploading your video...' },
  { id: 'step2', icon: '👁️', text: 'Analyzing body language & eye contact...' },
  { id: 'step3', icon: '🎙️', text: 'Evaluating voice modulation & projection...' },
  { id: 'step4', icon: '✨', text: 'Generating structured feedback...' },
];

function setLoadingStep(activeIdx) {
  STEPS.forEach((s, i) => {
    const el = document.getElementById(s.id);
    el.classList.remove('done', 'active');
    if (i < activeIdx) el.classList.add('done');
    else if (i === activeIdx) el.classList.add('active');
  });
}

// ── ANALYZE ───────────────────────────────────────────────
async function analyze() {
  hideError();

  if (!videoFile || !videoBase64) {
    showError('Please upload a video first.');
    return;
  }

  const context = document.getElementById('contextInput').value.trim();
  const btn = document.getElementById('analyzeBtn');
  btn.classList.add('loading');
  btn.disabled = true;

  show('loadingScreen');
  setLoadingStep(0);

  await delay(600);
  setLoadingStep(1);

  const systemPrompt = `You are an expert public speaking coach with 20 years of experience coaching executives, students, and presenters. Your role is to analyze a video of someone speaking and provide warm, constructive, highly specific feedback focused ONLY on delivery - NOT on the content of what they are saying.

You evaluate these 6 dimensions of presentation delivery:
1. Body Language - posture, gestures, movement, physical presence
2. Eye Contact - engagement with camera or audience, scanning patterns, connection
3. Voice Modulation - pitch variation, avoiding monotone, using emphasis effectively
4. Pace & Pausing - speed of delivery, strategic pauses, rushing vs deliberate pacing
5. Vocal Projection - volume confidence, clarity, breath support, trailing off
6. Presence & Energy - overall command of the room, confidence, engagement level

Return ONLY a valid JSON object with this exact structure:
{
  "overall_score": <number 1-10, one decimal place>,
  "overall_headline": "<an encouraging, specific headline summarizing their performance>",
  "overall_summary": "<2-3 sentences. Warm, specific, honest. Start with a genuine strength, then name the biggest opportunity. Never generic.>",
  "priority_focus": {
    "category": "<which of the 6 categories needs most work>",
    "title": "<short title for the priority improvement>",
    "description": "<2 sentences on why this is the #1 thing to work on and what improvement would look like>"
  },
  "encouragement": "<1 sentence of genuine encouragement specific to something you noticed in their delivery>",
  "categories": [
    {
      "name": "Body Language",
      "icon": "🧍",
      "score": <1-10>,
      "strength": "<1 specific thing they did well - reference what you actually saw>",
      "improve": "<1 specific, actionable thing to improve - be concrete, not generic>",
      "drill": "<A specific practice exercise they can do this week to improve this skill>"
    },
    {
      "name": "Eye Contact",
      "icon": "👁️",
      "score": <1-10>,
      "strength": "<specific observation>",
      "improve": "<specific improvement>",
      "drill": "<specific drill>"
    },
    {
      "name": "Voice Modulation",
      "icon": "🎵",
      "score": <1-10>,
      "strength": "<specific observation>",
      "improve": "<specific improvement>",
      "drill": "<specific drill>"
    },
    {
      "name": "Pace & Pausing",
      "icon": "⏱️",
      "score": <1-10>,
      "strength": "<specific observation>",
      "improve": "<specific improvement>",
      "drill": "<specific drill>"
    },
    {
      "name": "Vocal Projection",
      "icon": "📢",
      "score": <1-10>,
      "strength": "<specific observation>",
      "improve": "<specific improvement>",
      "drill": "<specific drill>"
    },
    {
      "name": "Presence & Energy",
      "icon": "⚡",
      "score": <1-10>,
      "strength": "<specific observation>",
      "improve": "<specific improvement>",
      "drill": "<specific drill>"
    }
  ]
}

Critical rules:
- NEVER comment on the content, topic, or what they said - only HOW they said it
- Be warm and encouraging but genuinely honest - do not inflate scores
- Every observation must be specific to what you see in the video, not generic advice
- Drills must be concrete and actionable - something they can literally do in 5-10 minutes
- Return ONLY the JSON. No markdown. No backticks. No explanation.`;

  const userMsg = context
    ? `Please analyze the public speaking delivery in this video. Context about the presentation: ${context}`
    : `Please analyze the public speaking delivery in this video.`;

  await delay(800);
  setLoadingStep(2);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: videoFile.type === 'video/mp4' ? 'image/jpeg' : 'image/jpeg',
                data: videoBase64
              }
            },
            { type: 'text', text: userMsg }
          ]
        }]
      })
    });

    setLoadingStep(3);
    await delay(600);

    const data = await response.json();

    if (data.error) throw new Error(data.error.message || 'API error');

    const raw = data.content?.[0]?.text || '';
    let parsed;

    try {
      parsed = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
      else throw new Error('Could not parse response');
    }

    renderResults(parsed);
    show('resultsScreen');

  } catch (err) {
    console.error(err);
    show('uploadScreen');
    showError('Something went wrong analyzing your video. Please try again. Make sure your video is under 20MB.');
  }

  btn.classList.remove('loading');
  btn.disabled = false;
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── RENDER RESULTS ────────────────────────────────────────
function renderResults(data) {
  // Overall score ring
  const overallFill = document.getElementById('overallFill');
  const overallNum  = document.getElementById('overallNum');
  const overallScore = data.overall_score || 7;

  overallNum.textContent = overallScore.toFixed(1);
  overallNum.style.color = scoreColor(overallScore);

  setTimeout(() => {
    const offset = 314 - (overallScore / 10) * 314;
    overallFill.style.strokeDashoffset = offset;
    overallFill.style.stroke = scoreColor(overallScore);
  }, 200);

  // Headlines
  document.getElementById('overallHeadline').textContent = data.overall_headline || 'Analysis Complete';
  document.getElementById('overallSummary').textContent  = data.overall_summary  || '';

  // Priority focus
  document.getElementById('priorityCat').textContent   = data.priority_focus?.category || '';
  document.getElementById('priorityTitle').textContent = data.priority_focus?.title    || 'Key Focus Area';
  document.getElementById('priorityText').textContent  = data.priority_focus?.description || '';

  // Encouragement
  document.getElementById('encouragementText').textContent = data.encouragement || 'Keep practicing - every speech makes you better.';

  // Categories
  const grid = document.getElementById('categoriesGrid');
  grid.innerHTML = '';

  (data.categories || []).forEach((cat, i) => {
    const [grade, gradeClass] = gradeLabel(cat.score);
    const card = document.createElement('div');
    card.className = 'category-card';
    card.style.animationDelay = `${0.1 + i * 0.07}s`;

    const circumference = 132;
    const offset = circumference - (cat.score / 10) * circumference;
    const color = scoreColor(cat.score);

    card.innerHTML = `
      <div class="card-top">
        <div class="cat-ring-wrap">
          <svg class="cat-svg" width="52" height="52" viewBox="0 0 52 52">
            <circle class="cat-bg" cx="26" cy="26" r="21"/>
            <circle class="cat-fill" cx="26" cy="26" r="21"
              style="stroke-dasharray:${circumference};stroke-dashoffset:${circumference};--delay:${0.4 + i * 0.08}s"/>
          </svg>
          <div class="cat-score" style="color:${color}">${cat.score.toFixed(1)}</div>
        </div>
        <div class="cat-meta">
          <div class="cat-icon">${cat.icon || '📊'}</div>
          <div class="cat-name">${cat.name}</div>
          <span class="cat-grade ${gradeClass}">${grade}</span>
        </div>
      </div>
      <div class="card-divider"></div>
      <div class="card-body">
        <div class="feedback-block">
          <div class="feedback-tag tag-strength"><span class="tag-icon">✦</span> Strength</div>
          <div class="feedback-text">${cat.strength}</div>
        </div>
        <div class="feedback-block">
          <div class="feedback-tag tag-improve"><span class="tag-icon">↑</span> Improve</div>
          <div class="feedback-text">${cat.improve}</div>
        </div>
        <div class="feedback-block">
          <div class="drill-box">
            <div class="feedback-tag tag-drill" style="margin-bottom:0.3rem"><span class="tag-icon">🎯</span> This Week's Drill</div>
            <div class="feedback-text">${cat.drill}</div>
          </div>
        </div>
      </div>
    `;

    grid.appendChild(card);

    // Animate ring after DOM insert
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const fill = card.querySelector('.cat-fill');
        setTimeout(() => {
          fill.style.strokeDashoffset = offset;
          fill.style.stroke = color;
        }, 400 + i * 80);
      });
    });
  });
}

// ── NAV ───────────────────────────────────────────────────
function goHome() {
  show('uploadScreen');
  changeVideo();
  document.getElementById('contextInput').value = '';
}

// ── BOOT ─────────────────────────────────────────────────
show('uploadScreen');
