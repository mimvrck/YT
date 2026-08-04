/* scoring.js
   All scoring here is rule-based and deterministic: keyword/structure heuristics
   with a fully visible formula, never a call to an external model and never
   Math.random() in a numeric score. Every score ships with the evidence
   (matched markers / sentence indices) that produced it, and low-evidence
   inputs are labeled with lower confidence rather than a falsely precise number. */

const TOPIC_WEIGHTS = {
  curiosity: 20,
  mystery: 15,
  visualPotential: 15,
  hypotheticalPotential: 15,
  emotionalImpact: 10,
  novelty: 10,
  explanationPotential: 10,
  markieStarFit: 5,
};

const FORECAST_WEIGHTS = {
  topicPotential: 40,
  markieStarFit: 15,
  visualPotential: 10,
  historicalPattern: 10,
  novelty: 10,
  hypotheticalPotential: 10,
  competition: 5,
};

// ---------------------------------------------------------------------
// Marker dictionaries used for transparent text heuristics
// ---------------------------------------------------------------------
const MARKERS = {
  curiosity: ['what if', 'why', 'how is it possible', 'nobody knows', 'no one knows', 'unexplained',
    'mystery', 'mysterious', 'strange', 'bizarre', 'impossible', 'no one can explain', 'secret'],
  mystery: ['unexplained', 'unknown', 'mysterious', 'disappeared', 'no explanation', 'unsolved',
    'anomaly', 'anomalous', 'unidentified', 'classified', 'vanished', 'hidden', 'buried'],
  visual: ['footage', 'video', 'photo', 'image', 'filmed', 'captured', 'giant', 'glowing', 'massive',
    'creature', 'explosion', 'colossal', 'enormous', 'huge', 'tiny', 'microscopic', 'deep-sea', 'ancient ruins'],
  hypothetical: ['what if', 'imagine', 'suppose', 'hypothetical', 'could', 'would', 'scenario',
    'evolved', 'evolve', 'if this happened', 'what would happen'],
  emotional: ['terrifying', 'horrifying', 'unsettling', 'creepy', 'eerie', 'fascinating', 'awe',
    'shocking', 'disturbing', 'incredible', 'impossible', 'chilling', 'haunting'],
  explanation: ['because', 'scientists', 'research', 'study', 'theory', 'explain', 'discovered',
    'evidence', 'data', 'according to', 'experts'],
  scale: ['giant', 'massive', 'enormous', 'huge', 'colossal', 'tiny', 'microscopic', '20x', '100x', 'times bigger'],
  overusedTopics: ['shark', 'ufo', 'alien', 'ghost', 'bigfoot', 'loch ness', 'area 51',
    'bermuda triangle', 'atlantis', 'aliens'],
  categoryKeywords: ['ocean', 'space', 'cryptid', 'myth', 'folklore', 'urban legend', 'deep-web',
    'internet', 'ufo', 'alien', 'nasa', 'cosmic', 'evolution', 'extinction', 'civilization',
    'conspiracy', 'thought experiment', 'horror', 'analog horror', 'scp', 'fictional', 'creature',
    'game', 'movie', 'cartoon', 'technology', 'artificial intelligence', 'robot', 'dimension',
    'parallel universe', 'time travel', 'black hole', 'physics', 'biology', 'atmospheric',
    'historical', 'ancient', 'psychological', 'human behavior'],
  novelty: ['never before', 'first time', 'newly discovered', 'recently discovered', 'recently found',
    'never seen', 'undocumented', 'newly identified', 'only recently', 'just discovered', 'never recorded',
    'never been explained'],
  escalation: ['but what if', 'now imagine', "here's where it gets", 'take it further', 'push it further',
    'worse still', "doesn't stop there", 'goes even further', 'even more', 'even stranger', 'and then',
    'that is not the strangest part'],
};

// Structural pattern used to detect a genuinely elaborated scale/hypothetical premise
// (e.g. "the size of a building", "20 times larger") rather than a bare "what if" with
// nothing behind it — this is what should separate "Ocean creature" from "What if an
// ocean creature evolved to the size of a building?" per the scoring spec.
const SCALE_STRUCTURE_REGEX = /(\d+(\.\d+)?\s*(x|times)\b|the size of|as (big|large|small|fast|old|slow) as|orders of magnitude)/i;
const YEAR_REGEX = /\b(1[6-9]\d{2}|20\d{2})\b/;

const MICRO_HOOK_MARKERS = [
  "but that's where things get strange", 'but here', 'except', 'however', "here's the",
  'now here', "but that's not all", 'but what if', 'the terrifying part', 'the strange part',
  'what if we', 'until', 'but scientists', 'but nobody',
];
const OPEN_LOOP_MARKERS = ['but', 'except', 'however', 'until', 'unless', 'yet'];
const PAYOFF_MARKERS = ['turns out', "that's why", 'now you know', 'which means', 'revealed', 'the answer is'];
const CTA_MARKERS = ['comment', 'follow', 'subscribe', 'tell me', 'would you', 'let me know', 'share your'];

function countMatches(text, markers) {
  const t = text.toLowerCase();
  const matched = [];
  for (const m of markers) {
    if (t.includes(m)) matched.push(m);
  }
  return matched;
}

function clamp(n, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n));
}

function wordCount(text) {
  return (text.trim().match(/\S+/g) || []).length;
}

function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------
// Topic Analyzer
// ---------------------------------------------------------------------
function scoreDimension(matched, opts = {}) {
  const { base = 30, perMatch = 11, capMatches = 6, bonus = 0 } = opts;
  const score = clamp(base + Math.min(matched.length, capMatches) * perMatch + bonus);
  return score;
}

/**
 * calculateTopicScore — THE single canonical scoring function for the whole app.
 *
 * Every surface that produces or displays a topic score (Discover, Topic Analyzer,
 * Forecast Engine's topicPotential input, Topic Library re-scoring, and any future
 * live-research candidate pipeline) must call this same function with the same
 * { title, description } shape. There is intentionally no second scoring path —
 * that duplication was the root cause of Discover and Topic Analyzer disagreeing
 * on the same topic.
 *
 * Deterministic: same input text always produces the same output. No Math.random().
 * A topic generated by Discover receives no default/implicit bonus — it is scored
 * from its actual title+description text exactly as if a person had typed it into
 * Topic Analyzer, because that is exactly the text Discover feeds in here.
 */
function calculateTopicScore({ title = '', description = '' } = {}) {
  const text = `${title || ''}. ${description || ''}`;
  const words = wordCount(text);

  // --- structural signals (beyond raw keyword counts) ---------------
  const hasQuestion = text.includes('?');
  const leadText = (title || description || '').trim();
  const startsWithHook = /^\s*(what if|why|how|imagine|suppose|could|would)/i.test(leadText);
  const scaleStructureMatch = SCALE_STRUCTURE_REGEX.test(text);
  const hasYear = YEAR_REGEX.test(text);
  // proper-noun-ish tokens (excluding the very first word) as a rough proxy for a
  // concrete, recognizable subject rather than a vague generality
  const properNounHits = (text.match(/[A-Z][a-z]{2,}/g) || []).length;
  const specificityBonus = clamp(Math.min(properNounHits, 4) * 2, 0, 8);

  const curiosityMatched = countMatches(text, MARKERS.curiosity);
  const mysteryMatched = countMatches(text, MARKERS.mystery);
  const visualMatched = countMatches(text, MARKERS.visual);
  const hypotheticalMatched = countMatches(text, MARKERS.hypothetical);
  const emotionalMatched = countMatches(text, MARKERS.emotional);
  const explanationMatched = countMatches(text, MARKERS.explanation);
  const scaleMatched = countMatches(text, MARKERS.scale);
  const overusedMatched = countMatches(text, MARKERS.overusedTopics);
  const categoryMatched = countMatches(text, MARKERS.categoryKeywords);
  const noveltyMatched = countMatches(text, MARKERS.novelty);
  const escalationMatched = countMatches(text, MARKERS.escalation);

  // Hypothetical/visual bonuses require actual elaboration (a scale phrase, an
  // escalation turn), not just the presence of the words "what if" on their own —
  // a bare two-word subject with no premise should not out-score a worked-through
  // hypothetical just because a hook word is technically present.
  const scores = {
    curiosity: scoreDimension(curiosityMatched, {
      bonus: (hasQuestion ? 6 : 0) + (startsWithHook ? 4 : 0) + (escalationMatched.length ? 6 : 0),
    }),
    mystery: scoreDimension(mysteryMatched, {
      bonus: hasQuestion && !startsWithHook ? 4 : 0,
    }),
    visualPotential: scoreDimension(visualMatched, {
      bonus: (scaleMatched.length ? 6 : 0) + (scaleStructureMatch ? 6 : 0),
    }),
    hypotheticalPotential: scoreDimension(hypotheticalMatched, {
      bonus: (startsWithHook ? 4 : 0) + (scaleStructureMatch ? 8 : 0) + (escalationMatched.length ? 6 : 0),
    }),
    emotionalImpact: scoreDimension(emotionalMatched),
    novelty: clamp(70 - overusedMatched.length * 9 + noveltyMatched.length * 8),
    explanationPotential: scoreDimension(explanationMatched, {
      bonus: (words > 40 ? 8 : 0) + (hasYear ? 6 : 0),
    }),
    markieStarFit: categoryMatched.length === 0
      ? clamp(30 + specificityBonus)
      : clamp(48 + Math.min(categoryMatched.length, 5) * 9 + specificityBonus),
  };

  const evidence = {
    curiosity: curiosityMatched.concat(escalationMatched.length ? ['escalation language: ' + escalationMatched.join(', ')] : []),
    mystery: mysteryMatched,
    visualPotential: visualMatched.concat(scaleMatched.length ? ['scale language: ' + scaleMatched.join(', ')] : []),
    hypotheticalPotential: hypotheticalMatched.concat(scaleStructureMatch ? ['elaborated scale/comparison structure detected'] : []),
    emotionalImpact: emotionalMatched,
    novelty: (overusedMatched.length ? ['overused subject terms: ' + overusedMatched.join(', ')] : ['no heavily-covered subject terms detected'])
      .concat(noveltyMatched.length ? ['novelty language: ' + noveltyMatched.join(', ')] : []),
    explanationPotential: explanationMatched,
    markieStarFit: categoryMatched.length ? categoryMatched : ['no clear match to the Markie Star topic universe'],
  };

  let weightedTotal = 0;
  for (const key of Object.keys(TOPIC_WEIGHTS)) {
    weightedTotal += (scores[key] * TOPIC_WEIGHTS[key]) / 100;
  }
  weightedTotal = Math.round(weightedTotal * 10) / 10;

  const strengths = [];
  const weaknesses = [];
  for (const key of Object.keys(scores)) {
    if (scores[key] >= 70) strengths.push(key);
    if (scores[key] <= 45) weaknesses.push(key);
  }

  let confidence = 'Low';
  if (words >= 40) confidence = 'High';
  else if (words >= 15) confidence = 'Medium';

  let recommendationLevel = 'Weak opportunity';
  if (weightedTotal >= 80) recommendationLevel = 'Exceptional opportunity';
  else if (weightedTotal >= 65) recommendationLevel = 'Strong opportunity';
  else if (weightedTotal >= 50) recommendationLevel = 'Promising but needs a stronger angle';
  else if (weightedTotal >= 35) recommendationLevel = 'Average opportunity';

  return {
    scores,
    weights: TOPIC_WEIGHTS,
    evidence,
    weightedTotal,
    strengths,
    weaknesses,
    confidence,
    recommendationLevel,
    wordCount: words,
  };
}

// Thin backward-compatible wrapper — same engine, older call shape.
function analyzeTopicText(title, description) {
  return calculateTopicScore({ title, description });
}

// ---------------------------------------------------------------------
// Script Impact Analyzer
// ---------------------------------------------------------------------
function analyzeScript(scriptText) {
  const text = (scriptText || '').trim();
  const words = wordCount(text);
  const sentences = splitSentences(text);
  const sentenceCount = sentences.length || 1;
  const estSeconds = Math.round((words / 150) * 60); // ~150 wpm spoken narration

  const sectionSize = Math.ceil(sentenceCount / 3);
  const sections = [
    { name: 'Opening', sentences: sentences.slice(0, sectionSize) },
    { name: 'Development', sentences: sentences.slice(sectionSize, sectionSize * 2) },
    { name: 'Escalation / Payoff', sentences: sentences.slice(sectionSize * 2) },
  ];

  function sectionStats(sec) {
    const t = sec.sentences.join(' ');
    const hookHits = countMatches(t, MICRO_HOOK_MARKERS).length + (t.match(/\?/g) || []).length;
    const words2 = wordCount(t);
    const avgSentenceLen = sec.sentences.length ? words2 / sec.sentences.length : 0;
    const emotional = countMatches(t, MARKERS.emotional).length;
    return {
      name: sec.name,
      sentenceCount: sec.sentences.length,
      wordCount: words2,
      hookDensity: sec.sentences.length ? +(hookHits / sec.sentences.length).toFixed(2) : 0,
      avgSentenceLength: +avgSentenceLen.toFixed(1),
      emotionalWordCount: emotional,
      isFactDumpRisk: sec.sentences.length >= 3 && hookHits === 0 && avgSentenceLen > 14,
    };
  }

  const sectionAnalysis = sections.map(sectionStats);

  const openingText = sections[0].sentences.join(' ');
  const openingHookScore = clamp(
    30 +
      countMatches(openingText, MARKERS.curiosity).length * 15 +
      (openingText.includes('?') ? 15 : 0) +
      (/^\s*(what if|imagine|why|how|something)/i.test(openingText.trim()) ? 15 : 0)
  );

  const microHookHits = countMatches(text, MICRO_HOOK_MARKERS).length;
  const questionMarks = (text.match(/\?/g) || []).length;
  const microHookDensity = +((microHookHits + questionMarks) / sentenceCount).toFixed(2);

  const openLoopHits = sentences.filter((s) => OPEN_LOOP_MARKERS.some((m) => new RegExp('\\b' + m + '\\b', 'i').test(s.split(' ').slice(0, 3).join(' ')))).length;

  const firstThirdEmotional = sectionAnalysis[0].emotionalWordCount;
  const lastThirdEmotional = sectionAnalysis[2].emotionalWordCount;
  const escalationDetected = lastThirdEmotional > firstThirdEmotional || countMatches(text, ['even', 'worse', 'larger', 'deeper', 'darker', 'more than']).length >= 2;

  const hasTransformation = /what if|imagine|suppose/i.test(sections.slice(1).map(s => s.sentences.join(' ')).join(' '));

  const lastTwo = sentences.slice(-2).join(' ');
  const hasPayoff = countMatches(lastTwo, PAYOFF_MARKERS).length > 0;
  const hasCTA = countMatches(lastTwo, CTA_MARKERS).length > 0 || countMatches(text, CTA_MARKERS).length > 0;

  const visualMatched = countMatches(text, MARKERS.visual);

  const factDumpSections = sectionAnalysis.filter((s) => s.isFactDumpRisk).map((s) => s.name);
  const predictable = microHookDensity < 0.15 && openLoopHits === 0;

  const dims = {
    openingHook: openingHookScore,
    curiosityGap: clamp(30 + countMatches(text, MARKERS.curiosity).length * 10),
    microHookDensity: clamp(Math.round(microHookDensity * 100)),
    pacing: clamp(100 - Math.max(0, (sectionAnalysis.reduce((a, s) => a + s.avgSentenceLength, 0) / 3 - 12) * 6)),
    escalation: escalationDetected ? 75 : 35,
    hypotheticalTransformation: hasTransformation ? 80 : 30,
    emotionalProgression: lastThirdEmotional >= firstThirdEmotional ? 70 : 40,
    predictabilityRisk: predictable ? 75 : 25, // higher = more predictable = worse
    visualPotential: scoreDimension(visualMatched),
    payoff: hasPayoff ? 80 : 35,
    cta: hasCTA ? 90 : 20,
  };

  const overall = Math.round(
    (dims.openingHook * 0.15 +
      dims.curiosityGap * 0.12 +
      dims.microHookDensity * 0.13 +
      dims.pacing * 0.1 +
      dims.escalation * 0.12 +
      dims.hypotheticalTransformation * 0.1 +
      dims.emotionalProgression * 0.08 +
      (100 - dims.predictabilityRisk) * 0.1 +
      dims.visualPotential * 0.05 +
      dims.payoff * 0.05 +
      dims.cta * 0.05 || 0) * 10
  ) / 10;

  const strongest = sectionAnalysis.reduce((a, b) => (b.hookDensity > a.hookDensity ? b : a), sectionAnalysis[0]);
  const weakest = sectionAnalysis.reduce((a, b) => (b.hookDensity < a.hookDensity ? b : a), sectionAnalysis[0]);

  const durationFlag = estSeconds < 20 ? 'shorter than the 20-45s Shorts range'
    : estSeconds > 45 ? 'longer than the 20-45s Shorts range'
    : (estSeconds < 30 || estSeconds > 40) ? 'outside the 30-40s target but inside the acceptable 20-45s range'
    : 'within the 30-40s target';

  return {
    wordCount: words,
    sentenceCount,
    estimatedSeconds: estSeconds,
    durationFlag,
    sectionAnalysis,
    dims,
    overall,
    factDumpSections,
    predictable,
    hasPayoff,
    hasCTA,
    hasTransformation,
    strongestSection: strongest.name,
    weakestSection: weakest.name,
    microHookDensity,
    openLoopHits,
  };
}

// ---------------------------------------------------------------------
// Forecast Engine
// ---------------------------------------------------------------------
function computeForecast({ topicAnalysis, categoryVideos = [], competitionEstimate = null }) {
  const assumptions = [];
  const positives = [];
  const negatives = [];

  const topicPotential = topicAnalysis.weightedTotal;
  const markieStarFit = topicAnalysis.scores.markieStarFit;
  const visualPotential = topicAnalysis.scores.visualPotential;
  const novelty = topicAnalysis.scores.novelty;
  const hypotheticalPotential = topicAnalysis.scores.hypotheticalPotential;

  let historicalPattern;
  if (categoryVideos.length === 0) {
    historicalPattern = 50;
    assumptions.push('No published videos exist yet in this category — historical pattern set to a neutral midpoint (50), not a measured value.');
  } else {
    const avg = categoryVideos.reduce((a, v) => a + (v.performanceIndex || 0), 0) / categoryVideos.length;
    historicalPattern = clamp(avg);
    positives.push(`Based on ${categoryVideos.length} published video(s) in this category, averaging a performance index of ${avg.toFixed(1)}.`);
  }

  let competition;
  if (competitionEstimate === null || competitionEstimate === undefined || competitionEstimate === '') {
    competition = 50;
    assumptions.push('No competition estimate supplied — set to a neutral midpoint (50). This requires manual judgment or a future web-research integration; it is not measured.');
  } else {
    competition = clamp(Number(competitionEstimate));
  }

  const weighted =
    (topicPotential * FORECAST_WEIGHTS.topicPotential +
      markieStarFit * FORECAST_WEIGHTS.markieStarFit +
      visualPotential * FORECAST_WEIGHTS.visualPotential +
      historicalPattern * FORECAST_WEIGHTS.historicalPattern +
      novelty * FORECAST_WEIGHTS.novelty +
      hypotheticalPotential * FORECAST_WEIGHTS.hypotheticalPotential +
      (100 - competition) * FORECAST_WEIGHTS.competition) /
    100;

  const estimatedPotential = Math.round(weighted * 10) / 10;

  if (topicPotential >= 65) positives.push('Topic Analyzer score is strong on its own merits.');
  if (topicPotential < 45) negatives.push('Topic Analyzer score is weak — the underlying concept may need a stronger angle.');
  if (markieStarFit < 45) negatives.push('Weak fit with the established Markie Star topic universe.');
  if (novelty < 40) negatives.push('Subject overlaps with heavily-covered topics (lower novelty).');

  let confidence = 'Very low';
  const n = categoryVideos.length;
  if (n > 10) confidence = 'Very high';
  else if (n > 5) confidence = 'High';
  else if (n > 2) confidence = 'Medium';
  else if (n > 0) confidence = 'Low';
  // A short/thin topic description caps confidence regardless of history.
  if (topicAnalysis.confidence === 'Low' && confidence !== 'Very low') confidence = 'Low';

  return {
    estimatedPotential,
    confidence,
    positives,
    negatives,
    assumptions,
    breakdown: {
      topicPotential, markieStarFit, visualPotential, historicalPattern, novelty, hypotheticalPotential, competition,
    },
    weights: FORECAST_WEIGHTS,
    dataPoints: n,
  };
}

// ---------------------------------------------------------------------
// Performance Index (for the Performance Tracker)
// ---------------------------------------------------------------------
function computePerformanceMetrics(v) {
  const views = Number(v.views) || 0;
  const likes = Number(v.likes) || 0;
  const comments = Number(v.comments) || 0;
  const shares = Number(v.shares) || 0;
  const subs = Number(v.subsGained) || 0;
  const avgPct = Number(v.avgPercentViewed) || 0;

  const likeRate = views ? (likes / views) * 100 : 0;
  const commentRate = views ? (comments / views) * 100 : 0;
  const shareRate = views ? (shares / views) * 100 : 0;
  const subConversion = views ? (subs / views) * 100 : 0;
  const engagementRate = likeRate + commentRate + shareRate;

  // Normalize each rate against a generous typical ceiling, then blend.
  // These ceilings are documented assumptions, editable in Settings later.
  const normAvgPct = clamp(avgPct); // already 0-100
  const normLike = clamp((likeRate / 10) * 100);
  const normComment = clamp((commentRate / 2) * 100);
  const normShare = clamp((shareRate / 2) * 100);
  const normSub = clamp((subConversion / 5) * 100);

  const performanceIndex = Math.round(
    (normAvgPct * 0.4 + normLike * 0.2 + normComment * 0.15 + normShare * 0.15 + normSub * 0.1) * 10
  ) / 10;

  return { likeRate, commentRate, shareRate, subConversion, engagementRate, performanceIndex };
}

// ---------------------------------------------------------------------
// exports (attach to window — no bundler in this project)
// ---------------------------------------------------------------------
window.Scoring = {
  TOPIC_WEIGHTS,
  FORECAST_WEIGHTS,
  MARKERS,
  calculateTopicScore,
  analyzeTopicText,
  analyzeScript,
  computeForecast,
  computePerformanceMetrics,
  wordCount,
  splitSentences,
  clamp,
};
