// ── PWA ───────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ── STATE ─────────────────────────────────────────────────
let currentSession     = null;
let currentAnalysisId  = null;
let lastResult         = null;
let compareIds         = [];
let videoFile          = null;
let videoFrameBase64   = null;
let authMode           = 'login';

// ── HELPERS ──────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (id === 'historyScreen') loadHistory();
  if (id === 'progressScreen') loadProgress();
}

function scoreColor(s) {
  if (s >= 8.5) return '#2dd4bf';
  if (s >= 7)   return '#4ade80';
  if (s >= 5)   return '#fbbf24';
  return '#fb7185';
}

function gradeLabel(s) {
  if (s >= 8.5) return ['Excellent', 'grade-excellent'];
  if (s >= 7)   return ['Good',      'grade-good'];
  if (s >= 5)   return ['Fair',      'grade-fair'];
  return ['Needs Work', 'grade-needs-work'];
}

function fileSize(bytes) {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── AUTH ──────────────────────────────────────────────────
function switchAuthTab(mode) {
  authMode = mode;
  document.querySelectorAll('.auth-tab').forEach((t, i) => {
    t.classList.toggle('active', (mode === 'login' && i === 0) || (mode === 'signup' && i === 1));
  });
  document.querySelector('.btn-auth-label').textContent = mode === 'login' ? 'Log in' : 'Create account';
  document.getElementById('authError').textContent = '';
}

async function handleAuth() {
  const email    = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const btn      = document.getElementById('authBtn');
  const errEl    = document.getElementById('authError');

  errEl.textContent = '';
  if (!email || !password) { errEl.textContent = 'Please enter your email and password.'; return; }

  btn.classList.add('loading');
  btn.disabled = true;

  try {
    if (authMode === 'signup') {
      await signUp(email, password);
      errEl.style.color = '#4ade80';
      errEl.textContent = 'Account created! Check your email to confirm, then log in.';
    } else {
      await signIn(email, password);
    }
  } catch (err) {
    errEl.style.color = '';
    errEl.textContent = err.message || 'Something went wrong. Please try again.';
  }

  btn.classList.remove('loading');
  btn.disabled = false;
}

async function handleSignOut() {
  await signOut();
}

// Listen for auth state
onAuthChange(session => {
  currentSession = session;
  if (session) {
    showScreen('uploadScreen');
  } else {
    showScreen('authScreen');
  }
});

// ── FILE HANDLING ─────────────────────────────────────────
const dropZone    = document.getElementById('dropZone');
const fileInput   = document.getElementById('fileInput');
const previewWrap = document.getElementById('videoPreviewWrap');
const videoEl     = document.getElementById('videoPreview');
const filenameEl  = document.getElementById('videoFilename');
const filesizeEl  = document.getElementById('videoFilesize');

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const f = e.dataTransfer.files[0];
  if (f && f.type.startsWith('video/')) loadFile(f);
  else showError('Please upload a video file.');
});
fileInput.addEventListener('change', () => { if (fileInput.files[0]) loadFile(fileInput.files[0]); });

function extractFrame() {
  return new Promise((resolve, reject) => {
    videoEl.currentTime = Math.min(3, (videoEl.duration || 10) * 0.1);
    const onSeeked = () => {
      videoEl.removeEventListener('seeked', onSeeked);
      try {
        const canvas = document.createElement('canvas');
        const scale  = Math.min(1, 800 / (videoEl.videoWidth || 800));
        canvas.width  = Math.round((videoEl.videoWidth  || 640) * scale);
        canvas.height = Math.round((videoEl.videoHeight || 360) * scale);
        canvas.getContext('2d').drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.8).split(',')[1]);
      } catch (e) { reject(e); }
    };
    videoEl.addEventListener('seeked', onSeeked);
    setTimeout(() => { videoEl.removeEventListener('seeked', onSeeked); reject(new Error('Timeout')); }, 8000);
  });
}

function loadFile(file) {
  videoFile = file; videoFrameBase64 = null;
  videoEl.src = URL.createObjectURL(file);
  filenameEl.textContent = file.name;
  filesizeEl.textContent = fileSize(file.size);
  dropZone.style.display = 'none';
  previewWrap.classList.add('visible');
  hideError();
  videoEl.onloadedmetadata = () => extractFrame().then(b64 => { videoFrameBase64 = b64; }).catch(() => {});
}

function changeVideo() {
  videoFile = null; videoFrameBase64 = null;
  videoEl.src = ''; videoEl.onloadedmetadata = null;
  dropZone.style.display = '';
  previewWrap.classList.remove('visible');
  fileInput.value = '';
}

function showError(msg) {
  const el = document.getElementById('errorMsg');
  el.textContent = msg; el.classList.add('visible');
}
function hideError() { document.getElementById('errorMsg').classList.remove('visible'); }

// ── LOADING ───────────────────────────────────────────────
const STEPS = ['step1','step2','step3','step4'];
function setLoadingStep(idx) {
  STEPS.forEach((id, i) => {
    const el = document.getElementById(id); if (!el) return;
    el.classList.remove('done','active');
    if (i < idx) el.classList.add('done');
    else if (i === idx) el.classList.add('active');
  });
}

// ── ANALYZE ───────────────────────────────────────────────
async function analyze() {
  hideError();
  if (!videoFile) { showError('Please upload a video first.'); return; }

  const btn = document.getElementById('analyzeBtn');
  btn.classList.add('loading'); btn.disabled = true;
  showScreen('loadingScreen'); setLoadingStep(0);

  if (!videoFrameBase64) {
    try { videoFrameBase64 = await extractFrame(); }
    catch (err) {
      showScreen('uploadScreen');
      showError('Could not read a frame from the video. Try a different file.');
      btn.classList.remove('loading'); btn.disabled = false; return;
    }
  }

  await delay(400); setLoadingStep(1);
  await delay(600); setLoadingStep(2);

  const context = document.getElementById('contextInput').value.trim();
  const contextNote = context ? ` Context: ${context}.` : '';

  const systemPrompt = `You are an expert public speaking coach with 20 years of experience who has helped thousands of people find their voice. You genuinely love seeing people grow. Your feedback style is like a trusted mentor who celebrates every win, no matter how small, and frames every opportunity as exciting - never as a flaw.

Analyze the still frame from a presentation video. Focus ONLY on delivery - never on content or topic.

Evaluate these 6 dimensions:
1. Body Language - posture, gestures, movement, physical presence
2. Eye Contact - camera or audience engagement, connection
3. Voice Modulation - pitch variation, emphasis, avoiding monotone
4. Pace & Pausing - speed, strategic pauses, rushing vs deliberate
5. Vocal Projection - volume confidence, clarity, breath support
6. Presence & Energy - command of the room, confidence, engagement

Tone rules:
- Open every piece of feedback with genuine praise first.
- Frame every improvement as unlocking more of something they already have.
- Use energizing language: "imagine how powerful it will be when...", "you are so close to...", "this one shift will change everything".
- The "improve" field must start with "To take this even further..." or "Your next level is...".
- Drills should feel like exciting challenges, not homework.
- Never use: wrong, bad, lack, missing, weak, poor, problem, issue, mistake, unfortunately.

Return ONLY valid JSON - no markdown, no backticks:
{
  "overall_score": 7.5,
  "overall_headline": "You showed up and that courage already sets you apart",
  "overall_summary": "2-3 sentences. Start with specific genuine praise. Frame growth as exciting. End with forward-looking potential.",
  "priority_focus": { "category": "Voice Modulation", "title": "Your voice has untapped power waiting to be released", "description": "2 sentences. Frame as exciting opportunity. Make them want to work on it." },
  "encouragement": "1 deeply specific sentence that makes the speaker feel genuinely seen.",
  "categories": [
    { "name": "Body Language",     "score": 7.0, "strength": "Specific genuine praise.", "improve": "To take this even further, [concrete next step].", "drill": "An energizing 5-10 min exercise." },
    { "name": "Eye Contact",       "score": 7.0, "strength": "...", "improve": "...", "drill": "..." },
    { "name": "Voice Modulation",  "score": 7.0, "strength": "...", "improve": "...", "drill": "..." },
    { "name": "Pace & Pausing",    "score": 7.0, "strength": "...", "improve": "...", "drill": "..." },
    { "name": "Vocal Projection",  "score": 7.0, "strength": "...", "improve": "...", "drill": "..." },
    { "name": "Presence & Energy", "score": 7.0, "strength": "...", "improve": "...", "drill": "..." }
  ]
}`;

  const userMsg = `Analyze the public speaking delivery of the person in this frame captured from their presentation video.${contextNote} Evaluate body language, eye contact, presence, and infer vocal delivery from posture and expression. Give feedback as if you watched the full speech.`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer YOUR_OPENROUTER_KEY_HERE',
        'HTTP-Referer': window.location.href,
        'X-Title': 'SpeakCoach'
      },
      body: JSON.stringify({
        model: 'openrouter/auto',
        max_tokens: 1500,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: [
            { type: 'text', text: userMsg },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${videoFrameBase64}` } }
          ]}
        ]
      })
    });

    setLoadingStep(3); await delay(400);

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`API error ${response.status}: ${body}`);
    }

    const data = await response.json();
    if (data.error) throw new Error(data.error.message || 'Unknown API error');

    const raw = (data.choices?.[0]?.message?.content || '').trim();
    if (!raw) throw new Error('Empty response');

    let parsed;
    try {
      parsed = JSON.parse(raw.replace(/^```json\s*/i,'').replace(/```\s*$/i,'').trim());
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
      else throw new Error('Response was not valid JSON');
    }

    lastResult = parsed;

    // Save to Supabase
    const saved = await saveAnalysis(parsed, context);
    if (saved) currentAnalysisId = saved.id;

    // Streak
    const streak = await fetchDrillStreak();
    if (streak > 0) {
      document.getElementById('streakBanner').style.display = 'flex';
      document.getElementById('streakText').textContent = `${streak} day drill streak - keep it up!`;
    }

    renderResults(parsed, currentAnalysisId);
    showScreen('resultsScreen');

  } catch (err) {
    console.error('Analyze failed:', err);
    showScreen('uploadScreen');
    showError('Analysis failed: ' + err.message);
  }

  btn.classList.remove('loading'); btn.disabled = false;
}

// ── SVG ICONS ─────────────────────────────────────────────
const CAT_ICONS = {
  'Body Language':    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="2"/><path d="M12 7v8"/><path d="M8 11h8"/><path d="M9 19l3-4 3 4"/></svg>`,
  'Eye Contact':      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
  'Voice Modulation': `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
  'Pace & Pausing':   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  'Vocal Projection': `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`,
  'Presence & Energy':`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
};

const TAG_ICONS = {
  strength: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  improve:  `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`,
  drill:    `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/></svg>`,
};

function getCatIcon(name) {
  return CAT_ICONS[name] || `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>`;
}

// ── RENDER RESULTS ────────────────────────────────────────
function renderResults(data, analysisId) {
  const overallScore = Number(data.overall_score) || 7;
  const overallNum   = document.getElementById('overallNum');
  const overallFill  = document.getElementById('overallFill');

  overallNum.textContent = overallScore.toFixed(1);
  overallNum.style.color = scoreColor(overallScore);
  setTimeout(() => {
    overallFill.style.strokeDashoffset = 314 - (overallScore / 10) * 314;
    overallFill.style.stroke = scoreColor(overallScore);
  }, 200);

  document.getElementById('overallHeadline').textContent   = data.overall_headline || 'Analysis Complete';
  document.getElementById('overallSummary').textContent    = data.overall_summary  || '';
  document.getElementById('priorityCat').textContent       = data.priority_focus?.category    || '';
  document.getElementById('priorityTitle').textContent     = data.priority_focus?.title       || 'Key Focus Area';
  document.getElementById('priorityText').textContent      = data.priority_focus?.description || '';
  document.getElementById('encouragementText').textContent = data.encouragement || 'Keep practicing.';

  const grid = document.getElementById('categoriesGrid');
  grid.innerHTML = '';

  (data.categories || []).forEach((cat, i) => {
    const score = Number(cat.score) || 7;
    const [grade, gradeClass] = gradeLabel(score);
    const color = scoreColor(score);
    const circ  = 132;
    const off   = circ - (score / 10) * circ;

    const card = document.createElement('div');
    card.className = 'category-card';
    card.style.animationDelay = `${0.1 + i * 0.07}s`;

    card.innerHTML = `
      <div class="card-top">
        <div class="cat-ring-wrap">
          <svg class="cat-svg" width="52" height="52" viewBox="0 0 52 52">
            <circle class="cat-bg" cx="26" cy="26" r="21"/>
            <circle class="cat-fill" cx="26" cy="26" r="21" style="stroke-dasharray:${circ};stroke-dashoffset:${circ}"/>
          </svg>
          <div class="cat-score" style="color:${color}">${score.toFixed(1)}</div>
        </div>
        <div class="cat-meta">
          <div class="cat-icon-box">${getCatIcon(cat.name)}</div>
          <div class="cat-name">${cat.name}</div>
          <span class="cat-grade ${gradeClass}">${grade}</span>
        </div>
      </div>
      <div class="card-divider"></div>
      <div class="card-body">
        <div class="feedback-block">
          <div class="feedback-tag tag-strength"><span class="tag-icon">${TAG_ICONS.strength}</span> Strength</div>
          <div class="feedback-text">${cat.strength || ''}</div>
        </div>
        <div class="feedback-block">
          <div class="feedback-tag tag-improve"><span class="tag-icon">${TAG_ICONS.improve}</span> Improve</div>
          <div class="feedback-text">${cat.improve || ''}</div>
        </div>
        <div class="feedback-block drill-block" data-category="${cat.name}" data-analysis="${analysisId || ''}">
          <div class="drill-box">
            <div class="drill-box-top">
              <div class="feedback-tag tag-drill"><span class="tag-icon">${TAG_ICONS.drill}</span> This Week's Drill</div>
              <label class="drill-check-wrap" title="Mark as completed">
                <input type="checkbox" class="drill-checkbox" onchange="toggleDrill(this, '${cat.name}', '${analysisId || ''}')">
                <span class="drill-check-label">Done</span>
              </label>
            </div>
            <div class="feedback-text">${cat.drill || ''}</div>
          </div>
        </div>
      </div>`;

    grid.appendChild(card);

    requestAnimationFrame(() => requestAnimationFrame(() => {
      const fill = card.querySelector('.cat-fill');
      setTimeout(() => {
        fill.style.transition = 'stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1), stroke 0.3s';
        fill.style.strokeDashoffset = off;
        fill.style.stroke = color;
      }, 300 + i * 80);
    }));
  });

  // Load existing drill completions
  if (analysisId) {
    fetchCompletedDrills(analysisId).then(drills => {
      drills.forEach(d => {
        const block = grid.querySelector(`.drill-block[data-category="${d.category}"]`);
        if (block) {
          const cb = block.querySelector('.drill-checkbox');
          if (cb) { cb.checked = true; block.classList.add('drill-done'); }
        }
      });
    });
  }
}

// ── DRILLS ────────────────────────────────────────────────
async function toggleDrill(checkbox, category, analysisId) {
  if (!analysisId) return;
  const block = checkbox.closest('.drill-block');
  if (checkbox.checked) {
    await completeDrill(analysisId, category);
    block.classList.add('drill-done');
    const streak = await fetchDrillStreak();
    if (streak > 0) {
      document.getElementById('streakBanner').style.display = 'flex';
      document.getElementById('streakText').textContent = `${streak} day drill streak - keep it up!`;
    }
  } else {
    await uncompleteDrill(analysisId, category);
    block.classList.remove('drill-done');
  }
}

// ── HISTORY ───────────────────────────────────────────────
async function loadHistory() {
  const list = document.getElementById('historyList');
  list.innerHTML = '<div class="history-empty">Loading...</div>';
  compareIds = [];
  document.getElementById('compareBar').style.display = 'none';

  const analyses = await fetchAnalyses();

  if (!analyses.length) {
    list.innerHTML = '<div class="history-empty">No sessions yet. Analyze your first video to get started.</div>';
    return;
  }

  list.innerHTML = '';
  analyses.forEach(a => {
    const color = scoreColor(a.overall_score);
    const row = document.createElement('div');
    row.className = 'history-row';
    row.dataset.id = a.id;
    row.innerHTML = `
      <label class="history-check-wrap">
        <input type="checkbox" class="history-checkbox" onchange="toggleCompare('${a.id}', this)">
      </label>
      <div class="history-score-ring">
        <svg width="44" height="44" viewBox="0 0 44 44" style="transform:rotate(-90deg)">
          <circle cx="22" cy="22" r="17" fill="none" stroke="var(--border2)" stroke-width="4"/>
          <circle cx="22" cy="22" r="17" fill="none" stroke="${color}" stroke-width="4"
            stroke-dasharray="107" stroke-dashoffset="${107 - (a.overall_score / 10) * 107}"
            stroke-linecap="round"/>
        </svg>
        <div class="history-score-num" style="color:${color}">${Number(a.overall_score).toFixed(1)}</div>
      </div>
      <div class="history-info">
        <div class="history-headline">${a.overall_headline || 'Session'}</div>
        <div class="history-meta">${fmtDate(a.created_at)}${a.context ? ' · ' + a.context : ''}</div>
      </div>
      <button class="btn-history-view" onclick="viewAnalysis('${a.id}', ${JSON.stringify(a).replace(/"/g, '&quot;')})">View →</button>
    `;
    list.appendChild(row);
  });
}

function toggleCompare(id, checkbox) {
  if (checkbox.checked) {
    if (compareIds.length >= 2) { checkbox.checked = false; return; }
    compareIds.push(id);
  } else {
    compareIds = compareIds.filter(i => i !== id);
  }
  const bar = document.getElementById('compareBar');
  bar.style.display = compareIds.length === 2 ? 'flex' : 'none';
}

function clearComparison() {
  compareIds = [];
  document.querySelectorAll('.history-checkbox').forEach(cb => cb.checked = false);
  document.getElementById('compareBar').style.display = 'none';
}

function viewAnalysis(id, data) {
  currentAnalysisId = id;
  lastResult = data;
  renderResults(data, id);
  showScreen('resultsScreen');
}

// ── COMPARISON ────────────────────────────────────────────
async function openComparison() {
  if (compareIds.length !== 2) return;
  const [a, b] = await Promise.all([fetchAnalysis(compareIds[0]), fetchAnalysis(compareIds[1])]);
  if (!a || !b) return;

  // Sort oldest first
  const [older, newer] = new Date(a.created_at) < new Date(b.created_at) ? [a, b] : [b, a];

  const grid = document.getElementById('comparisonGrid');
  grid.innerHTML = '';

  // Header row
  const header = document.createElement('div');
  header.className = 'compare-header';
  header.innerHTML = `
    <div class="compare-col-label"></div>
    <div class="compare-col-label">${fmtDate(older.created_at)}<br><small>${older.context || 'Session'}</small></div>
    <div class="compare-col-label">${fmtDate(newer.created_at)}<br><small>${newer.context || 'Session'}</small></div>
    <div class="compare-col-label">Change</div>
  `;
  grid.appendChild(header);

  // Overall row
  const overallDiff = (newer.overall_score - older.overall_score).toFixed(1);
  const overallRow = document.createElement('div');
  overallRow.className = 'compare-row compare-row-overall';
  overallRow.innerHTML = `
    <div class="compare-cat-name">Overall</div>
    <div class="compare-score" style="color:${scoreColor(older.overall_score)}">${Number(older.overall_score).toFixed(1)}</div>
    <div class="compare-score" style="color:${scoreColor(newer.overall_score)}">${Number(newer.overall_score).toFixed(1)}</div>
    <div class="compare-diff ${overallDiff >= 0 ? 'diff-up' : 'diff-down'}">${overallDiff >= 0 ? '+' : ''}${overallDiff}</div>
  `;
  grid.appendChild(overallRow);

  // Category rows
  const cats = older.categories || [];
  cats.forEach(oldCat => {
    const newCat = (newer.categories || []).find(c => c.name === oldCat.name) || oldCat;
    const diff = (Number(newCat.score) - Number(oldCat.score)).toFixed(1);
    const row = document.createElement('div');
    row.className = 'compare-row';
    row.innerHTML = `
      <div class="compare-cat-name">
        <span class="compare-cat-icon">${getCatIcon(oldCat.name)}</span>
        ${oldCat.name}
      </div>
      <div class="compare-score" style="color:${scoreColor(oldCat.score)}">${Number(oldCat.score).toFixed(1)}</div>
      <div class="compare-score" style="color:${scoreColor(newCat.score)}">${Number(newCat.score).toFixed(1)}</div>
      <div class="compare-diff ${diff >= 0 ? 'diff-up' : 'diff-down'}">${diff >= 0 ? '+' : ''}${diff}</div>
    `;
    grid.appendChild(row);
  });

  showScreen('comparisonScreen');
}

// ── PROGRESS ──────────────────────────────────────────────
async function loadProgress() {
  const grid = document.getElementById('progressGrid');
  grid.innerHTML = '<div class="history-empty">Loading...</div>';

  const analyses = await fetchAnalyses();

  if (analyses.length < 2) {
    grid.innerHTML = '<div class="history-empty">Analyze at least 2 videos to see your progress over time.</div>';
    return;
  }

  const sorted = [...analyses].reverse(); // oldest first
  const catNames = ['Body Language','Eye Contact','Voice Modulation','Pace & Pausing','Vocal Projection','Presence & Energy'];

  grid.innerHTML = '';

  // Overall chart first
  renderProgressChart(grid, 'Overall Score', sorted.map(a => ({
    date: fmtDate(a.created_at),
    score: Number(a.overall_score)
  })), '#e8622a');

  // Per-category charts
  catNames.forEach(name => {
    const points = sorted.map(a => {
      const cat = (a.categories || []).find(c => c.name === name);
      return { date: fmtDate(a.created_at), score: cat ? Number(cat.score) : null };
    }).filter(p => p.score !== null);

    if (points.length >= 2) {
      renderProgressChart(grid, name, points, scoreColor(points[points.length - 1].score));
    }
  });
}

function renderProgressChart(container, title, points, color) {
  const card = document.createElement('div');
  card.className = 'progress-card';

  const min = 0; const max = 10;
  const w = 320; const h = 100; const pad = 24;

  const xs = points.map((_, i) => pad + (i / (points.length - 1)) * (w - pad * 2));
  const ys = points.map(p => pad + (1 - (p.score - min) / (max - min)) * (h - pad * 2));

  const pathD = xs.map((x, i) => `${i === 0 ? 'M' : 'L'} ${x} ${ys[i]}`).join(' ');
  const areaD = `${pathD} L ${xs[xs.length-1]} ${h} L ${xs[0]} ${h} Z`;

  const latest = points[points.length - 1].score;
  const first  = points[0].score;
  const diff   = (latest - first).toFixed(1);
  const diffLabel = diff >= 0 ? `+${diff}` : `${diff}`;
  const diffClass = diff >= 0 ? 'diff-up' : 'diff-down';

  card.innerHTML = `
    <div class="progress-card-header">
      <div class="progress-cat-name">${title}</div>
      <div class="progress-latest" style="color:${color}">${latest.toFixed(1)} <span class="progress-diff ${diffClass}">${diffLabel}</span></div>
    </div>
    <svg class="progress-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="grad-${title.replace(/\s/g,'')}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.25"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${areaD}" fill="url(#grad-${title.replace(/\s/g,'')})" />
      <path d="${pathD}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${xs.map((x, i) => `<circle cx="${x}" cy="${ys[i]}" r="3.5" fill="${color}"/>`).join('')}
    </svg>
    <div class="progress-dates">
      <span>${points[0].date}</span>
      <span>${points[points.length-1].date}</span>
    </div>
  `;
  container.appendChild(card);
}

// ── NAV ───────────────────────────────────────────────────
function goHome() {
  showScreen('uploadScreen');
  changeVideo();
  document.getElementById('contextInput').value = '';
  currentAnalysisId = null;
  lastResult = null;
}
