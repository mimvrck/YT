/* app.js — router + view rendering + CRUD wiring. Vanilla JS, no framework. */

const STATUSES = ['idea', 'analyzed', 'shortlisted', 'planned', 'scripted', 'published', 'rejected'];
const STATUS_LABEL = {
  idea: 'Idea', analyzed: 'Analyzed', shortlisted: 'Shortlisted', planned: 'Planned',
  scripted: 'Scripted', published: 'Published', rejected: 'Rejected',
};

const state = {
  route: 'dashboard',
  currentAnalysis: null, // in-progress topic analyzer result (with overrides)
  currentScriptAnalysis: null,
  editingVideoId: null,
  pendingAnalyzeIdea: null, // set by Discover's "Analyze" button, consumed once by Topic Analyzer
};

// ---------------------------------------------------------------------
// tiny DOM helpers
// ---------------------------------------------------------------------
function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function toast(msg, type = 'default') {
  const wrap = $('#toast-wrap');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  wrap.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 250);
  }, 3200);
}
function scoreColor(v) {
  if (v >= 70) return 'var(--positive)';
  if (v >= 45) return 'var(--warning)';
  return 'var(--negative)';
}
function bar(label, value, opts = {}) {
  const weightTxt = opts.weight ? `<span class="bar-weight">weight ${opts.weight}%</span>` : '';
  return `
    <div class="score-bar">
      <div class="score-bar-head">
        <span class="score-bar-label">${escapeHtml(label)}</span>
        ${weightTxt}
        <span class="score-bar-value" style="color:${scoreColor(value)}">${Math.round(value)}</span>
      </div>
      <div class="score-bar-track"><div class="score-bar-fill" style="width:${Math.max(2, value)}%;background:${scoreColor(value)}"></div></div>
    </div>`;
}
function stamp(status) {
  return `<span class="stamp stamp-${status}">${STATUS_LABEL[status] || status}</span>`;
}
function emptyState(message, sub = '') {
  return `<div class="empty-state">${Icon('film')}<p>${escapeHtml(message)}</p>${sub ? `<p class="empty-sub">${escapeHtml(sub)}</p>` : ''}</div>`;
}

// ---------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------
const VIEWS = {
  dashboard: { label: 'Dashboard', icon: 'dashboard', render: renderDashboard },
  discover: { label: 'Discover', icon: 'discover', render: renderDiscover },
  topic_analyzer: { label: 'Topic Analyzer', icon: 'analyzer', render: renderTopicAnalyzer },
  script_impact: { label: 'Script Impact', icon: 'script', render: renderScriptImpact },
  performance: { label: 'Performance', icon: 'performance', render: renderPerformance },
  insights: { label: 'Insights', icon: 'insights', render: renderInsights },
  library: { label: 'Topic Library', icon: 'library', render: renderLibrary },
  settings: { label: 'Settings', icon: 'settings', render: renderSettings },
};

function buildNav() {
  const items = Object.entries(VIEWS).map(([id, v]) => `
    <button class="nav-item" data-route="${id}" title="${v.label}">
      ${Icon(v.icon)}<span>${v.label}</span>
    </button>`).join('');
  $('#sidebar-nav').innerHTML = items;
  $('#bottom-nav').innerHTML = Object.entries(VIEWS).slice(0, 5).map(([id, v]) => `
    <button class="bottom-nav-item" data-route="${id}" title="${v.label}">
      ${Icon(v.icon)}<span>${v.label}</span>
    </button>`).join('');

  document.body.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-route]');
    if (btn) navigate(btn.dataset.route);
  });
}

async function navigate(route) {
  if (!VIEWS[route]) route = 'dashboard';
  state.route = route;
  $all('.nav-item, .bottom-nav-item').forEach((b) => b.classList.toggle('active', b.dataset.route === route));
  $('#page-title').textContent = VIEWS[route].label;
  const root = $('#view-root');
  root.innerHTML = '<div class="loading">Loading…</div>';
  try {
    root.innerHTML = await VIEWS[route].render();
    wireView(route);
  } catch (err) {
    console.error(err);
    root.innerHTML = `<div class="empty-state">${Icon('alert')}<p>Something went wrong rendering this view.</p><p class="empty-sub">${escapeHtml(err.message)}</p></div>`;
  }
}

function wireView(route) {
  const wirers = {
    dashboard: wireDashboard,
    discover: wireDiscover,
    topic_analyzer: wireTopicAnalyzer,
    script_impact: wireScriptImpact,
    performance: wirePerformance,
    insights: wireInsights,
    library: wireLibrary,
    settings: wireSettings,
  };
  if (wirers[route]) wirers[route]();
}

// ---------------------------------------------------------------------
// DASHBOARD
// ---------------------------------------------------------------------
async function renderDashboard() {
  const [topics, videos] = await Promise.all([DB.getAll('topics'), DB.getAll('videos')]);

  const totalTopics = topics.length;
  const awaiting = topics.filter((t) => t.status === 'idea').length;
  const topTopics = [...topics].filter(t => t.analysis).sort((a, b) => b.analysis.weightedTotal - a.analysis.weightedTotal).slice(0, 5);
  const recentTopics = [...topics].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);

  const withMetrics = videos.map((v) => ({ ...v, metrics: Scoring.computePerformanceMetrics(v) }));
  const avgRetention = withMetrics.length ? withMetrics.reduce((a, v) => a + (Number(v.avgPercentViewed) || 0), 0) / withMetrics.length : null;
  const avgViews = withMetrics.length ? withMetrics.reduce((a, v) => a + (Number(v.views) || 0), 0) / withMetrics.length : null;
  const avgEngagement = withMetrics.length ? withMetrics.reduce((a, v) => a + v.metrics.engagementRate, 0) / withMetrics.length : null;

  const withForecast = videos.filter((v) => v.forecastScore !== undefined && v.forecastScore !== null && v.forecastScore !== '');
  let forecastAccuracyTxt = 'Not enough data yet';
  if (withForecast.length >= 3) {
    const avgDev = withForecast.reduce((a, v) => {
      const actual = Scoring.computePerformanceMetrics(v).performanceIndex;
      return a + Math.abs(Number(v.forecastScore) - actual);
    }, 0) / withForecast.length;
    forecastAccuracyTxt = `Average deviation ${avgDev.toFixed(1)} pts across ${withForecast.length} videos`;
  }

  const trend = [...videos]
    .filter((v) => v.publishDate)
    .sort((a, b) => new Date(a.publishDate) - new Date(b.publishDate))
    .slice(-10)
    .map((v) => ({ label: fmtDate(v.publishDate).replace(/, \d{4}/, ''), value: Scoring.computePerformanceMetrics(v).performanceIndex }));

  return `
    <div class="grid stats-grid">
      <div class="card stat-card"><span class="stat-label">Topics in library</span><span class="stat-value">${totalTopics}</span></div>
      <div class="card stat-card"><span class="stat-label">Awaiting evaluation</span><span class="stat-value">${awaiting}</span></div>
      <div class="card stat-card"><span class="stat-label">Videos tracked</span><span class="stat-value">${videos.length}</span></div>
      <div class="card stat-card"><span class="stat-label">Avg. % viewed</span><span class="stat-value">${avgRetention !== null ? avgRetention.toFixed(1) + '%' : '—'}</span></div>
      <div class="card stat-card"><span class="stat-label">Avg. views</span><span class="stat-value">${avgViews !== null ? Math.round(avgViews).toLocaleString() : '—'}</span></div>
      <div class="card stat-card"><span class="stat-label">Avg. engagement</span><span class="stat-value">${avgEngagement !== null ? avgEngagement.toFixed(1) + '%' : '—'}</span></div>
    </div>

    <div class="grid two-col">
      <div class="card">
        <h3>Performance trend<span class="card-sub">last ${trend.length || 0} published videos, by index</span></h3>
        ${trend.length >= 2 ? '<canvas id="trend-chart" class="chart"></canvas>' : emptyState('Not enough published videos yet.', 'Add videos in Performance to see a trend line here.')}
      </div>
      <div class="card">
        <h3>Forecast accuracy<span class="card-sub">forecast score vs. actual performance index</span></h3>
        <p class="muted">${forecastAccuracyTxt}</p>
        ${withForecast.length > 0 && withForecast.length < 3 ? `<p class="empty-sub">Only ${withForecast.length} video(s) with a forecast on record — at least 3 are needed before an accuracy trend is meaningful.</p>` : ''}
      </div>
    </div>

    <div class="grid two-col">
      <div class="card">
        <h3>Highest-potential saved topics</h3>
        ${topTopics.length ? `<ul class="list">${topTopics.map((t) => `
          <li class="list-row"><span>${escapeHtml(t.title)}</span><span class="score-pill" style="color:${scoreColor(t.analysis.weightedTotal)}">${t.analysis.weightedTotal}</span></li>`).join('')}</ul>`
          : emptyState('No analyzed topics yet.', 'Run a topic through the Topic Analyzer and save it to see it here.')}
      </div>
      <div class="card">
        <h3>Recently added topics</h3>
        ${recentTopics.length ? `<ul class="list">${recentTopics.map((t) => `
          <li class="list-row"><span>${escapeHtml(t.title)}</span>${stamp(t.status)}</li>`).join('')}</ul>`
          : emptyState('Your topic library is empty.', 'Generate ideas in Discover or add one manually in the Topic Library.')}
      </div>
    </div>
  `;
}
function wireDashboard() {
  DB.getAll('videos').then((videos) => {
    const trend = [...videos].filter((v) => v.publishDate).sort((a, b) => new Date(a.publishDate) - new Date(b.publishDate)).slice(-10)
      .map((v) => ({ label: fmtDate(v.publishDate).replace(/, \d{4}/, ''), value: Scoring.computePerformanceMetrics(v).performanceIndex }));
    const canvas = $('#trend-chart');
    if (canvas && trend.length >= 2) Charts.drawLineChart(canvas, trend, { max: 100, min: 0 });
  });
}

// ---------------------------------------------------------------------
// DISCOVER
// ---------------------------------------------------------------------
let lastIdeas = [];
async function renderDiscover() {
  return `
    <div class="card">
      <div class="row-between wrap">
        <div>
          <h3>Generate ideas</h3>
          <p class="card-sub">Combinatorial, rule-based generation across the whole Markie Star topic universe — no live trend data, no external AI.</p>
        </div>
        <div class="row gap">
          <select id="discover-mode">
            ${Discover.DISCOVERY_MODES.map((m) => `<option value="${m.id}">${escapeHtml(m.label)}</option>`).join('')}
          </select>
          <button class="btn btn-primary" id="generate-btn">${Icon('refresh')} Generate</button>
        </div>
      </div>
    </div>
    <div id="ideas-root" class="grid ideas-grid"></div>
  `;
}
function renderIdeaCard(idea, i) {
  const forecastRow = idea.forecast.dataPoints > 0
    ? `<div class="row-between"><span class="muted small">Channel forecast</span><span class="score-pill" style="color:${scoreColor(idea.forecast.channelForecast)}">${idea.forecast.channelForecast}</span></div>`
    : `<p class="muted small">Channel forecast: not enough historical data yet (confidence: ${idea.forecast.confidence}).</p>`;
  return `
    <div class="card idea-card">
      <div class="row-between wrap">
        <span class="pill">${escapeHtml(idea.category)}</span>
        <span class="pill pill-muted">${escapeHtml(idea.realityStatus)}</span>
      </div>
      <h4>${escapeHtml(idea.title)}</h4>
      <p>${escapeHtml(idea.premise)}</p>
      <p class="muted small">${escapeHtml(idea.whyInteresting)}</p>
      <dl class="kv">
        <dt>Markie Star angle</dt><dd>${escapeHtml(idea.markieStarAngle)}</dd>
        <dt>Suggested opening hook</dt><dd>${escapeHtml(idea.suggestedHook)}</dd>
        <dt>Possible escalation</dt><dd>${escapeHtml(idea.hypotheticalEscalation)}</dd>
        <dt>Visual potential</dt><dd>${idea.visualPotential.score}/100 (${escapeHtml(idea.visualPotential.label)})</dd>
        <dt>Why it could fail</dt><dd>${escapeHtml(idea.whyItCouldFail)}</dd>
      </dl>
      <div class="row-between">
        <span class="muted small">Topic potential</span>
        <span class="score-pill" style="color:${scoreColor(idea.topicPotential)}">${idea.topicPotential}</span>
      </div>
      ${forecastRow}
      <p class="muted small">Confidence: ${idea.confidence} · reason: ${escapeHtml(idea.forecast.reason)}</p>
      <div class="row gap">
        <button class="btn btn-ghost grow save-idea-btn" data-idx="${i}">${Icon('save')} Save</button>
        <button class="btn btn-primary grow analyze-idea-btn" data-idx="${i}">${Icon('analyzer')} Analyze</button>
      </div>
    </div>`;
}
function wireDiscover() {
  $('#generate-btn').addEventListener('click', async () => {
    const mode = $('#discover-mode').value;
    $('#ideas-root').innerHTML = '<div class="loading">Generating…</div>';
    lastIdeas = await Discover.generateIdeas({ count: 6, mode });
    if (!$('#ideas-root')) return;
    $('#ideas-root').innerHTML = lastIdeas.map(renderIdeaCard).join('');
    $all('.save-idea-btn').forEach((b) => b.addEventListener('click', async () => {
      const idea = lastIdeas[Number(b.dataset.idx)];
      const now = new Date().toISOString();
      await DB.add('topics', {
        title: idea.scoringTitle,
        description: idea.scoringDescription,
        category: idea.category,
        status: 'idea',
        tags: [idea.transformationLabel],
        notes: `${idea.whyInteresting} ${idea.whyItCouldFail}`,
        sourceUrl: '',
        analysis: idea.analysis,
        forecast: idea.forecast.raw,
        discoveryMeta: { mode: idea.discoveryMode, realityStatus: idea.realityStatus },
        createdAt: now,
        updatedAt: now,
      });
      toast('Saved to Topic Library', 'success');
    }));
    $all('.analyze-idea-btn').forEach((b) => b.addEventListener('click', () => {
      const idea = lastIdeas[Number(b.dataset.idx)];
      state.pendingAnalyzeIdea = idea;
      navigate('topic_analyzer');
    }));
  });
  $('#generate-btn').click();
}

// ---------------------------------------------------------------------
// TOPIC ANALYZER
// ---------------------------------------------------------------------
async function renderTopicAnalyzer() {
  const categories = Array.from(new Set(Discover.SUBJECTS.map((s) => s.category)));
  return `
    <div class="grid two-col">
      <div class="card">
        <h3>Enter a topic</h3>
        <label>Title<input id="ta-title" placeholder="e.g. What if a brittle star grew 20x larger?"></label>
        <label>Description<textarea id="ta-desc" rows="5" placeholder="Describe the concept, what's real vs. speculative, and any angle you're considering."></textarea></label>
        <div class="grid two-col">
          <label>Category<select id="ta-category"><option value="">—</option>${categories.map((c) => `<option>${escapeHtml(c)}</option>`).join('')}</select></label>
          <label>Source / reference URL<input id="ta-source" placeholder="optional"></label>
        </div>
        <button class="btn btn-primary btn-block" id="analyze-btn">${Icon('analyzer')} Analyze topic</button>
      </div>
      <div class="card" id="ta-results">
        ${emptyState('No analysis yet.', 'Enter a topic and click Analyze to see a transparent, weighted breakdown.')}
      </div>
    </div>
  `;
}
function dimensionRows(scores, weights, evidence, editable) {
  const labels = {
    curiosity: 'Curiosity', mystery: 'Mystery', visualPotential: 'Visual potential',
    hypotheticalPotential: 'Hypothetical potential', emotionalImpact: 'Emotional impact',
    novelty: 'Novelty', explanationPotential: 'Explanation potential', markieStarFit: 'Markie Star fit',
  };
  return Object.keys(weights).map((k) => `
    <div class="dim-row">
      ${bar(labels[k], scores[k], { weight: weights[k] })}
      ${editable ? `<input type="range" min="0" max="100" value="${scores[k]}" class="dim-slider" data-dim="${k}">` : ''}
      <p class="evidence">${Array.isArray(evidence[k]) && evidence[k].length ? 'Matched: ' + evidence[k].map(escapeHtml).join(', ') : 'No strong signal found in the text.'}</p>
    </div>`).join('');
}
function renderAnalysisPanel(a) {
  return `
    <div class="row-between">
      <h3>Score breakdown</h3>
      <span class="score-pill big" style="color:${scoreColor(a.weightedTotal)}">${a.weightedTotal}</span>
    </div>
    <p class="muted small">${escapeHtml(a.recommendationLevel)} · confidence: ${a.confidence}</p>
    ${dimensionRows(a.scores, a.weights, a.evidence, true)}
    <div class="grid two-col">
      <div><h4>Strengths</h4><p class="muted small">${a.strengths.length ? a.strengths.join(', ') : 'None stand out yet.'}</p></div>
      <div><h4>Weaknesses</h4><p class="muted small">${a.weaknesses.length ? a.weaknesses.join(', ') : 'None stand out.'}</p></div>
    </div>
    <div id="forecast-panel"></div>
    <button class="btn btn-primary btn-block" id="save-topic-btn">${Icon('save')} Save to Topic Library</button>
  `;
}
async function refreshForecastPanel(a, category) {
  const videos = await DB.getAll('videos');
  const catVideos = category ? videos.filter((v) => v.category === category).map((v) => ({ ...v, performanceIndex: Scoring.computePerformanceMetrics(v).performanceIndex })) : [];
  const f = Scoring.computeForecast({ topicAnalysis: a, categoryVideos: catVideos });
  $('#forecast-panel').innerHTML = `
    <h4>Forecast estimate <span class="muted small">(not a guarantee — see assumptions)</span></h4>
    <div class="row-between"><span>Estimated potential</span><span class="score-pill" style="color:${scoreColor(f.estimatedPotential)}">${f.estimatedPotential}</span></div>
    <p class="muted small">Confidence: ${f.confidence} · based on ${f.dataPoints} historical video(s) in this category</p>
    ${f.positives.length ? `<p class="small pos">+ ${f.positives.join(' ')}</p>` : ''}
    ${f.negatives.length ? `<p class="small neg">− ${f.negatives.join(' ')}</p>` : ''}
    ${f.assumptions.length ? `<p class="small warn">Assumptions: ${f.assumptions.join(' ')}</p>` : ''}
  `;
  return f;
}
async function runTopicAnalysis(title, desc, category, presetAnalysis) {
  // presetAnalysis lets the Discover "Analyze" handoff reuse the exact same
  // analysis object Discover already computed, instead of recomputing it —
  // the unified scoring engine is deterministic so recomputing would match
  // anyway, but reusing removes any doubt and is cheaper.
  const a = presetAnalysis || Scoring.calculateTopicScore({ title, description: desc });
  state.currentAnalysis = a;
  $('#ta-results').innerHTML = renderAnalysisPanel(a);
  let forecast = await refreshForecastPanel(a, category);

  $all('.dim-slider').forEach((s) => s.addEventListener('input', async (e) => {
    const dim = e.target.dataset.dim;
    a.scores[dim] = Number(e.target.value);
    let total = 0;
    for (const k of Object.keys(Scoring.TOPIC_WEIGHTS)) total += (a.scores[k] * Scoring.TOPIC_WEIGHTS[k]) / 100;
    a.weightedTotal = Math.round(total * 10) / 10;
    $('#ta-results').querySelector('.score-pill.big').textContent = a.weightedTotal;
    $('#ta-results').querySelector('.score-pill.big').style.color = scoreColor(a.weightedTotal);
    forecast = await refreshForecastPanel(a, category);
  }));

  $('#save-topic-btn').addEventListener('click', async () => {
    const now = new Date().toISOString();
    await DB.add('topics', {
      title: title || 'Untitled topic',
      description: desc,
      category: category || 'Uncategorized',
      sourceUrl: $('#ta-source').value.trim(),
      status: 'analyzed',
      tags: [],
      notes: '',
      analysis: a,
      forecast,
      createdAt: now,
      updatedAt: now,
    });
    toast('Topic saved to library', 'success');
  });
}
function wireTopicAnalyzer() {
  const pending = state.pendingAnalyzeIdea;
  if (pending) {
    state.pendingAnalyzeIdea = null;
    $('#ta-title').value = pending.scoringTitle;
    $('#ta-desc').value = pending.scoringDescription;
    const hasMatchingOption = $all('#ta-category option').some((opt) => opt.textContent === pending.category);
    if (hasMatchingOption) {
      $('#ta-category').value = pending.category;
    }
    toast('Loaded from Discover — same topic, same score', 'default');
    runTopicAnalysis(pending.scoringTitle, pending.scoringDescription, pending.category, pending.analysis);
  }

  $('#analyze-btn').addEventListener('click', async () => {
    const title = $('#ta-title').value.trim();
    const desc = $('#ta-desc').value.trim();
    if (!title && !desc) { toast('Enter a title or description first', 'warn'); return; }
    const category = $('#ta-category').value;
    await runTopicAnalysis(title, desc, category, null);
  });
}

// ---------------------------------------------------------------------
// SCRIPT IMPACT
// ---------------------------------------------------------------------
async function renderScriptImpact() {
  return `
    <div class="grid two-col">
      <div class="card">
        <h3>Paste a script</h3>
        <textarea id="script-input" rows="16" placeholder="Paste the full narration script here…"></textarea>
        <button class="btn btn-primary btn-block" id="script-analyze-btn">${Icon('script')} Analyze script</button>
      </div>
      <div class="card" id="script-results">${emptyState('No script analyzed yet.')}</div>
    </div>
  `;
}
function renderScriptResults(r) {
  const dimLabels = {
    openingHook: 'Opening hook', curiosityGap: 'Curiosity gap', microHookDensity: 'Micro-hook density',
    pacing: 'Pacing', escalation: 'Escalation', hypotheticalTransformation: 'Hypothetical transformation',
    emotionalProgression: 'Emotional progression', predictabilityRisk: 'Predictability risk (lower is better)',
    visualPotential: 'Visual potential', payoff: 'Payoff', cta: 'CTA integration',
  };
  return `
    <div class="row-between">
      <h3>Script impact</h3>
      <span class="score-pill big" style="color:${scoreColor(r.overall)}">${r.overall}</span>
    </div>
    <p class="muted small">${r.wordCount} words · ~${r.estimatedSeconds}s at 150 wpm · ${escapeHtml(r.durationFlag)}</p>
    <div class="dim-grid">${Object.entries(dimLabels).map(([k, l]) => bar(l, r.dims[k])).join('')}</div>

    <h4>Timeline</h4>
    <div class="timeline">
      ${r.sectionAnalysis.map((s) => `
        <div class="timeline-seg ${s.isFactDumpRisk ? 'risk' : ''}">
          <strong>${s.name}</strong>
          <span class="muted small">${s.sentenceCount} sentences · hook density ${s.hookDensity}</span>
          ${s.isFactDumpRisk ? `<span class="warn small">${Icon('alert')} possible fact-dump zone</span>` : ''}
        </div>`).join('')}
    </div>

    <div class="grid two-col">
      <div><h4>Strongest section</h4><p class="muted small">${escapeHtml(r.strongestSection)}</p></div>
      <div><h4>Weakest section</h4><p class="muted small">${escapeHtml(r.weakestSection)}</p></div>
    </div>
    <h4>Flags & suggestions</h4>
    <ul class="flag-list">
      ${r.factDumpSections.length ? `<li class="warn">${Icon('alert')} Fact-dump risk in: ${r.factDumpSections.join(', ')} — add a question or a "but/except" turn.</li>` : `<li class="pos">${Icon('check')} No fact-dump zones detected.</li>`}
      ${r.predictable ? `<li class="warn">${Icon('alert')} Low hook/open-loop density overall — the script may read as predictable.</li>` : `<li class="pos">${Icon('check')} Hook and open-loop density looks healthy.</li>`}
      ${!r.hasTransformation ? `<li class="warn">${Icon('alert')} No clear "what if / imagine" pivot detected after the opening — consider adding a hypothetical turn.</li>` : `<li class="pos">${Icon('check')} Hypothetical transformation detected.</li>`}
      ${!r.hasPayoff ? `<li class="warn">${Icon('alert')} No clear payoff phrase near the end.</li>` : `<li class="pos">${Icon('check')} Payoff language detected near the end.</li>`}
      ${!r.hasCTA ? `<li class="warn">${Icon('alert')} No CTA detected — add one, ideally in the final beat.</li>` : `<li class="pos">${Icon('check')} CTA detected.</li>`}
    </ul>
  `;
}
function wireScriptImpact() {
  $('#script-analyze-btn').addEventListener('click', () => {
    const text = $('#script-input').value.trim();
    if (!text) { toast('Paste a script first', 'warn'); return; }
    const r = Scoring.analyzeScript(text);
    state.currentScriptAnalysis = { text, result: r };
    $('#script-results').innerHTML = renderScriptResults(r);
  });
}

// ---------------------------------------------------------------------
// PERFORMANCE TRACKER
// ---------------------------------------------------------------------
async function renderPerformance() {
  const videos = await DB.getAll('videos');
  const rows = videos.map((v) => {
    const m = Scoring.computePerformanceMetrics(v);
    return `<tr>
      <td>${escapeHtml(v.title)}</td>
      <td>${escapeHtml(v.category || '—')}</td>
      <td>${fmtDate(v.publishDate)}</td>
      <td>${(v.views || 0).toLocaleString()}</td>
      <td>${v.avgPercentViewed ? v.avgPercentViewed + '%' : '—'}</td>
      <td style="color:${scoreColor(m.performanceIndex)}">${m.performanceIndex}</td>
      <td>${v.forecastScore ?? '—'}</td>
      <td class="row gap">
        <button class="btn btn-icon edit-video-btn" data-id="${v.id}">${Icon('edit')}</button>
        <button class="btn btn-icon delete-video-btn" data-id="${v.id}">${Icon('trash')}</button>
      </td>
    </tr>`;
  }).join('');

  return `
    <div class="card">
      <div class="row-between">
        <h3>Published videos</h3>
        <button class="btn btn-primary" id="add-video-btn">${Icon('plus')} Add video</button>
      </div>
      ${videos.length ? `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Title</th><th>Category</th><th>Published</th><th>Views</th><th>Avg % viewed</th><th>Performance index</th><th>Forecast</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>` : emptyState('No videos tracked yet.', 'Add a published video to start comparing forecasts against real results.')}
    </div>
    <dialog id="video-dialog" class="dialog">
      <form method="dialog" id="video-form">
        <h3 id="video-form-title">Add video</h3>
        <input type="hidden" id="v-id">
        <div class="grid two-col">
          <label>Title<input id="v-title" required></label>
          <label>Topic (optional)<input id="v-topic"></label>
          <label>Category<input id="v-category"></label>
          <label>Format<select id="v-format"><option>Short</option><option>Long-form</option></select></label>
          <label>Publish date<input type="date" id="v-date"></label>
          <label>Duration (seconds)<input type="number" id="v-duration" min="0"></label>
          <label>Forecast score<input type="number" id="v-forecast" min="0" max="100"></label>
          <label>Forecast confidence<select id="v-forecast-conf"><option>Very low</option><option>Low</option><option>Medium</option><option>High</option><option>Very high</option></select></label>
          <label>Views<input type="number" id="v-views" min="0"></label>
          <label>Viewed vs. swiped away (%)<input type="number" id="v-swiped" min="0" max="100"></label>
          <label>Avg % viewed<input type="number" id="v-avgpct" min="0" max="100"></label>
          <label>Avg watch duration (s)<input type="number" id="v-avgdur" min="0"></label>
          <label>Likes<input type="number" id="v-likes" min="0"></label>
          <label>Comments<input type="number" id="v-comments" min="0"></label>
          <label>Shares<input type="number" id="v-shares" min="0"></label>
          <label>Subscribers gained<input type="number" id="v-subs" min="0"></label>
        </div>
        <label>Notes<textarea id="v-notes" rows="2"></textarea></label>
        <div class="row-between">
          <button type="button" class="btn btn-ghost" id="video-cancel-btn">Cancel</button>
          <button type="submit" class="btn btn-primary" id="video-save-btn">Save video</button>
        </div>
      </form>
    </dialog>
  `;
}
function wirePerformance() {
  const dialog = $('#video-dialog');
  function openDialog(video) {
    $('#video-form-title').textContent = video ? 'Edit video' : 'Add video';
    $('#v-id').value = video?.id ?? '';
    $('#v-title').value = video?.title ?? '';
    $('#v-topic').value = video?.topic ?? '';
    $('#v-category').value = video?.category ?? '';
    $('#v-format').value = video?.format ?? 'Short';
    $('#v-date').value = video?.publishDate ? video.publishDate.slice(0, 10) : '';
    $('#v-duration').value = video?.duration ?? '';
    $('#v-forecast').value = video?.forecastScore ?? '';
    $('#v-forecast-conf').value = video?.forecastConfidence ?? 'Medium';
    $('#v-views').value = video?.views ?? '';
    $('#v-swiped').value = video?.viewedVsSwiped ?? '';
    $('#v-avgpct').value = video?.avgPercentViewed ?? '';
    $('#v-avgdur').value = video?.avgWatchDuration ?? '';
    $('#v-likes').value = video?.likes ?? '';
    $('#v-comments').value = video?.comments ?? '';
    $('#v-shares').value = video?.shares ?? '';
    $('#v-subs').value = video?.subsGained ?? '';
    $('#v-notes').value = video?.notes ?? '';
    dialog.showModal();
  }
  $('#add-video-btn').addEventListener('click', () => openDialog(null));
  $('#video-cancel-btn').addEventListener('click', () => dialog.close());
  $all('.edit-video-btn').forEach((b) => b.addEventListener('click', async () => {
    const v = await DB.get('videos', Number(b.dataset.id));
    openDialog(v);
  }));
  $all('.delete-video-btn').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Delete this video record? This cannot be undone.')) return;
    await DB.delete('videos', Number(b.dataset.id));
    navigate('performance');
  }));
  $('#video-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('#v-id').value;
    const video = {
      title: $('#v-title').value.trim(),
      topic: $('#v-topic').value.trim(),
      category: $('#v-category').value.trim(),
      format: $('#v-format').value,
      publishDate: $('#v-date').value || '',
      duration: Number($('#v-duration').value) || null,
      forecastScore: $('#v-forecast').value === '' ? null : Number($('#v-forecast').value),
      forecastConfidence: $('#v-forecast-conf').value,
      views: Number($('#v-views').value) || 0,
      viewedVsSwiped: Number($('#v-swiped').value) || null,
      avgPercentViewed: Number($('#v-avgpct').value) || 0,
      avgWatchDuration: Number($('#v-avgdur').value) || null,
      likes: Number($('#v-likes').value) || 0,
      comments: Number($('#v-comments').value) || 0,
      shares: Number($('#v-shares').value) || 0,
      subsGained: Number($('#v-subs').value) || 0,
      notes: $('#v-notes').value.trim(),
      updatedAt: new Date().toISOString(),
    };
    if (id) {
      video.id = Number(id);
      video.createdAt = (await DB.get('videos', Number(id))).createdAt;
      await DB.put('videos', video);
    } else {
      video.createdAt = new Date().toISOString();
      await DB.add('videos', video);
    }
    dialog.close();
    toast('Video saved', 'success');
    navigate('performance');
  });
}

// ---------------------------------------------------------------------
// INSIGHTS
// ---------------------------------------------------------------------
async function renderInsights() {
  const videos = await DB.getAll('videos');
  if (videos.length < 3) {
    return `<div class="card">${emptyState('Insufficient data for reliable insights.', `Only ${videos.length} video(s) tracked. Add at least 3, ideally across different categories, before category-level patterns are meaningful.`)}</div>`;
  }
  const withM = videos.map((v) => ({ ...v, m: Scoring.computePerformanceMetrics(v) }));
  const byCategory = {};
  withM.forEach((v) => {
    const c = v.category || 'Uncategorized';
    byCategory[c] = byCategory[c] || [];
    byCategory[c].push(v);
  });
  const catStats = Object.entries(byCategory).map(([cat, vids]) => ({
    category: cat,
    n: vids.length,
    avgIndex: vids.reduce((a, v) => a + v.m.performanceIndex, 0) / vids.length,
    avgRetention: vids.reduce((a, v) => a + (Number(v.avgPercentViewed) || 0), 0) / vids.length,
  })).sort((a, b) => b.avgIndex - a.avgIndex);

  const lowSampleCats = catStats.filter((c) => c.n < 3).map((c) => c.category);

  const byFormat = {};
  withM.forEach((v) => {
    const f = v.format || 'Unspecified';
    byFormat[f] = byFormat[f] || [];
    byFormat[f].push(v);
  });
  const formatStats = Object.entries(byFormat).map(([f, vids]) => ({
    format: f, n: vids.length, avgIndex: vids.reduce((a, v) => a + v.m.performanceIndex, 0) / vids.length,
  }));

  const withForecast = videos.filter((v) => v.forecastScore !== null && v.forecastScore !== undefined && v.forecastScore !== '');

  return `
    <div class="grid two-col">
      <div class="card">
        <h3>Performance by category</h3>
        <canvas id="cat-chart" class="chart"></canvas>
        ${lowSampleCats.length ? `<p class="empty-sub">Low sample size (fewer than 3 videos) for: ${lowSampleCats.join(', ')} — treat these as directional, not conclusive.</p>` : ''}
      </div>
      <div class="card">
        <h3>Performance by format</h3>
        <canvas id="format-chart" class="chart"></canvas>
      </div>
    </div>
    <div class="card">
      <h3>Forecast accuracy over time</h3>
      ${withForecast.length >= 3 ? '<canvas id="accuracy-chart" class="chart"></canvas>' : emptyState('Not enough forecasted videos yet.', `${withForecast.length} of ${videos.length} tracked videos have a forecast score on record. Add forecasts before publishing to build this out.`)}
      <p class="empty-sub">Correlation shown here is descriptive only — a small channel-specific sample cannot establish causation between any single factor and performance.</p>
    </div>
  `;
}
function wireInsights() {
  DB.getAll('videos').then((videos) => {
    const withM = videos.map((v) => ({ ...v, m: Scoring.computePerformanceMetrics(v) }));
    const byCategory = {};
    withM.forEach((v) => { const c = v.category || 'Uncategorized'; (byCategory[c] = byCategory[c] || []).push(v); });
    const catData = Object.entries(byCategory).map(([cat, vids]) => ({ label: cat, value: vids.reduce((a, v) => a + v.m.performanceIndex, 0) / vids.length }));
    const catCanvas = $('#cat-chart');
    if (catCanvas) Charts.drawBarChart(catCanvas, catData, { max: 100 });

    const byFormat = {};
    withM.forEach((v) => { const f = v.format || 'Unspecified'; (byFormat[f] = byFormat[f] || []).push(v); });
    const fmtData = Object.entries(byFormat).map(([f, vids]) => ({ label: f, value: vids.reduce((a, v) => a + v.m.performanceIndex, 0) / vids.length }));
    const fmtCanvas = $('#format-chart');
    if (fmtCanvas) Charts.drawBarChart(fmtCanvas, fmtData, { max: 100, color: '#5FAE7A' });

    const withForecast = videos.filter((v) => v.forecastScore !== null && v.forecastScore !== undefined && v.forecastScore !== '' && v.publishDate)
      .sort((a, b) => new Date(a.publishDate) - new Date(b.publishDate));
    const accCanvas = $('#accuracy-chart');
    if (accCanvas && withForecast.length >= 3) {
      const devData = withForecast.map((v) => ({ label: fmtDate(v.publishDate).replace(/, \d{4}/, ''), value: Math.abs(Number(v.forecastScore) - Scoring.computePerformanceMetrics(v).performanceIndex) }));
      Charts.drawLineChart(accCanvas, devData, { color: '#D9A441', min: 0 });
    }
  });
}

// ---------------------------------------------------------------------
// TOPIC LIBRARY
// ---------------------------------------------------------------------
async function renderLibrary() {
  const topics = await DB.getAll('topics');
  return `
    <div class="card">
      <div class="row-between wrap gap">
        <input id="lib-search" placeholder="Search topics…" class="grow">
        <select id="lib-status-filter"><option value="">All statuses</option>${STATUSES.map((s) => `<option value="${s}">${STATUS_LABEL[s]}</option>`).join('')}</select>
        <select id="lib-sort"><option value="date">Sort: newest</option><option value="score">Sort: highest score</option><option value="title">Sort: title</option></select>
        <button class="btn btn-primary" id="lib-add-btn">${Icon('plus')} Add topic</button>
      </div>
    </div>
    <div id="lib-list" class="grid ideas-grid"></div>
    <dialog id="topic-dialog" class="dialog">
      <form method="dialog" id="topic-form">
        <h3 id="topic-form-title">Topic</h3>
        <input type="hidden" id="t-id">
        <label>Title<input id="t-title" required></label>
        <label>Description<textarea id="t-desc" rows="4"></textarea></label>
        <div class="grid two-col">
          <label>Category<input id="t-category"></label>
          <label>Status<select id="t-status">${STATUSES.map((s) => `<option value="${s}">${STATUS_LABEL[s]}</option>`).join('')}</select></label>
        </div>
        <label>Tags (comma separated)<input id="t-tags"></label>
        <label>Notes<textarea id="t-notes" rows="2"></textarea></label>
        <div class="row-between">
          <button type="button" class="btn btn-ghost" id="topic-cancel-btn">Cancel</button>
          <button type="submit" class="btn btn-primary">Save topic</button>
        </div>
      </form>
    </dialog>
  `;
}
function libraryCard(t) {
  return `
    <div class="card idea-card">
      <div class="row-between">
        <span class="pill">${escapeHtml(t.category || 'Uncategorized')}</span>
        ${stamp(t.status)}
      </div>
      <h4>${escapeHtml(t.title)}</h4>
      <p class="muted small">${escapeHtml((t.description || '').slice(0, 160))}${(t.description || '').length > 160 ? '…' : ''}</p>
      ${t.analysis ? `<div class="row-between"><span class="score-pill" style="color:${scoreColor(t.analysis.weightedTotal)}">Score ${t.analysis.weightedTotal}</span><span class="muted small">${t.analysis.recommendationLevel}</span></div>` : '<p class="muted small">Not yet analyzed.</p>'}
      ${t.tags && t.tags.length ? `<div class="tag-row">${t.tags.map((tag) => `<span class="tag">${Icon('tag')}${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
      <div class="row gap">
        <select class="status-select" data-id="${t.id}">${STATUSES.map((s) => `<option value="${s}" ${s === t.status ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}</select>
        <button class="btn btn-icon edit-topic-btn" data-id="${t.id}">${Icon('edit')}</button>
        <button class="btn btn-icon delete-topic-btn" data-id="${t.id}">${Icon('trash')}</button>
      </div>
    </div>`;
}
async function refreshLibraryList() {
  let topics = await DB.getAll('topics');
  if (!$('#lib-search')) return; // view was navigated away from before this async call resolved
  const q = $('#lib-search').value.trim().toLowerCase();
  const statusFilter = $('#lib-status-filter').value;
  const sort = $('#lib-sort').value;
  if (q) topics = topics.filter((t) => (t.title + ' ' + (t.description || '')).toLowerCase().includes(q));
  if (statusFilter) topics = topics.filter((t) => t.status === statusFilter);
  if (sort === 'score') topics.sort((a, b) => (b.analysis?.weightedTotal || 0) - (a.analysis?.weightedTotal || 0));
  else if (sort === 'title') topics.sort((a, b) => a.title.localeCompare(b.title));
  else topics.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  $('#lib-list').innerHTML = topics.length ? topics.map(libraryCard).join('') : emptyState('No topics match.', 'Try clearing the search or filters.');
  wireLibraryCards();
}
function wireLibraryCards() {
  $all('.status-select').forEach((s) => s.addEventListener('change', async () => {
    const t = await DB.get('topics', Number(s.dataset.id));
    t.status = s.value;
    t.updatedAt = new Date().toISOString();
    await DB.put('topics', t);
    toast('Status updated', 'success');
  }));
  $all('.edit-topic-btn').forEach((b) => b.addEventListener('click', async () => {
    const t = await DB.get('topics', Number(b.dataset.id));
    openTopicDialog(t);
  }));
  $all('.delete-topic-btn').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Delete this topic? This cannot be undone.')) return;
    await DB.delete('topics', Number(b.dataset.id));
    refreshLibraryList();
  }));
}
function openTopicDialog(t) {
  $('#topic-form-title').textContent = t ? 'Edit topic' : 'Add topic';
  $('#t-id').value = t?.id ?? '';
  $('#t-title').value = t?.title ?? '';
  $('#t-desc').value = t?.description ?? '';
  $('#t-category').value = t?.category ?? '';
  $('#t-status').value = t?.status ?? 'idea';
  $('#t-tags').value = (t?.tags || []).join(', ');
  $('#t-notes').value = t?.notes ?? '';
  $('#topic-dialog').showModal();
}
function wireLibrary() {
  refreshLibraryList();
  $('#lib-search').addEventListener('input', refreshLibraryList);
  $('#lib-status-filter').addEventListener('change', refreshLibraryList);
  $('#lib-sort').addEventListener('change', refreshLibraryList);
  $('#lib-add-btn').addEventListener('click', () => openTopicDialog(null));
  $('#topic-cancel-btn').addEventListener('click', () => $('#topic-dialog').close());
  $('#topic-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = $('#t-id').value;
    const now = new Date().toISOString();
    const topic = {
      title: $('#t-title').value.trim(),
      description: $('#t-desc').value.trim(),
      category: $('#t-category').value.trim(),
      status: $('#t-status').value,
      tags: $('#t-tags').value.split(',').map((s) => s.trim()).filter(Boolean),
      notes: $('#t-notes').value.trim(),
      updatedAt: now,
    };
    if (id) {
      const existing = await DB.get('topics', Number(id));
      await DB.put('topics', { ...existing, ...topic, id: Number(id) });
    } else {
      topic.createdAt = now;
      await DB.add('topics', topic);
    }
    $('#topic-dialog').close();
    toast('Topic saved', 'success');
    refreshLibraryList();
  });
}

// ---------------------------------------------------------------------
// SETTINGS
// ---------------------------------------------------------------------
async function renderSettings() {
  return `
    <div class="grid two-col">
      <div class="card">
        <h3>Data management</h3>
        <p class="muted small">All data lives only in this browser's local IndexedDB storage. Nothing is sent anywhere.</p>
        <button class="btn btn-block" id="export-btn">${Icon('download')} Export all data (JSON)</button>
        <label class="btn btn-block file-btn">${Icon('upload')} Import JSON<input type="file" id="import-file" accept="application/json" hidden></label>
        <div class="row gap" id="import-mode-row" style="display:none">
          <label class="radio"><input type="radio" name="import-mode" value="merge" checked> Merge with existing data</label>
          <label class="radio"><input type="radio" name="import-mode" value="replace"> Replace all data</label>
          <button class="btn btn-primary" id="import-confirm-btn">Import</button>
        </div>
        <button class="btn btn-block btn-danger" id="clear-btn">${Icon('trash')} Clear all data</button>
      </div>
      <div class="card">
        <h3>How scoring works</h3>
        <p class="muted small">Every score in this app comes from a fixed, documented formula applied to what you enter — keyword and structure heuristics for text, or your own numbers for performance metrics. Nothing is generated by a language model or pulled from live web trends. You can see and manually adjust every dimension behind a score.</p>
        <p class="muted small">Topic Analyzer weights: Curiosity 20% · Mystery 15% · Visual potential 15% · Hypothetical potential 15% · Emotional impact 10% · Novelty 10% · Explanation potential 10% · Markie Star fit 5%.</p>
        <p class="muted small">Forecast weights: Topic potential 40% · Markie Star fit 15% · Visual potential 10% · Historical channel pattern 10% · Novelty 10% · Hypothetical potential 10% · Competition 5%.</p>
      </div>
    </div>
  `;
}
function wireSettings() {
  $('#export-btn').addEventListener('click', async () => {
    const data = await DB.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `markie-star-intelligence-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Export downloaded', 'success');
  });

  let pendingFile = null;
  $('#import-file').addEventListener('change', (e) => {
    pendingFile = e.target.files[0] || null;
    $('#import-mode-row').style.display = pendingFile ? 'flex' : 'none';
  });
  $('#import-confirm-btn').addEventListener('click', async () => {
    if (!pendingFile) return;
    try {
      const text = await pendingFile.text();
      const payload = JSON.parse(text);
      const mode = $('input[name="import-mode"]:checked').value;
      const res = await DB.importAll(payload, mode);
      toast(`Imported ${res.topicsImported} topic(s), ${res.videosImported} video(s)`, 'success');
      $('#import-mode-row').style.display = 'none';
      pendingFile = null;
    } catch (err) {
      toast('Import failed: ' + err.message, 'error');
    }
  });

  $('#clear-btn').addEventListener('click', async () => {
    if (!confirm('This permanently deletes all topics, videos, and settings from this browser. Continue?')) return;
    await DB.wipeAll();
    toast('All data cleared', 'success');
    navigate('dashboard');
  });
}

// ---------------------------------------------------------------------
// init
// ---------------------------------------------------------------------
window.addEventListener('DOMContentLoaded', async () => {
  buildNav();
  await openDB();
  navigate('dashboard');
});
