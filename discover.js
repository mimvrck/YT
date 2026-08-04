/* discover.js
   Local, rule-based idea generation across the full Markie Star idea universe.
   No external API, no live trend data, no scores from a model.

   ARCHITECTURE (five stages, per the Markie Star upgrade spec):
     Stage 1  Idea generation      - seed subjects, single-subject transformations,
                                      AND cross-category concept combinations, so the
                                      idea space is far larger than subjects x moves.
     Stage 2  Quality filter       - normalize + fingerprint each candidate, drop
                                      duplicates/near-duplicates and anything already
                                      shown recently.
     Stage 3  Unified scoring      - every surviving candidate is scored by the exact
                                      same window.Scoring.calculateTopicScore() used by
                                      Topic Analyzer. There is no separate Discover score.
     Stage 4  Forecast             - channel-specific forecast is computed separately
                                      from intrinsic topic potential, using the same
                                      Scoring.computeForecast() Topic Analyzer uses.
     Stage 5  Ranking + diversity  - mode-specific ranking over the unified dimension
                                      scores, plus category/recency diversity control.

   The seed subject list below may keep growing over time, and future live sources
   (RSS, etc.) can feed the exact same pipeline starting at Stage 2 - see
   normalizeAndScoreExternalCandidate() at the bottom, which is unused today but is
   the integration point for that, so it's ready without pretending it's live now.
*/

// ---------------------------------------------------------------------
// Stage 1a - seed subject universe (expandable; NOT a hard limit - see Stage 1b)
// ---------------------------------------------------------------------
// status is one of the eight Markie Star "reality status" values. It is purely
// editorial (shown on the card) and never feeds the score.
const SEED_SUBJECTS = [
  // Ocean & deep-sea
  { name: 'a giant squid sighting', category: 'Ocean & deep-sea', status: 'Real event', visual: 'high', tags: ['ocean', 'animal', 'biology'] },
  { name: 'an unexplained deep-sea glow filmed by a submersible', category: 'Ocean & deep-sea', status: 'Unverified claim', visual: 'high', tags: ['ocean', 'phenomenon'] },
  { name: 'a brittle star mass stranding', category: 'Ocean & deep-sea', status: 'Verified fact', visual: 'high', tags: ['ocean', 'animal', 'biology'] },
  { name: 'a sound recorded from the deep ocean with no confirmed source', category: 'Ocean & deep-sea', status: 'Verified fact', visual: 'medium', tags: ['ocean', 'phenomenon', 'mystery'] },
  { name: 'a hydrothermal vent ecosystem with no sunlight', category: 'Ocean & deep-sea', status: 'Verified fact', visual: 'high', tags: ['ocean', 'biology', 'extreme'] },

  // Atmospheric & sky phenomena
  { name: 'red sprites flashing above a thunderstorm', category: 'Atmospheric & sky phenomena', status: 'Verified fact', visual: 'high', tags: ['atmospheric', 'phenomenon'] },
  { name: 'a green sky reported before a storm', category: 'Atmospheric & sky phenomena', status: 'Unverified claim', visual: 'medium', tags: ['atmospheric', 'phenomenon'] },
  { name: 'a cloud that behaves like it is flowing as a liquid', category: 'Atmospheric & sky phenomena', status: 'Unverified claim', visual: 'high', tags: ['atmospheric', 'phenomenon'] },
  { name: 'a sky glow with no confirmed cause reported over a city', category: 'Atmospheric & sky phenomena', status: 'Unverified claim', visual: 'medium', tags: ['atmospheric', 'phenomenon'] },

  // Historical mysteries
  { name: 'a Cold War iron lung ward', category: 'Historical mysteries', status: 'Verified fact', visual: 'medium', tags: ['historical'] },
  { name: 'an abandoned Soviet research station', category: 'Historical mysteries', status: 'Real event', visual: 'medium', tags: ['historical'] },
  { name: 'a declassified military experiment', category: 'Historical mysteries', status: 'Real event', visual: 'medium', tags: ['historical', 'conspiracy'] },
  { name: 'a sealed government archive from a past decade', category: 'Historical mysteries', status: 'Real event', visual: 'medium', tags: ['historical', 'conspiracy'] },

  // Ancient mysteries
  { name: 'a forgotten ancient burial site', category: 'Ancient mysteries', status: 'Verified fact', visual: 'medium', tags: ['ancient', 'historical'] },
  { name: 'an ancient structure whose construction method is still debated', category: 'Ancient mysteries', status: 'Scientific hypothesis', visual: 'high', tags: ['ancient'] },
  { name: 'a lost script that has never been translated', category: 'Ancient mysteries', status: 'Verified fact', visual: 'medium', tags: ['ancient', 'mystery'] },

  // Strange science & discoveries
  { name: 'what actually happens inside a particle collider', category: 'Strange science & discoveries', status: 'Verified fact', visual: 'medium', tags: ['science', 'physics'] },
  { name: 'a material that behaves differently than physics predicts', category: 'Strange science & discoveries', status: 'Scientific hypothesis', visual: 'medium', tags: ['science', 'physics'] },
  { name: 'a newly identified extremophile organism', category: 'Strange science & discoveries', status: 'Verified fact', visual: 'high', tags: ['science', 'biology', 'extreme'] },

  // Psychology & human behavior
  { name: 'a psychological effect that alters memory', category: 'Psychology & human behavior', status: 'Verified fact', visual: 'low', tags: ['psychology'] },
  { name: 'a documented case of mass shared delusion', category: 'Psychology & human behavior', status: 'Verified fact', visual: 'low', tags: ['psychology'] },
  { name: 'the psychology behind why people believe unverifiable claims', category: 'Psychology & human behavior', status: 'Verified fact', visual: 'low', tags: ['psychology'] },

  // Evolution & extinction
  { name: 'an extinction-level event humanity narrowly avoided', category: 'Evolution & extinction', status: 'Verified fact', visual: 'medium', tags: ['extinction', 'evolution'] },
  { name: 'what replaces humans if we vanished tomorrow', category: 'Evolution & extinction', status: 'Hypothetical scenario', visual: 'high', tags: ['extinction', 'evolution', 'future'] },
  { name: 'an octopus solving a human-designed puzzle', category: 'Evolution & extinction', status: 'Verified fact', visual: 'high', tags: ['evolution', 'biology', 'animal'] },
  { name: 'a fungus that controls insect behavior', category: 'Evolution & extinction', status: 'Verified fact', visual: 'high', tags: ['evolution', 'biology', 'animal'] },

  // Future civilization
  { name: 'what a city might look like in 300 years', category: 'Future civilization', status: 'Hypothetical scenario', visual: 'high', tags: ['future'] },
  { name: 'what future archaeologists might misunderstand about us', category: 'Future civilization', status: 'Hypothetical scenario', visual: 'medium', tags: ['future', 'historical'] },

  // Cryptids & folklore
  { name: 'a cryptid sighting caught on a trail cam', category: 'Cryptids & folklore', status: 'Unverified claim', visual: 'high', tags: ['cryptid', 'folklore'] },
  { name: 'a myth about a being that lives underground', category: 'Cryptids & folklore', status: 'Myth or folklore', visual: 'medium', tags: ['cryptid', 'myth', 'folklore'] },
  { name: 'a lake said to hold something no one has confirmed', category: 'Cryptids & folklore', status: 'Myth or folklore', visual: 'medium', tags: ['cryptid', 'myth'] },

  // Myths & legends
  { name: 'a flood myth that appears across unrelated cultures', category: 'Myths & legends', status: 'Myth or folklore', visual: 'medium', tags: ['myth', 'historical'] },
  { name: 'a legendary lost city said to have sunk', category: 'Myths & legends', status: 'Myth or folklore', visual: 'high', tags: ['myth', 'ancient'] },

  // Urban legends
  { name: 'an urban legend that keeps resurfacing online', category: 'Urban legends', status: 'Myth or folklore', visual: 'low', tags: ['urbanlegend', 'internet'] },
  { name: 'a local legend tied to an abandoned building', category: 'Urban legends', status: 'Myth or folklore', visual: 'medium', tags: ['urbanlegend'] },

  // Internet & deep-web mysteries
  { name: 'a viral deep-web video everyone is discussing', category: 'Internet & deep-web mysteries', status: 'Unverified claim', visual: 'medium', tags: ['deepweb', 'internet', 'mystery'] },
  { name: 'an internet forum\u2019s unsolved cold case', category: 'Internet & deep-web mysteries', status: 'Real event', visual: 'low', tags: ['internet', 'mystery'] },
  { name: 'a channel that vanished after posting one strange upload', category: 'Internet & deep-web mysteries', status: 'Unverified claim', visual: 'low', tags: ['deepweb', 'internet'] },

  // Strange news & real events
  { name: 'a strange news report that never got a follow-up', category: 'Strange news & real events', status: 'Real event', visual: 'medium', tags: ['news'] },
  { name: 'an unexplained mass event reported by dozens of witnesses', category: 'Strange news & real events', status: 'Unverified claim', visual: 'medium', tags: ['news', 'mystery'] },

  // UFO & alien claims
  { name: 'the Buga sphere object', category: 'UFO & alien claims', status: 'Unverified claim', visual: 'medium', tags: ['ufo', 'alien'] },
  { name: 'a declassified military UAP sighting report', category: 'UFO & alien claims', status: 'Real event', visual: 'medium', tags: ['ufo', 'alien', 'conspiracy'] },

  // Space & cosmic
  { name: 'the Great Attractor pulling galaxies across the universe', category: 'Space & cosmic', status: 'Scientific hypothesis', visual: 'high', tags: ['space', 'physics'] },
  { name: 'a black hole passing near the solar system', category: 'Space & cosmic', status: 'Hypothetical scenario', visual: 'high', tags: ['space', 'physics'] },
  { name: 'a newly confirmed exoplanet in a star\u2019s habitable zone', category: 'Space & cosmic', status: 'Verified fact', visual: 'high', tags: ['space'] },
  { name: 'an interstellar object passing through our solar system', category: 'Space & cosmic', status: 'Verified fact', visual: 'high', tags: ['space', 'mystery'] },

  // Extreme environments & biology
  { name: 'an organism that survives near-total dehydration', category: 'Extreme environments & biology', status: 'Verified fact', visual: 'high', tags: ['extreme', 'biology', 'animal'] },
  { name: 'a cave ecosystem sealed off for millions of years', category: 'Extreme environments & biology', status: 'Verified fact', visual: 'high', tags: ['extreme', 'biology'] },

  // Conspiracy claims (clearly labeled as claims)
  { name: 'a claimed cover-up around a public research program', category: 'Conspiracy claims', status: 'Unverified claim', visual: 'low', tags: ['conspiracy'] },
  { name: 'a whistleblower account that was never independently confirmed', category: 'Conspiracy claims', status: 'Unverified claim', visual: 'low', tags: ['conspiracy'] },

  // Horror & analog horror
  { name: 'an analog horror-style broadcast interruption concept', category: 'Horror & analog horror', status: 'Fiction', visual: 'high', tags: ['horror', 'fiction'] },
  { name: 'a found-footage tape with an unexplained gap', category: 'Horror & analog horror', status: 'Fiction', visual: 'high', tags: ['horror', 'fiction'] },

  // SCP-style & fictional creatures
  { name: 'an SCP-style containment scenario', category: 'SCP-style & fictional creatures', status: 'Fiction', visual: 'high', tags: ['horror', 'fiction', 'scp'] },
  { name: 'a fictional creature that breaks its own containment rules', category: 'SCP-style & fictional creatures', status: 'Fiction', visual: 'high', tags: ['fiction', 'scp'] },

  // Games & fictional worlds
  { name: 'a game creature with a wildly exaggerated biological ability', category: 'Games & fictional worlds', status: 'Fiction', visual: 'high', tags: ['game', 'fiction'] },
  { name: 'a video game world with impossible physics', category: 'Games & fictional worlds', status: 'Fiction', visual: 'high', tags: ['game', 'fiction', 'physics'] },

  // Movies & pop culture
  { name: 'a monster from a Godzilla-style film', category: 'Movies & pop culture', status: 'Fiction', visual: 'high', tags: ['movie', 'fiction'] },
  { name: 'a classic movie monster\u2019s design compared to real biology', category: 'Movies & pop culture', status: 'Fiction', visual: 'high', tags: ['movie', 'fiction', 'biology'] },

  // Technology & AI
  { name: 'an AI system that starts making its own decisions', category: 'Technology & AI', status: 'Hypothetical scenario', visual: 'medium', tags: ['ai', 'technology'] },
  { name: 'a robot designed to operate somewhere humans cannot survive', category: 'Technology & AI', status: 'Real event', visual: 'medium', tags: ['ai', 'technology', 'extreme'] },

  // Alternate dimensions & parallel universes
  { name: 'a parallel dimension bleeding into ours', category: 'Alternate dimensions & parallel universes', status: 'Hypothetical scenario', visual: 'high', tags: ['dimension', 'physics'] },
  { name: 'the many-worlds interpretation of quantum mechanics', category: 'Alternate dimensions & parallel universes', status: 'Scientific hypothesis', visual: 'medium', tags: ['dimension', 'physics', 'science'] },

  // Time travel & alternate history
  { name: 'a time traveler\u2019s account that has never been verified', category: 'Time travel & alternate history', status: 'Unverified claim', visual: 'medium', tags: ['time', 'mystery'] },
  { name: 'a historical event that could have gone a completely different way', category: 'Time travel & alternate history', status: 'Hypothetical scenario', visual: 'medium', tags: ['time', 'historical'] },

  // Extreme physics & impossible scenarios
  { name: 'what happens to matter at absolute zero', category: 'Extreme physics & impossible scenarios', status: 'Verified fact', visual: 'medium', tags: ['physics', 'science'] },
  { name: 'a hypothetical particle that could travel faster than light', category: 'Extreme physics & impossible scenarios', status: 'Scientific hypothesis', visual: 'medium', tags: ['physics', 'science'] },

  // Survival & what-if scenarios
  { name: 'what it would actually take to survive a total blackout', category: 'Survival & what-if scenarios', status: 'Hypothetical scenario', visual: 'medium', tags: ['survival'] },
  { name: 'a real account of survival in an extreme, hostile environment', category: 'Survival & what-if scenarios', status: 'Real event', visual: 'high', tags: ['survival', 'extreme'] },
];

// ---------------------------------------------------------------------
// Stage 1a - single-subject transformation moves
// ---------------------------------------------------------------------
const TRANSFORMATIONS = [
  { id: 'scale_up', label: 'Scale increase', hook: (s) => `What if ${s} was 20 times larger than reported?` },
  { id: 'scale_down', label: 'Scale decrease', hook: (s) => `What if ${s} happened at a microscopic scale instead?` },
  { id: 'no_humans', label: 'Remove humans', hook: (s) => `What would happen to ${s} if humans were no longer around to explain it?` },
  { id: 'evolution', label: 'Introduce evolution', hook: (s) => `What if ${s} is only the early stage of something still evolving?` },
  { id: 'environment', label: 'Change the environment', hook: (s) => `What if ${s} happened somewhere no one expects?` },
  { id: 'survival', label: 'Survival scenario', hook: (s) => `Could you actually survive if you encountered ${s} yourself?` },
  { id: 'worst_case', label: 'Worst-case escalation', hook: (s) => `What is the worst-case version of ${s}?` },
  { id: 'alt_history', label: 'Alternative history', hook: (s) => `What if ${s} had been discovered a century earlier?` },
  { id: 'fiction_real', label: 'Fiction becoming real', hook: (s) => `What if ${s} turned out to be exactly what fiction has been describing?` },
  { id: 'extreme', label: 'Push to an impossible extreme', hook: (s) => `What is the most extreme version of ${s} that could theoretically exist?` },
  { id: 'thought_experiment', label: 'Scientific thought experiment', hook: (s) => `Is there a scientific explanation for ${s}, or does it break what we think we know?` },
  { id: 'reverse', label: 'Reverse the premise', hook: (s) => `What if the opposite of ${s} turned out to be true instead?` },
  { id: 'hidden_cost', label: 'Hidden cost', hook: (s) => `What would it actually cost us if ${s} were confirmed true?` },
  { id: 'personify', label: 'First-person experience', hook: (s) => `What would it actually be like to experience ${s} firsthand?` },
  { id: 'disprove', label: 'Attempt to disprove', hook: (s) => `What would it take to definitively disprove ${s}?` },
  { id: 'compress_time', label: 'Compress the timeline', hook: (s) => `What if ${s} happened over a single day instead of years?` },
  { id: 'sensory', label: 'Sensory close-up', hook: (s) => `What would ${s} actually look, sound, or feel like up close?` },
  { id: 'legacy', label: 'Long-term legacy', hook: (s) => `What would ${s} mean for the next hundred years?` },
  { id: 'connect_viewer', label: 'Connect to the viewer', hook: (s) => `Could something like ${s} be happening right now, unnoticed?` },
  { id: 'institutional', label: 'Institutional motive', hook: (s) => `Why would official institutions have a reason to stay quiet about ${s}?` },
  { id: 'cosmic_scale', label: 'Compare at cosmic scale', hook: (s) => `How would ${s} compare if it happened on a planetary or cosmic scale?` },
  { id: 'unrelated_link', label: 'Unexpected connection', hook: (s) => `What if ${s} was quietly connected to something completely unrelated?` },
];

// ---------------------------------------------------------------------
// Stage 1a - cross-category concept combinations
// ---------------------------------------------------------------------
// Each template declares which kinds of subjects it meaningfully connects
// (via .applies), so combinations produce a coherent premise instead of a
// word-salad concatenation. If nothing more specific applies, GENERIC_COMBINATION
// is used as a safe, always-coherent fallback.
const COMBINATION_TEMPLATES = [
  {
    id: 'extinction_evolution',
    label: 'Extinction -> evolution',
    applies: (a, b) => a.tags.includes('extinction') && (b.tags.includes('evolution') || b.tags.includes('biology')),
    hook: (a, b) => `If ${a.name} marked the end of one era, what kind of species could eventually rise to fill the gap \u2014 the way ${b.name} shows evolution can reshape a lineage surprisingly fast?`,
  },
  {
    id: 'fiction_biology',
    label: 'Fiction -> real biology',
    applies: (a, b) => (a.tags.includes('game') || a.tags.includes('fiction')) && b.tags.includes('biology'),
    hook: (a, b) => `What if the exaggerated ability behind ${a.name} was actually biologically possible \u2014 the way ${b.name} already comes close to it in the real world?`,
  },
  {
    id: 'deepweb_hypothetical',
    label: 'Deep-web claim -> hypothetical',
    applies: (a) => a.tags.includes('deepweb') || a.tags.includes('internet'),
    hook: (a, b) => `What if ${a.name}, widely dismissed as fake, actually pointed toward something like ${b.name} being real after all?`,
  },
  {
    id: 'myth_evolution',
    label: 'Mythology -> evolution',
    applies: (a, b) => (a.tags.includes('myth') || a.tags.includes('folklore') || a.tags.includes('cryptid')) && (b.tags.includes('evolution') || b.tags.includes('biology')),
    hook: (a, b) => `Could a creature resembling ${a.name} ever plausibly evolve, given what ${b.name} shows about how far evolution can stretch a body plan?`,
  },
  {
    id: 'ai_historical',
    label: 'AI pattern-finding -> history',
    applies: (a, b) => a.tags.includes('ai') && (b.tags.includes('historical') || b.tags.includes('ancient')),
    hook: (a, b) => `If a system like ${a.name} was pointed at ${b.name}, what pattern might it surface that historians have missed?`,
  },
  {
    id: 'space_psychology',
    label: 'Cosmic event -> human mind',
    applies: (a, b) => a.tags.includes('space') && b.tags.includes('psychology'),
    hook: (a, b) => `What would ${a.name} actually do to the human mind, given what we already know from ${b.name}?`,
  },
  {
    id: 'cryptid_science',
    label: 'Cryptid claim -> scientific test',
    applies: (a, b) => a.tags.includes('cryptid') && (b.tags.includes('science') || b.tags.includes('biology')),
    hook: (a, b) => `If ${a.name} were ever confirmed, would ${b.name} actually make it biologically plausible \u2014 or rule it out completely?`,
  },
  {
    id: 'time_historical',
    label: 'Time travel -> historical record',
    applies: (a, b) => a.tags.includes('time') && (b.tags.includes('historical') || b.tags.includes('ancient')),
    hook: (a, b) => `If someone could step directly into ${b.name}, would it confirm or completely contradict what we assume from ${a.name}?`,
  },
  {
    id: 'conspiracy_historical',
    label: 'Conspiracy claim -> declassified record',
    applies: (a, b) => a.tags.includes('conspiracy') && b.tags.includes('historical'),
    hook: (a, b) => `Does ${b.name} actually lend evidence to the claims around ${a.name} \u2014 or does it undercut them?`,
  },
  {
    id: 'dimension_physics',
    label: 'Alternate dimension -> physics rules',
    applies: (a, b) => a.tags.includes('dimension') && b.tags.includes('physics'),
    hook: (a, b) => `If ${a.name} were real, would it have to obey the same rules as ${b.name} \u2014 or could it break them entirely?`,
  },
  {
    id: 'phenomenon_amplify',
    label: 'Real phenomenon -> extreme escalation',
    applies: (a) => a.tags.includes('phenomenon') || a.tags.includes('extreme'),
    hook: (a, b) => `What would happen if ${a.name} became a hundred times stronger \u2014 and does ${b.name} hint at what that might actually look like?`,
  },
];
const GENERIC_COMBINATION = {
  id: 'generic_link',
  label: 'Unexpected cross-category link',
  hook: (a, b) => `What if ${a.name} turned out to be connected to ${b.name} in a way nobody has seriously considered?`,
};

// ---------------------------------------------------------------------
// Opening hook / escalation line banks (presentation only, not scoring)
// ---------------------------------------------------------------------
const OPENING_HOOK_LINES = [
  (s) => `Nobody can fully explain ${s}.`,
  (s) => `Here's something most people have never heard about ${s}.`,
  (s) => `This sounds impossible \u2014 until you look at what's actually documented about ${s}.`,
  (s) => `What if everything you assumed about ${s} was wrong?`,
  (s) => `This is the part of ${s} that almost never gets mentioned.`,
];
const ESCALATION_LINES = [
  () => `Now push it further: what if this wasn't a one-time event, but something still happening?`,
  () => `Take it one step further \u2014 what would it mean if this turned out to be common rather than rare?`,
  () => `And if that's true, the next question is even stranger: what happens if it keeps escalating?`,
  () => `The natural follow-up: what would the most extreme, still-plausible version of this look like?`,
];
const FAIL_REASONS = {
  curiosity: 'The premise may not create enough of an open question to pull viewers in on its own.',
  mystery: 'There may not be enough genuinely unexplained element here \u2014 it could read as already settled.',
  visualPotential: 'Footage or visuals may be hard to source or convincingly recreate for this one.',
  hypotheticalPotential: 'The hypothetical turn may feel thin without a stronger, more specific escalation.',
  emotionalImpact: 'This angle may land as informative rather than genuinely gripping.',
  novelty: 'This subject, or something very close to it, has likely been covered heavily already.',
  explanationPotential: 'There may not be enough real evidence or explanation to build toward a payoff.',
  markieStarFit: 'This may sit slightly outside the core Markie Star idea universe and need a sharper angle.',
};

// ---------------------------------------------------------------------
// Stage 2 helpers - normalization, fingerprints, near-duplicate detection
// ---------------------------------------------------------------------
const STOPWORDS = new Set(['a', 'an', 'the', 'is', 'are', 'was', 'were', 'what', 'if', 'could', 'would',
  'to', 'of', 'in', 'on', 'at', 'and', 'or', 'that', 'this', 'it', 'its', 'be', 'been', 'into', 'than',
  'then', 'for', 'with', 'from', 'as', 'by', 'not', 'no', 'does', 'do', 'did', 'has', 'have', 'had',
  'will', 'shall', 'can', 'may', 'might', 'should', 'something', 'someone', 'who', 'which', 'you',
  'your', 'actually', 'really']);

function significantWords(text) {
  return (text.toLowerCase().match(/[a-z0-9']+/g) || []).filter((w) => w.length > 2 && !STOPWORDS.has(w));
}
function fingerprintOf(text) {
  return new Set(significantWords(text));
}
function jaccard(setA, setB) {
  if (!setA.size && !setB.size) return 1;
  let inter = 0;
  for (const w of setA) if (setB.has(w)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

// ---------------------------------------------------------------------
// small text helpers
// ---------------------------------------------------------------------
function titleCase(s) {
  return s.replace(/^(a |an |the )/i, '').replace(/\b\w/g, (c) => c.toUpperCase());
}
function shortName(s) {
  const stripped = s.replace(/^(a |an |the )/i, '');
  const words = stripped.split(' ');
  return words.slice(0, 4).join(' ');
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ---------------------------------------------------------------------
// Stage 1b - candidate pool builders
// ---------------------------------------------------------------------
function materializeSingle(subject, transformation) {
  const hook = transformation.hook(subject.name);
  const description = `Starts from ${subject.name} (${subject.status.toLowerCase()}), then applies a "${transformation.label.toLowerCase()}" move: ${hook}`;
  return {
    kind: 'single',
    title: titleCase(shortName(subject.name)),
    premise: hook,
    category: subject.category,
    status: subject.status,
    scoringTitle: hook,
    scoringDescription: description,
    angle: `Open on ${subject.name}, ground it in what's actually known, then pivot into: ${hook}`,
    whyInteresting: `Combines a ${subject.visual}-visual-potential subject with the "${transformation.label}" idea move.`,
    transformationLabel: transformation.label,
    subjectVisual: subject.visual,
    subjectName: subject.name,
  };
}
function materializeCombo(subjectA, subjectB, template) {
  const hook = template.hook(subjectA, subjectB);
  const description = `Combines ${subjectA.name} (${subjectA.category}) with ${subjectB.name} (${subjectB.category}) via a "${template.label}" cross-category move: ${hook}`;
  const status = subjectA.status === subjectB.status ? subjectA.status : 'Mixed';
  const visual = (subjectA.visual === 'high' || subjectB.visual === 'high') ? 'high' : (subjectA.visual === 'medium' || subjectB.visual === 'medium') ? 'medium' : 'low';
  return {
    kind: 'combo',
    title: `${titleCase(shortName(subjectA.name))} \u00d7 ${titleCase(shortName(subjectB.name))}`,
    premise: hook,
    category: subjectA.category,
    secondaryCategory: subjectB.category,
    status,
    scoringTitle: hook,
    scoringDescription: description,
    angle: `Open on ${subjectA.name}, then connect it to ${subjectB.name}: ${hook}`,
    whyInteresting: `Cross-category combination (${template.label}) \u2014 the kind of unrelated-concept link that keeps Discover from repeating the same handful of subjects.`,
    transformationLabel: template.label,
    subjectVisual: visual,
    subjectName: `${subjectA.name} + ${subjectB.name}`,
  };
}
function buildSingleCandidates() {
  const out = [];
  for (const subject of SEED_SUBJECTS) {
    for (const transformation of TRANSFORMATIONS) {
      out.push(materializeSingle(subject, transformation));
    }
  }
  return out;
}
function pickCombinationTemplate(a, b) {
  for (const tpl of COMBINATION_TEMPLATES) {
    if (tpl.applies(a, b)) return { tpl, x: a, y: b };
    if (tpl.applies(b, a)) return { tpl, x: b, y: a };
  }
  return { tpl: GENERIC_COMBINATION, x: a, y: b };
}
function buildComboCandidates(sampleSize = 260) {
  const out = [];
  const seenPairs = new Set();
  let attempts = 0;
  while (out.length < sampleSize && attempts < sampleSize * 8) {
    attempts++;
    const a = pick(SEED_SUBJECTS);
    const b = pick(SEED_SUBJECTS);
    if (a === b || a.category === b.category) continue;
    const key = [a.name, b.name].sort().join('|');
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    const { tpl, x, y } = pickCombinationTemplate(a, b);
    out.push(materializeCombo(x, y, tpl));
  }
  return out;
}

// ---------------------------------------------------------------------
// Stage 5 - mode-specific ranking over the unified score's own dimensions
// (never a second scoring system - just different weightings of the one score)
// ---------------------------------------------------------------------
function rankValue(mode, analysis) {
  const s = analysis.scores;
  switch (mode) {
    case 'most_bizarre': return s.curiosity * 0.4 + s.emotionalImpact * 0.35 + s.novelty * 0.25;
    case 'most_mysterious': return s.mystery * 0.7 + s.curiosity * 0.3;
    case 'most_original': return s.novelty;
    case 'best_hypothetical': return s.hypotheticalPotential;
    case 'best_visual': return s.visualPotential;
    case 'most_unsettling': return s.emotionalImpact * 0.65 + s.mystery * 0.35;
    case 'most_thought_provoking': return s.explanationPotential * 0.5 + s.curiosity * 0.5;
    case 'wildcard': return Math.random() * 100;
    default: return analysis.weightedTotal; // 'best_overall'
  }
}
function whyItCouldFail(analysis) {
  if (!analysis.weaknesses.length) {
    return 'No major structural weakness detected \u2014 the main risk is execution (pacing, footage, and hook quality in the actual script).';
  }
  return analysis.weaknesses.map((w) => FAIL_REASONS[w]).filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------
// Full pipeline
// ---------------------------------------------------------------------
const DISCOVERY_MODES = [
  { id: 'best_overall', label: 'Best Overall' },
  { id: 'most_bizarre', label: 'Most Bizarre' },
  { id: 'most_mysterious', label: 'Most Mysterious' },
  { id: 'most_original', label: 'Most Original' },
  { id: 'best_hypothetical', label: 'Best Hypothetical' },
  { id: 'best_visual', label: 'Best Visual Potential' },
  { id: 'most_unsettling', label: 'Most Unsettling' },
  { id: 'most_thought_provoking', label: 'Most Thought-Provoking' },
  { id: 'wildcard', label: 'Wildcard' },
];

async function generateIdeas({ count = 6, mode = 'best_overall' } = {}) {
  const recentCategories = (await DB.getSetting('recentDiscoverCategories', [])) || [];
  const recentFingerprintsRaw = (await DB.getSetting('recentDiscoverFingerprints', [])) || [];
  const recentFingerprints = recentFingerprintsRaw.map((arr) => new Set(arr));
  const recentCounts = {};
  for (const c of recentCategories) recentCounts[c] = (recentCounts[c] || 0) + 1;

  // Stage 1 - generate a large candidate pool (seed subjects x transformations,
  // plus cross-category concept combinations).
  let pool = buildSingleCandidates().concat(buildComboCandidates(180));

  // Stage 2 - normalize, fingerprint, drop duplicates/near-duplicates and
  // anything too close to what was recently shown.
  pool = pool.map((c) => ({ ...c, fp: fingerprintOf(c.premise + ' ' + c.scoringDescription) }));
  pool = pool.filter((c) => !recentFingerprints.some((fp) => jaccard(fp, c.fp) >= 0.6));
  const deduped = [];
  const DEDUPE_WINDOW = 150;
  for (const c of pool) {
    const windowStart = Math.max(0, deduped.length - DEDUPE_WINDOW);
    let isDup = false;
    for (let i = deduped.length - 1; i >= windowStart; i--) {
      if (jaccard(deduped[i].fp, c.fp) >= 0.7) { isDup = true; break; }
    }
    if (!isDup) deduped.push(c);
  }
  pool = deduped;

  // Stage 3 - unified scoring. Every candidate goes through the exact same
  // function Topic Analyzer uses, on the exact text that would be saved/re-entered.
  for (const c of pool) {
    c.analysis = window.Scoring.calculateTopicScore({ title: c.scoringTitle, description: c.scoringDescription });
  }

  // Stage 5 (ranking pass 1) - order the pool by the selected discovery mode.
  if (mode === 'wildcard') {
    pool.sort(() => Math.random() - 0.5);
  } else {
    pool.sort((a, b) => rankValue(mode, b.analysis) - rankValue(mode, a.analysis));
  }

  // Stage 5 (diversity pass) - walk the ranked list, cap repeats per category in
  // this batch, and soft-deprioritize categories that have been shown a lot
  // recently unless the candidate scores unusually well anyway.
  const CAT_CAP = 2;
  const chosen = [];
  const usedInBatch = {};
  for (const cand of pool) {
    if (chosen.length >= count) break;
    if (chosen.some((d) => jaccard(d.fp, cand.fp) >= 0.6)) continue;
    const catCount = usedInBatch[cand.category] || 0;
    const overShown = (recentCounts[cand.category] || 0) >= 3 && cand.analysis.weightedTotal < 70;
    if (catCount >= CAT_CAP || overShown) continue;
    chosen.push(cand);
    usedInBatch[cand.category] = catCount + 1;
  }
  if (chosen.length < count) {
    for (const cand of pool) {
      if (chosen.length >= count) break;
      if (chosen.includes(cand)) continue;
      if (chosen.some((d) => jaccard(d.fp, cand.fp) >= 0.6)) continue;
      chosen.push(cand);
    }
  }

  // Stage 4 - channel-specific forecast, computed separately from intrinsic
  // topic potential, only for the final chosen set.
  const videos = (window.DB ? await DB.getAll('videos') : []);
  const ideas = chosen.map((cand) => {
    const catVideos = videos.filter((v) => v.category === cand.category)
      .map((v) => ({ ...v, performanceIndex: window.Scoring.computePerformanceMetrics(v).performanceIndex }));
    const forecast = window.Scoring.computeForecast({ topicAnalysis: cand.analysis, categoryVideos: catVideos });
    const reason = forecast.dataPoints === 0
      ? 'Strong intrinsic topic potential, but insufficient historical Markie Star data for a reliable channel-specific forecast.'
      : (forecast.positives[0] || forecast.negatives[0] || `Based on ${forecast.dataPoints} historical video(s) in this category.`);

    return {
      title: cand.title,
      premise: cand.premise,
      hook: cand.premise, // kept for backward compatibility with older card rendering
      category: cand.category,
      secondaryCategory: cand.secondaryCategory || null,
      realityStatus: cand.status,
      topicPotential: cand.analysis.weightedTotal,
      analysis: cand.analysis, // same shape Topic Analyzer produces - reused, not recomputed, by "Analyze"
      forecast: {
        channelForecast: forecast.estimatedPotential,
        confidence: forecast.confidence,
        dataPoints: forecast.dataPoints,
        reason,
        raw: forecast,
      },
      whyInteresting: cand.whyInteresting,
      markieStarAngle: cand.angle,
      angle: cand.angle, // backward-compat alias
      suggestedHook: pick(OPENING_HOOK_LINES)(cand.subjectName),
      hypotheticalEscalation: pick(ESCALATION_LINES)(),
      visualPotential: { score: cand.analysis.scores.visualPotential, label: cand.subjectVisual },
      whyItCouldFail: whyItCouldFail(cand.analysis),
      scoringTitle: cand.scoringTitle,
      scoringDescription: cand.scoringDescription,
      transformationLabel: cand.transformationLabel,
      discoveryMode: mode,
      confidence: cand.analysis.confidence, // topic-analyzer-style text confidence, kept for backward compat
      _fp: Array.from(cand.fp),
    };
  });

  // Persist recency for future diversity control.
  const updatedCategories = recentCategories.concat(ideas.map((i) => i.category)).slice(-60);
  await DB.setSetting('recentDiscoverCategories', updatedCategories);
  const updatedFingerprints = recentFingerprintsRaw.concat(ideas.map((i) => i._fp)).slice(-150);
  await DB.setSetting('recentDiscoverFingerprints', updatedFingerprints);

  return ideas;
}

// ---------------------------------------------------------------------
// Future live-source integration point (unused today - no live data is
// faked). A future RSS/public-data source would produce { title, description,
// category, status } objects and pass them through this exact same Stage
// 2-5 flow, so the day live sources are added, nothing about scoring or
// ranking has to change.
// ---------------------------------------------------------------------
function normalizeAndScoreExternalCandidate(raw) {
  const scoringTitle = raw.title || '';
  const scoringDescription = raw.description || '';
  const analysis = window.Scoring.calculateTopicScore({ title: scoringTitle, description: scoringDescription });
  return {
    kind: 'external',
    title: raw.title,
    premise: raw.description || raw.title,
    category: raw.category || 'Uncategorized',
    status: raw.status || 'Unverified claim',
    scoringTitle,
    scoringDescription,
    analysis,
    fp: fingerprintOf(scoringTitle + ' ' + scoringDescription),
  };
}

window.Discover = {
  generateIdeas,
  DISCOVERY_MODES,
  SUBJECTS: SEED_SUBJECTS,
  TRANSFORMATIONS,
  COMBINATION_TEMPLATES,
  normalizeAndScoreExternalCandidate,
};
