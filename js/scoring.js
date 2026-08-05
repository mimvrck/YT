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
// Script Impact Analyzer — V2
// Structural signals are the primary determinant; keyword marker lists (still
// used from MARKERS above) are only ONE input among many for each dimension,
// never the main driver. Nothing here is random.
// ---------------------------------------------------------------------

// Magnitude/scale tiers, smallest to largest — used to detect real escalation
// chains (small -> large, individual -> global, present -> deep future),
// not just the presence of emotionally loaded words.
const MAGNITUDE_TIERS = [
  { tier: 0, words: ['i ', 'you ', 'one person', 'someone', 'a person'] },
  { tier: 1, words: ['room', 'house', 'street', 'building', 'car'] },
  { tier: 2, words: ['city', 'cities', 'highway', 'highways', 'forest', 'forests', 'town'] },
  { tier: 3, words: ['country', 'nation', 'continent', 'region'] },
  { tier: 4, words: ['earth', 'planet', 'world', 'global', 'civilization', 'species'] },
  { tier: 5, words: ['galaxy', 'universe', 'millions of years', 'billions of years', 'cosmic'] },
];
const TIME_MARKERS = /\b(tomorrow|today|tonight|years?|millions of years|billions of years|centuries|decades|one day|eventually|until|days? pass(?:ed)?|months?|then,? )\b/i;
const NEGATION_ANAPHORA = /^(no|not|never)\s+\w+/i;
const CONTRAST_OPENERS = /^(but|however|except|yet|until|then)\b/i;
const INDEFINITE_SUBJECT = /\b(something|somewhere|someone|one species|a species|a creature|some kind of)\b/i;
const HYPOTHETICAL_IMPLICIT = ['disappear', 'disappears', 'disappeared', 'vanish', 'vanishes', 'gone', 'no longer',
  'millions of years', 'billions of years', 'one day', 'eventually', 'becomes', 'begins to', 'starts building',
  'what remains', 'what happens'];
const HYPOTHETICAL_EXPLICIT = ['what if', 'imagine', 'suppose', 'hypothetically'];
const CONCRETE_VISUAL_NOUNS = ['city', 'cities', 'forest', 'forests', 'highway', 'highways', 'ocean', 'building',
  'buildings', 'ruins', 'storm', 'creature', 'creatures', 'structure', 'structures', 'tool', 'tools', 'cave',
  'mountain', 'desert', 'space', 'planet', 'ship', 'tower', 'wall', 'statue', 'skeleton', 'fog', 'smoke', 'fire',
  'ice', 'snow', 'light', 'shadow', 'machine', 'robot', 'darkness'];
const CONNECTIVES = ['but', 'and', 'so', 'then', 'now', 'until', 'however', 'because', 'yet', 'still', 'after that', 'meanwhile'];
const EMOTION_LEXICON = [
  // checked in this priority order — first match wins for a given sentence
  { state: 'fearful', words: ['terrifying', 'horrifying', 'fear', 'afraid', 'danger', 'dangerous'] },
  { state: 'dread', words: ['dread', 'doom', 'inevitable', 'collapse', 'collapses'] },
  { state: 'existential', words: ['gone', 'disappear', 'extinction', 'no longer', 'vanish', 'what remains'] },
  { state: 'uneasy', words: ['strange', 'odd', 'unsettling', 'quiet', 'darkness', 'eerie'] },
  { state: 'awe', words: ['awe', 'incredible', 'vast', 'majestic', 'staggering', 'massive'] },
  { state: 'curious', words: ['question', 'wonder', 'curious', 'why', 'who', 'what species', 'what happens'] },
  { state: 'hopeful', words: ['hope', 'recover', 'rebuild', 'thrive'] },
];

function magnitudeTier(text) {
  const t = text.toLowerCase();
  let max = -1;
  for (const { tier, words } of MAGNITUDE_TIERS) {
    if (words.some((w) => t.includes(w))) max = Math.max(max, tier);
  }
  return max; // -1 = no scale marker found
}
function dominantEmotion(text) {
  const t = text.toLowerCase();
  for (const { state, words } of EMOTION_LEXICON) {
    if (words.some((w) => t.includes(w))) return state;
  }
  return 'neutral';
}
function splitBeats(text) {
  const paragraphs = text.split(/\n\s*\n+/).map((p) => p.replace(/\n/g, ' ').trim()).filter(Boolean);
  if (paragraphs.length >= 3) return paragraphs;
  // No blank-line structure to lean on — fall back to short sentence-pair grouping.
  const sents = splitSentences(text);
  const beats = [];
  for (let i = 0; i < sents.length; i += 2) beats.push(sents.slice(i, i + 2).join(' '));
  return beats.length ? beats : [text];
}

function analyzeScript(scriptText) {
  const text = (scriptText || '').trim();
  const words = wordCount(text);
  const sentences = splitSentences(text);
  const sentenceCount = sentences.length || 1;
  const estSeconds = Math.round((words / 150) * 60); // ~150 wpm spoken narration

  const beatTexts = splitBeats(text);
  let prevTier = -1;
  const beats = beatTexts.map((beatText, idx) => {
    const isFirst = idx === 0;
    const isLast = idx === beatTexts.length - 1;
    const beatSentences = splitSentences(beatText);
    const hasQuestion = beatText.includes('?');
    const tier = magnitudeTier(beatText);
    const escalates = tier > prevTier && prevTier >= 0;
    const escalationStatus = isFirst ? 'N/A' : (tier < 0 ? 'Flat' : escalates ? 'Escalates' : 'Maintains');
    if (tier >= 0) prevTier = tier;

    const isPatternInterruption = beatSentences.some((s) => NEGATION_ANAPHORA.test(s.trim())) || CONTRAST_OPENERS.test(beatText.trim());
    const hasTimeMarker = TIME_MARKERS.test(beatText);
    const payoffLike = countMatches(beatText, PAYOFF_MARKERS).length > 0;

    let fn = 'Consequence';
    if (isLast && (hasQuestion || payoffLike)) fn = 'Payoff / Final Question';
    else if (hasQuestion) fn = 'Question';
    else if (isFirst) fn = 'Premise';
    else if (isPatternInterruption) fn = 'Pattern Interruption';
    else if (hasTimeMarker) fn = 'Time Progression';
    else if (escalates) fn = 'Escalation';

    const curiosityHits = countMatches(beatText, MARKERS.curiosity).length;
    const openLoopLocal = (beatText.match(/\.\.\./g) || []).length + (INDEFINITE_SUBJECT.test(beatText) ? 1 : 0);
    const hookStrength = clamp(30 + curiosityHits * 12 + (hasQuestion ? 20 : 0) + openLoopLocal * 12 + (isPatternInterruption ? 10 : 0));
    const visualHits = countMatches(beatText, CONCRETE_VISUAL_NOUNS).length;
    const visualOpportunity = clamp(20 + visualHits * 18 + (tier >= 0 ? 10 : 0));
    const curiosityStatus = (hasQuestion || openLoopLocal > 0 || INDEFINITE_SUBJECT.test(beatText)) ? 'Open' : (payoffLike ? 'Resolved' : 'Neutral');

    return { text: beatText, function: fn, hookStrength, visualOpportunity, curiosityStatus, escalationStatus, magnitudeTier: tier };
  });

  // --- Opening hook (first 1-3 seconds, evaluated on its own) ------------
  const openingBeat = beats[0] || { text: sentences[0] || '' };
  const openingText = openingBeat.text;
  const openingSentence = splitSentences(openingText)[0] || openingText;
  const openingHasImplicitHypothetical = countMatches(openingSentence, HYPOTHETICAL_IMPLICIT).length > 0;
  const openingHasExplicitHypothetical = countMatches(openingSentence, HYPOTHETICAL_EXPLICIT).length > 0;
  const openingIsShortPunchy = wordCount(openingSentence) <= 8 && wordCount(openingSentence) >= 2;
  const openingHookScore = clamp(
    35
    + countMatches(openingText, MARKERS.curiosity).length * 10
    + (openingText.includes('?') ? 12 : 0)
    + (openingHasExplicitHypothetical ? 20 : 0)
    + (openingHasImplicitHypothetical ? 20 : 0)
    + (openingIsShortPunchy ? 15 : 0)
  );

  // --- Curiosity gap: unresolved information the viewer is left holding ---
  const openLoopBeats = beats.filter((b) => b.curiosityStatus === 'Open').length;
  const curiosityGapScore = clamp(28 + openLoopBeats * 11 + countMatches(text, MARKERS.curiosity).length * 6);

  // --- Micro-hook density: narrative beats, not just marker phrases -------
  const microHookMarkerHits = countMatches(text, MICRO_HOOK_MARKERS).length;
  const questionMarks = (text.match(/\?/g) || []).length;
  const structuralBeatHooks = beats.filter((b) => ['Pattern Interruption', 'Escalation', 'Time Progression', 'Question', 'Payoff / Final Question'].includes(b.function)).length;
  const microHookDensity = +((microHookMarkerHits + questionMarks + structuralBeatHooks) / beatTexts.length).toFixed(2);
  const microHookDensityScore = clamp(Math.round(microHookDensity * 55));

  // --- Pacing: sentence-length variation and short-sentence clusters ------
  const sentenceLens = sentences.map((s) => wordCount(s));
  const avgLen = sentenceLens.reduce((a, b) => a + b, 0) / sentenceCount;
  const variance = sentenceLens.reduce((a, l) => a + (l - avgLen) ** 2, 0) / sentenceCount;
  const stdDev = Math.sqrt(variance);
  let shortClusterCount = 0;
  let runLen = 0;
  for (const l of sentenceLens) {
    if (l <= 5) { runLen++; if (runLen === 2) shortClusterCount++; } else runLen = 0;
  }
  const denseZones = sentenceLens.filter((l) => l > 22).length;
  const pacingScore = clamp(45 + Math.min(stdDev, 12) * 3 + shortClusterCount * 8 - denseZones * 10);

  // --- Escalation: conceptual scale/time progression, not emotion words ---
  const tiersTouched = new Set(beats.map((b) => b.magnitudeTier).filter((t) => t >= 0));
  const escalatingBeats = beats.filter((b) => b.escalationStatus === 'Escalates').length;
  const timeJumpCount = beats.filter((b) => TIME_MARKERS.test(b.text)).length;
  const escalationScore = clamp(25 + escalatingBeats * 16 + Math.min(tiersTouched.size, 5) * 8 + timeJumpCount * 5);

  // --- Hypothetical transformation: implicit counterfactuals count too ----
  const explicitHypoHits = countMatches(text, HYPOTHETICAL_EXPLICIT).length;
  const implicitHypoHits = countMatches(text, HYPOTHETICAL_IMPLICIT).length;
  const hypotheticalScore = clamp(25 + explicitHypoHits * 14 + implicitHypoHits * 9);

  // --- Emotional progression: track state changes, not just word counts --
  const emotionSequence = sentences.map(dominantEmotion);
  const distinctEmotions = new Set(emotionSequence.filter((e) => e !== 'neutral'));
  const endsOnStrongState = ['existential', 'awe', 'curious', 'dread'].includes(emotionSequence[emotionSequence.length - 1]);
  const stayedFlatNeutral = distinctEmotions.size === 0;
  const emotionalProgressionScore = stayedFlatNeutral ? 30 : clamp(35 + distinctEmotions.size * 12 + (endsOnStrongState ? 15 : 0));

  // --- Predictability risk (higher = more predictable = worse) -----------
  const predictable = microHookDensity < 0.4 && openLoopBeats === 0 && distinctEmotions.size <= 1;
  const predictabilityRisk = predictable ? 72 : clamp(20 + Math.max(0, 3 - structuralBeatHooks) * 8);

  // --- Visual potential: variety of concrete, filmable scenes -------------
  const visualNounHits = countMatches(text, CONCRETE_VISUAL_NOUNS);
  const distinctVisualNouns = new Set(visualNounHits);
  const visualPotentialScore = clamp(25 + distinctVisualNouns.size * 9 + tiersTouched.size * 6 + timeJumpCount * 4);

  // --- Payoff: final answer, final question, revelation, or twist ---------
  const lastBeat = beats[beats.length - 1];
  const hasPayoff = lastBeat && (lastBeat.function === 'Payoff / Final Question' || countMatches(lastBeat.text, PAYOFF_MARKERS).length > 0 || lastBeat.text.includes('?'));
  const payoffScore = hasPayoff ? clamp(65 + (lastBeat.text.includes('?') ? 15 : 0) + (countMatches(lastBeat.text, PAYOFF_MARKERS).length ? 10 : 0)) : 35;

  // --- CTA: optional, never auto-penalized for being absent ---------------
  const hasCTA = countMatches(text, CTA_MARKERS).length > 0;
  let ctaScore, ctaRecommendation;
  if (hasCTA) { ctaScore = 85; ctaRecommendation = 'CTA detected — keep it brief so it doesn\u2019t undercut the final beat.'; }
  else if (payoffScore >= 65) { ctaScore = 70; ctaRecommendation = 'No CTA required. The final question/payoff functions as the engagement mechanism.'; }
  else { ctaScore = 45; ctaRecommendation = 'The ending doesn\u2019t carry strong engagement on its own — consider a light CTA or strengthening the payoff instead.'; }

  // --- New V2 dimensions ---------------------------------------------------
  const connectiveSentences = sentences.filter((s) => CONNECTIVES.some((c) => new RegExp('\\b' + c + '\\b', 'i').test(s))).length;
  const narrativeCoherenceScore = clamp(35 + (connectiveSentences / sentenceCount) * 65);

  const concreteSentences = sentences.filter((s) => countMatches(s, CONCRETE_VISUAL_NOUNS).length > 0 || magnitudeTier(s) >= 0).length;
  const conceptClarityScore = clamp(30 + (concreteSentences / sentenceCount) * 70);

  const informationDensityScore = clamp(100 - Math.max(0, avgLen - 14) * 5); // lower avg length = higher score (denser long sentences read as fact-dumpy)

  const openLoopMarkerHits = (text.match(/\.\.\./g) || []).length + sentences.filter((s) => INDEFINITE_SUBJECT.test(s)).length;
  const openLoopStrengthScore = clamp(25 + (openLoopMarkerHits / sentenceCount) * 220);

  const endingStrengthScore = clamp(payoffScore * 0.5 + (lastBeat && lastBeat.magnitudeTier >= 0 ? Math.min(lastBeat.magnitudeTier, 5) * 8 : 0) + (lastBeat && lastBeat.text.includes('?') ? 20 : 0));

  const dims = {
    openingHook: openingHookScore,
    curiosityGap: curiosityGapScore,
    microHookDensity: microHookDensityScore,
    pacing: pacingScore,
    escalation: escalationScore,
    hypotheticalTransformation: hypotheticalScore,
    emotionalProgression: emotionalProgressionScore,
    predictabilityRisk,
    visualPotential: visualPotentialScore,
    payoff: payoffScore,
    cta: ctaScore,
    narrativeCoherence: narrativeCoherenceScore,
    conceptClarity: conceptClarityScore,
    informationDensity: informationDensityScore,
    openLoopStrength: openLoopStrengthScore,
    endingStrength: endingStrengthScore,
  };

  // Mathematically transparent overall score: fixed weights that sum to 1,
  // CTA capped low so one missing (optional) CTA can't sink a strong script.
  const OVERALL_WEIGHTS = {
    openingHook: 0.13, curiosityGap: 0.09, microHookDensity: 0.09, pacing: 0.07, escalation: 0.11,
    hypotheticalTransformation: 0.08, emotionalProgression: 0.06, predictabilityRiskInverse: 0.06,
    visualPotential: 0.06, payoff: 0.08, cta: 0.03, narrativeCoherence: 0.05, conceptClarity: 0.04,
    informationDensity: 0.02, openLoopStrength: 0.02, endingStrength: 0.01,
  };
  const overall = Math.round((
    dims.openingHook * OVERALL_WEIGHTS.openingHook +
    dims.curiosityGap * OVERALL_WEIGHTS.curiosityGap +
    dims.microHookDensity * OVERALL_WEIGHTS.microHookDensity +
    dims.pacing * OVERALL_WEIGHTS.pacing +
    dims.escalation * OVERALL_WEIGHTS.escalation +
    dims.hypotheticalTransformation * OVERALL_WEIGHTS.hypotheticalTransformation +
    dims.emotionalProgression * OVERALL_WEIGHTS.emotionalProgression +
    (100 - dims.predictabilityRisk) * OVERALL_WEIGHTS.predictabilityRiskInverse +
    dims.visualPotential * OVERALL_WEIGHTS.visualPotential +
    dims.payoff * OVERALL_WEIGHTS.payoff +
    dims.cta * OVERALL_WEIGHTS.cta +
    dims.narrativeCoherence * OVERALL_WEIGHTS.narrativeCoherence +
    dims.conceptClarity * OVERALL_WEIGHTS.conceptClarity +
    dims.informationDensity * OVERALL_WEIGHTS.informationDensity +
    dims.openLoopStrength * OVERALL_WEIGHTS.openLoopStrength +
    dims.endingStrength * OVERALL_WEIGHTS.endingStrength
  ) * 10) / 10;

  const strongestBeat = beats.reduce((a, b) => (b.hookStrength > a.hookStrength ? b : a), beats[0]);
  const weakestBeat = beats.reduce((a, b) => (b.hookStrength < a.hookStrength ? b : a), beats[0]);
  const factDumpBeats = beats.filter((b) => wordCount(b.text) > 30 && b.hookStrength < 45).map((b) => b.text.slice(0, 40) + (b.text.length > 40 ? '…' : ''));

  const durationFlag = estSeconds < 20 ? 'shorter than the 20-45s Shorts range'
    : estSeconds > 45 ? 'longer than the 20-45s Shorts range'
    : (estSeconds < 30 || estSeconds > 40) ? 'outside the 30-40s target but inside the acceptable 20-45s range'
    : 'within the 30-40s target';

  return {
    wordCount: words,
    sentenceCount,
    estimatedSeconds: estSeconds,
    durationFlag,
    beats,
    dims,
    overall,
    factDumpSections: factDumpBeats,
    predictable,
    hasPayoff,
    hasCTA,
    ctaRecommendation,
    hasTransformation: explicitHypoHits > 0 || implicitHypoHits > 0,
    strongestSection: (strongestBeat.text || '').slice(0, 48) + ((strongestBeat.text || '').length > 48 ? '…' : ''),
    weakestSection: (weakestBeat.text || '').slice(0, 48) + ((weakestBeat.text || '').length > 48 ? '…' : ''),
    microHookDensity,
    openLoopHits: openLoopBeats,
    emotionSequence,
    distinctEmotionCount: distinctEmotions.size,
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
