/* discover.js — V2
   Local, rule-based idea generation across the full Markie Star idea universe.
   No external API, no live trend data, no scores from a model.

   V2 PIPELINE (per the upgrade spec):
     Concept Selection
       -> Relevance Filtering       (preference weights learned from save/reject/etc.)
       -> Compatibility Check       (Taxonomy.compatibilityScore between categories)
       -> Controlled Combination    (compatibility-weighted pair sampling, not pure random)
       -> Angle Generation          (Story Angle assigned separately from category)
       -> Unified Topic Scoring     (Scoring.calculateTopicScore — the one scoring engine)
       -> Duplicate Detection       (fingerprint + Jaccard near-duplicate filter)
       -> Ranking                   (mode-based ranking blended with controlled 70/20/10
                                      relevance exploration, never altering the score itself)

   Every idea carries five INDEPENDENT classification fields — primaryCategory,
   subcategory, angle, discoveryMode, realityStatus — per the V2 taxonomy. A
   discovery mode is never written into the category field.
*/

// ---------------------------------------------------------------------
// Concept universe — each concept carries taxonomy fields (category/
// subcategory/angles/reality status) as pure classification metadata.
// None of this feeds the score; Scoring.calculateTopicScore() only ever
// looks at the generated title/description text.
// ---------------------------------------------------------------------
const CONCEPTS = [
  { name: 'a giant squid sighting', primaryCategory: 'Science & Nature', subcategory: 'Strange Biology', status: 'Real Event', visual: 'high', tags: ['ocean', 'animal', 'biology'], angles: ['Reality Is Stranger', 'Mystery'] },
  { name: 'an unexplained deep-sea glow filmed by a submersible', primaryCategory: 'Mysteries & Unexplained', subcategory: 'Unexplained Footage', status: 'Unverified Claim', visual: 'high', tags: ['ocean', 'phenomenon'], angles: ['Mystery', 'Unexplained'] },
  { name: 'a brittle star mass stranding', primaryCategory: 'Science & Nature', subcategory: 'Unusual Natural Events', status: 'Verified Fact', visual: 'high', tags: ['ocean', 'animal', 'biology'], angles: ['Reality Is Stranger'] },
  { name: 'a sound recorded from the deep ocean with no confirmed source', primaryCategory: 'Mysteries & Unexplained', subcategory: 'Unidentified Phenomena', status: 'Verified Fact', visual: 'medium', tags: ['ocean', 'phenomenon', 'mystery'], angles: ['Mystery', 'Unexplained'] },
  { name: 'a hydrothermal vent ecosystem with no sunlight', primaryCategory: 'Science & Nature', subcategory: 'Extreme Environments', status: 'Verified Fact', visual: 'high', tags: ['ocean', 'biology', 'extreme'], angles: ['Hidden World', 'Scientific Possibility'] },

  { name: 'red sprites flashing above a thunderstorm', primaryCategory: 'Science & Nature', subcategory: 'Rare Phenomena', status: 'Verified Fact', visual: 'high', tags: ['atmospheric', 'phenomenon'], angles: ['Reality Is Stranger'] },
  { name: 'a green sky reported before a storm', primaryCategory: 'Mysteries & Unexplained', subcategory: 'Unidentified Phenomena', status: 'Unverified Claim', visual: 'medium', tags: ['atmospheric', 'phenomenon'], angles: ['Mystery'] },
  { name: 'a cloud that behaves like it is flowing as a liquid', primaryCategory: 'Science & Nature', subcategory: 'Rare Phenomena', status: 'Unverified Claim', visual: 'high', tags: ['atmospheric', 'phenomenon'], angles: ['Reality Is Stranger'] },
  { name: 'a sky glow with no confirmed cause reported over a city', primaryCategory: 'Mysteries & Unexplained', subcategory: 'Unexplained Events', status: 'Unverified Claim', visual: 'medium', tags: ['atmospheric', 'phenomenon'], angles: ['Mystery'] },

  { name: 'a Cold War iron lung ward', primaryCategory: 'History & Lost Worlds', subcategory: 'Historical Mysteries', status: 'Verified Fact', visual: 'medium', tags: ['historical'], angles: ['Reality Is Stranger'] },
  { name: 'an abandoned Soviet research station', primaryCategory: 'History & Lost Worlds', subcategory: 'Forgotten Events', status: 'Real Event', visual: 'medium', tags: ['historical'], angles: ['Hidden World'] },
  { name: 'a declassified military experiment', primaryCategory: 'History & Lost Worlds', subcategory: 'Historical Mysteries', status: 'Real Event', visual: 'medium', tags: ['historical', 'conspiracy'], angles: ['Hidden World', 'Could This Be Real?'] },
  { name: 'a sealed government archive from a past decade', primaryCategory: 'Mysteries & Unexplained', subcategory: 'Conspiracy Claims', status: 'Real Event', visual: 'medium', tags: ['historical', 'conspiracy'], angles: ['Hidden World'] },

  { name: 'a forgotten ancient burial site', primaryCategory: 'History & Lost Worlds', subcategory: 'Archaeological Anomalies', status: 'Verified Fact', visual: 'medium', tags: ['ancient', 'historical'], angles: ['Mystery'] },
  { name: 'an ancient structure whose construction method is still debated', primaryCategory: 'History & Lost Worlds', subcategory: 'Ancient Technology', status: 'Scientific Hypothesis', visual: 'high', tags: ['ancient'], angles: ['Mystery', 'Scientific Possibility'] },
  { name: 'a lost script that has never been translated', primaryCategory: 'History & Lost Worlds', subcategory: 'Lost Civilizations', status: 'Verified Fact', visual: 'medium', tags: ['ancient', 'mystery'], angles: ['Mystery'] },

  { name: 'what actually happens inside a particle collider', primaryCategory: 'Science & Nature', subcategory: 'Rare Phenomena', status: 'Verified Fact', visual: 'medium', tags: ['science', 'physics'], angles: ['Explanation', 'Scientific Possibility'] },
  { name: 'a material that behaves differently than physics predicts', primaryCategory: 'Science & Nature', subcategory: 'Rare Phenomena', status: 'Scientific Hypothesis', visual: 'medium', tags: ['science', 'physics'], angles: ['Scientific Possibility', 'Mystery'] },
  { name: 'a newly identified extremophile organism', primaryCategory: 'Science & Nature', subcategory: 'Strange Biology', status: 'Verified Fact', visual: 'high', tags: ['science', 'biology', 'extreme'], angles: ['Hidden World'] },

  { name: 'a psychological effect that alters memory', primaryCategory: 'Psychology & Human Behavior', subcategory: 'Memory', status: 'Verified Fact', visual: 'low', tags: ['psychology'], angles: ['Existential', 'Explanation'] },
  { name: 'a documented case of mass shared delusion', primaryCategory: 'Psychology & Human Behavior', subcategory: 'Mass Behavior', status: 'Verified Fact', visual: 'low', tags: ['psychology'], angles: ['Reality Is Stranger'] },
  { name: 'the psychology behind why people believe unverifiable claims', primaryCategory: 'Psychology & Human Behavior', subcategory: 'Strange Psychological Phenomena', status: 'Verified Fact', visual: 'low', tags: ['psychology'], angles: ['Explanation'] },

  { name: 'an extinction-level event humanity narrowly avoided', primaryCategory: 'Human Evolution & Extinction', subcategory: 'Human Extinction', status: 'Verified Fact', visual: 'medium', tags: ['extinction', 'evolution'], angles: ['Existential', 'Survival'] },
  { name: 'what replaces humans if we vanished tomorrow', primaryCategory: 'Human Evolution & Extinction', subcategory: 'Post-Human Civilization', status: 'Hypothetical Scenario', visual: 'high', tags: ['extinction', 'evolution', 'future'], angles: ['Hypothetical', 'Existential'] },
  { name: 'an octopus solving a human-designed puzzle', primaryCategory: 'Science & Nature', subcategory: 'Extreme Evolution', status: 'Verified Fact', visual: 'high', tags: ['evolution', 'biology', 'animal'], angles: ['Reality Is Stranger'] },
  { name: 'a fungus that controls insect behavior', primaryCategory: 'Science & Nature', subcategory: 'Strange Biology', status: 'Verified Fact', visual: 'high', tags: ['evolution', 'biology', 'animal'], angles: ['Horror', 'Reality Is Stranger'] },

  { name: 'what a city might look like in 300 years', primaryCategory: 'Hypothetical Worlds', subcategory: 'Extreme What-If Scenarios', status: 'Hypothetical Scenario', visual: 'high', tags: ['future'], angles: ['Future', 'Hypothetical'] },
  { name: 'what future archaeologists might misunderstand about us', primaryCategory: 'Human Evolution & Extinction', subcategory: 'Post-Human Civilization', status: 'Hypothetical Scenario', visual: 'medium', tags: ['future', 'historical'], angles: ['Future', 'Thought Experiment'] },

  { name: 'a cryptid sighting caught on a trail cam', primaryCategory: 'Cryptids & Unknown Creatures', subcategory: 'Cryptid Sightings', status: 'Unverified Claim', visual: 'high', tags: ['cryptid', 'folklore'], angles: ['Could This Be Real?', 'Mystery'] },
  { name: 'a myth about a being that lives underground', primaryCategory: 'Myths, Legends & Folklore', subcategory: 'Gods & Monsters', status: 'Myth / Folklore', visual: 'medium', tags: ['cryptid', 'myth', 'folklore'], angles: ['Myth vs Reality', 'Hidden World'] },
  { name: 'a lake said to hold something no one has confirmed', primaryCategory: 'Cryptids & Unknown Creatures', subcategory: 'Sea Monsters', status: 'Myth / Folklore', visual: 'medium', tags: ['cryptid', 'myth'], angles: ['Myth vs Reality'] },

  { name: 'a flood myth that appears across unrelated cultures', primaryCategory: 'Myths, Legends & Folklore', subcategory: 'Flood Myths', status: 'Myth / Folklore', visual: 'medium', tags: ['myth', 'historical'], angles: ['Myth vs Reality', 'Mystery'] },
  { name: 'a legendary lost city said to have sunk', primaryCategory: 'Myths, Legends & Folklore', subcategory: 'Ancient Myths', status: 'Myth / Folklore', visual: 'high', tags: ['myth', 'ancient'], angles: ['Myth vs Reality'] },

  { name: 'an urban legend that keeps resurfacing online', primaryCategory: 'Internet & Digital Mysteries', subcategory: 'Internet Mysteries', status: 'Myth / Folklore', visual: 'low', tags: ['urbanlegend', 'internet'], angles: ['Myth vs Reality'] },
  { name: 'a local legend tied to an abandoned building', primaryCategory: 'Myths, Legends & Folklore', subcategory: 'Regional Legends', status: 'Myth / Folklore', visual: 'medium', tags: ['urbanlegend'], angles: ['Myth vs Reality'] },

  { name: 'a viral deep-web video everyone is discussing', primaryCategory: 'Internet & Digital Mysteries', subcategory: 'Deep Web', status: 'Unverified Claim', visual: 'medium', tags: ['deepweb', 'internet', 'mystery'], angles: ['Mystery', 'Could This Be Real?'] },
  { name: 'an internet forum\u2019s unsolved cold case', primaryCategory: 'Internet & Digital Mysteries', subcategory: 'Internet Mysteries', status: 'Real Event', visual: 'low', tags: ['internet', 'mystery'], angles: ['Mystery'] },
  { name: 'a channel that vanished after posting one strange upload', primaryCategory: 'Internet & Digital Mysteries', subcategory: 'Strange Websites', status: 'Unverified Claim', visual: 'low', tags: ['deepweb', 'internet'], angles: ['Mystery', 'Hidden World'] },

  { name: 'a strange news report that never got a follow-up', primaryCategory: 'Mysteries & Unexplained', subcategory: 'Unexplained Events', status: 'Real Event', visual: 'medium', tags: ['news'], angles: ['Mystery'] },
  { name: 'an unexplained mass event reported by dozens of witnesses', primaryCategory: 'Mysteries & Unexplained', subcategory: 'Unexplained Events', status: 'Unverified Claim', visual: 'medium', tags: ['news', 'mystery'], angles: ['Mystery'] },

  { name: 'the Buga sphere object', primaryCategory: 'Space & Cosmic Mysteries', subcategory: 'Alien Possibilities', status: 'Unverified Claim', visual: 'medium', tags: ['ufo', 'alien'], angles: ['Could This Be Real?', 'Mystery'] },
  { name: 'a declassified military UAP sighting report', primaryCategory: 'Space & Cosmic Mysteries', subcategory: 'Alien Possibilities', status: 'Real Event', visual: 'medium', tags: ['ufo', 'alien', 'conspiracy'], angles: ['Could This Be Real?'] },

  { name: 'the Great Attractor pulling galaxies across the universe', primaryCategory: 'Space & Cosmic Mysteries', subcategory: 'Cosmic Anomalies', status: 'Scientific Hypothesis', visual: 'high', tags: ['space', 'physics'], angles: ['Scientific Possibility', 'Existential'] },
  { name: 'a black hole passing near the solar system', primaryCategory: 'Space & Cosmic Mysteries', subcategory: 'Black Holes', status: 'Hypothetical Scenario', visual: 'high', tags: ['space', 'physics'], angles: ['Hypothetical', 'Existential'] },
  { name: 'a newly confirmed exoplanet in a star\u2019s habitable zone', primaryCategory: 'Space & Cosmic Mysteries', subcategory: 'Strange Planets', status: 'Verified Fact', visual: 'high', tags: ['space'], angles: ['Scientific Possibility'] },
  { name: 'an interstellar object passing through our solar system', primaryCategory: 'Space & Cosmic Mysteries', subcategory: 'Cosmic Anomalies', status: 'Verified Fact', visual: 'high', tags: ['space', 'mystery'], angles: ['Mystery', 'Could This Be Real?'] },

  { name: 'an organism that survives near-total dehydration', primaryCategory: 'Science & Nature', subcategory: 'Extreme Environments', status: 'Verified Fact', visual: 'high', tags: ['extreme', 'biology', 'animal'], angles: ['Reality Is Stranger'] },
  { name: 'a cave ecosystem sealed off for millions of years', primaryCategory: 'Science & Nature', subcategory: 'Extreme Environments', status: 'Verified Fact', visual: 'high', tags: ['extreme', 'biology'], angles: ['Hidden World'] },

  { name: 'a claimed cover-up around a public research program', primaryCategory: 'Mysteries & Unexplained', subcategory: 'Conspiracy Claims', status: 'Unverified Claim', visual: 'low', tags: ['conspiracy'], angles: ['Hidden World', 'Could This Be Real?'] },
  { name: 'a whistleblower account that was never independently confirmed', primaryCategory: 'Mysteries & Unexplained', subcategory: 'Conspiracy Claims', status: 'Unverified Claim', visual: 'low', tags: ['conspiracy'], angles: ['Could This Be Real?'] },

  { name: 'an analog horror-style broadcast interruption concept', primaryCategory: 'Internet & Digital Mysteries', subcategory: 'Analog Horror', status: 'Fiction', visual: 'high', tags: ['horror', 'fiction'], angles: ['Horror'] },
  { name: 'a found-footage tape with an unexplained gap', primaryCategory: 'Internet & Digital Mysteries', subcategory: 'Analog Horror', status: 'Fiction', visual: 'high', tags: ['horror', 'fiction'], angles: ['Horror', 'Mystery'] },

  { name: 'an SCP-style containment scenario', primaryCategory: 'Games, Movies & Fiction', subcategory: 'Fictional Creatures', status: 'Fiction', visual: 'high', tags: ['horror', 'fiction', 'scp'], angles: ['Horror', 'Thought Experiment'] },
  { name: 'a fictional creature that breaks its own containment rules', primaryCategory: 'Games, Movies & Fiction', subcategory: 'Fictional Creatures', status: 'Fiction', visual: 'high', tags: ['fiction', 'scp'], angles: ['Horror'] },

  { name: 'a game creature with a wildly exaggerated biological ability', primaryCategory: 'Games, Movies & Fiction', subcategory: 'Game Characters', status: 'Fiction', visual: 'high', tags: ['game', 'fiction'], angles: ['Fiction Becoming Reality'] },
  { name: 'a video game world with impossible physics', primaryCategory: 'Games, Movies & Fiction', subcategory: 'Game Characters', status: 'Fiction', visual: 'high', tags: ['game', 'fiction', 'physics'], angles: ['Fiction Becoming Reality', 'Thought Experiment'] },

  { name: 'a monster from a Godzilla-style film', primaryCategory: 'Games, Movies & Fiction', subcategory: 'Movies', status: 'Fiction', visual: 'high', tags: ['movie', 'fiction'], angles: ['Fiction Becoming Reality'] },
  { name: 'a classic movie monster\u2019s design compared to real biology', primaryCategory: 'Games, Movies & Fiction', subcategory: 'Movies', status: 'Fiction', visual: 'high', tags: ['movie', 'fiction', 'biology'], angles: ['Fiction Becoming Reality', 'Scientific Possibility'] },

  { name: 'an AI system that starts making its own decisions', primaryCategory: 'Technology & AI', subcategory: 'Artificial Intelligence', status: 'Hypothetical Scenario', visual: 'medium', tags: ['ai', 'technology'], angles: ['Hypothetical', 'Existential'] },
  { name: 'a robot designed to operate somewhere humans cannot survive', primaryCategory: 'Technology & AI', subcategory: 'Robotics', status: 'Real Event', visual: 'medium', tags: ['ai', 'technology', 'extreme'], angles: ['Future'] },

  { name: 'a parallel dimension bleeding into ours', primaryCategory: 'Hypothetical Worlds', subcategory: 'Parallel Worlds', status: 'Hypothetical Scenario', visual: 'high', tags: ['dimension', 'physics'], angles: ['Hypothetical', 'Horror'] },
  { name: 'the many-worlds interpretation of quantum mechanics', primaryCategory: 'Hypothetical Worlds', subcategory: 'Parallel Worlds', status: 'Scientific Hypothesis', visual: 'medium', tags: ['dimension', 'physics', 'science'], angles: ['Scientific Possibility', 'Thought Experiment'] },

  { name: 'a time traveler\u2019s account that has never been verified', primaryCategory: 'Hypothetical Worlds', subcategory: 'Alternate History', status: 'Unverified Claim', visual: 'medium', tags: ['time', 'mystery'], angles: ['Could This Be Real?', 'Mystery'] },
  { name: 'a historical event that could have gone a completely different way', primaryCategory: 'Hypothetical Worlds', subcategory: 'Alternate History', status: 'Hypothetical Scenario', visual: 'medium', tags: ['time', 'historical'], angles: ['Alternate History'] },

  { name: 'what happens to matter at absolute zero', primaryCategory: 'Science & Nature', subcategory: 'Rare Phenomena', status: 'Verified Fact', visual: 'medium', tags: ['physics', 'science'], angles: ['Scientific Possibility', 'Explanation'] },
  { name: 'a hypothetical particle that could travel faster than light', primaryCategory: 'Hypothetical Worlds', subcategory: 'Impossible Scenarios', status: 'Scientific Hypothesis', visual: 'medium', tags: ['physics', 'science'], angles: ['Scientific Possibility', 'Thought Experiment'] },

  { name: 'what it would actually take to survive a total blackout', primaryCategory: 'Hypothetical Worlds', subcategory: 'Extreme What-If Scenarios', status: 'Hypothetical Scenario', visual: 'medium', tags: ['survival'], angles: ['Survival', 'Hypothetical'] },
  { name: 'a real account of survival in an extreme, hostile environment', primaryCategory: 'Hypothetical Worlds', subcategory: 'Extreme What-If Scenarios', status: 'Real Event', visual: 'high', tags: ['survival', 'extreme'], angles: ['Survival'] },
];

// ---------------------------------------------------------------------
// Single-subject transformation moves — each carries the Story Angle it
// implies, kept independent of whatever primary category the concept has.
// ---------------------------------------------------------------------
const TRANSFORMATIONS = [
  { id: 'scale_up', label: 'Scale increase', angle: 'Extreme Escalation', hook: (s) => `What if ${s} was 20 times larger than reported?` },
  { id: 'scale_down', label: 'Scale decrease', angle: 'Thought Experiment', hook: (s) => `What if ${s} happened at a microscopic scale instead?` },
  { id: 'no_humans', label: 'Remove humans', angle: 'Existential', hook: (s) => `What would happen to ${s} if humans were no longer around to explain it?` },
  { id: 'evolution', label: 'Introduce evolution', angle: 'Evolutionary Possibility', hook: (s) => `What if ${s} is only the early stage of something still evolving?` },
  { id: 'environment', label: 'Change the environment', angle: 'Hidden World', hook: (s) => `What if ${s} happened somewhere no one expects?` },
  { id: 'survival', label: 'Survival scenario', angle: 'Survival', hook: (s) => `Could you actually survive if you encountered ${s} yourself?` },
  { id: 'worst_case', label: 'Worst-case escalation', angle: 'Extreme Escalation', hook: (s) => `What is the worst-case version of ${s}?` },
  { id: 'alt_history', label: 'Alternative history', angle: 'Alternate History', hook: (s) => `What if ${s} had been discovered a century earlier?` },
  { id: 'fiction_real', label: 'Fiction becoming real', angle: 'Fiction Becoming Reality', hook: (s) => `What if ${s} turned out to be exactly what fiction has been describing?` },
  { id: 'extreme', label: 'Push to an impossible extreme', angle: 'Extreme Escalation', hook: (s) => `What is the most extreme version of ${s} that could theoretically exist?` },
  { id: 'thought_experiment', label: 'Scientific thought experiment', angle: 'Thought Experiment', hook: (s) => `Is there a scientific explanation for ${s}, or does it break what we think we know?` },
  { id: 'reverse', label: 'Reverse the premise', angle: 'Thought Experiment', hook: (s) => `What if the opposite of ${s} turned out to be true instead?` },
  { id: 'hidden_cost', label: 'Hidden cost', angle: 'Existential', hook: (s) => `What would it actually cost us if ${s} were confirmed true?` },
  { id: 'personify', label: 'First-person experience', angle: 'Survival', hook: (s) => `What would it actually be like to experience ${s} firsthand?` },
  { id: 'disprove', label: 'Attempt to disprove', angle: 'Myth vs Reality', hook: (s) => `What would it take to definitively disprove ${s}?` },
  { id: 'compress_time', label: 'Compress the timeline', angle: 'Extreme Escalation', hook: (s) => `What if ${s} happened over a single day instead of years?` },
  { id: 'sensory', label: 'Sensory close-up', angle: 'Hidden World', hook: (s) => `What would ${s} actually look, sound, or feel like up close?` },
  { id: 'legacy', label: 'Long-term legacy', angle: 'Future', hook: (s) => `What would ${s} mean for the next hundred years?` },
  { id: 'connect_viewer', label: 'Connect to the viewer', angle: 'Could This Be Real?', hook: (s) => `Could something like ${s} be happening right now, unnoticed?` },
  { id: 'institutional', label: 'Institutional motive', angle: 'Hidden World', hook: (s) => `Why would official institutions have a reason to stay quiet about ${s}?` },
  { id: 'cosmic_scale', label: 'Compare at cosmic scale', angle: 'Extreme Escalation', hook: (s) => `How would ${s} compare if it happened on a planetary or cosmic scale?` },
  { id: 'unrelated_link', label: 'Unexpected connection', angle: 'Mystery', hook: (s) => `What if ${s} was quietly connected to something completely unrelated?` },
];

// ---------------------------------------------------------------------
// Cross-category concept combinations — selection is compatibility-weighted
// (Taxonomy.compatibilityScore), not pure random; specific templates below
// add coherence on top of that when the tag pattern matches.
// ---------------------------------------------------------------------
const COMBINATION_TEMPLATES = [
  { id: 'extinction_evolution', label: 'Extinction \u2192 evolution', angle: 'Evolutionary Possibility',
    applies: (a, b) => a.tags.includes('extinction') && (b.tags.includes('evolution') || b.tags.includes('biology')),
    hook: (a, b) => `If ${a.name} marked the end of one era, what kind of species could eventually rise to fill the gap \u2014 the way ${b.name} shows evolution can reshape a lineage surprisingly fast?` },
  { id: 'fiction_biology', label: 'Fiction \u2192 real biology', angle: 'Fiction Becoming Reality',
    applies: (a, b) => (a.tags.includes('game') || a.tags.includes('fiction')) && b.tags.includes('biology'),
    hook: (a, b) => `What if the exaggerated ability behind ${a.name} was actually biologically possible \u2014 the way ${b.name} already comes close to it in the real world?` },
  { id: 'deepweb_hypothetical', label: 'Deep-web claim \u2192 hypothetical', angle: 'Could This Be Real?',
    applies: (a) => a.tags.includes('deepweb') || a.tags.includes('internet'),
    hook: (a, b) => `What if ${a.name}, widely dismissed as fake, actually pointed toward something like ${b.name} being real after all?` },
  { id: 'myth_evolution', label: 'Mythology \u2192 evolution', angle: 'Myth vs Reality',
    applies: (a, b) => (a.tags.includes('myth') || a.tags.includes('folklore') || a.tags.includes('cryptid')) && (b.tags.includes('evolution') || b.tags.includes('biology')),
    hook: (a, b) => `Could a creature resembling ${a.name} ever plausibly evolve, given what ${b.name} shows about how far evolution can stretch a body plan?` },
  { id: 'ai_historical', label: 'AI pattern-finding \u2192 history', angle: 'Hidden World',
    applies: (a, b) => a.tags.includes('ai') && (b.tags.includes('historical') || b.tags.includes('ancient')),
    hook: (a, b) => `If a system like ${a.name} was pointed at ${b.name}, what pattern might it surface that historians have missed?` },
  { id: 'space_psychology', label: 'Cosmic event \u2192 human mind', angle: 'Existential',
    applies: (a, b) => a.tags.includes('space') && b.tags.includes('psychology'),
    hook: (a, b) => `What would ${a.name} actually do to the human mind, given what we already know from ${b.name}?` },
  { id: 'cryptid_science', label: 'Cryptid claim \u2192 scientific test', angle: 'Myth vs Reality',
    applies: (a, b) => a.tags.includes('cryptid') && (b.tags.includes('science') || b.tags.includes('biology')),
    hook: (a, b) => `If ${a.name} were ever confirmed, would ${b.name} actually make it biologically plausible \u2014 or rule it out completely?` },
  { id: 'time_historical', label: 'Time travel \u2192 historical record', angle: 'Alternate History',
    applies: (a, b) => a.tags.includes('time') && (b.tags.includes('historical') || b.tags.includes('ancient')),
    hook: (a, b) => `If someone could step directly into ${b.name}, would it confirm or completely contradict what we assume from ${a.name}?` },
  { id: 'conspiracy_historical', label: 'Conspiracy claim \u2192 declassified record', angle: 'Could This Be Real?',
    applies: (a, b) => a.tags.includes('conspiracy') && b.tags.includes('historical'),
    hook: (a, b) => `Does ${b.name} actually lend evidence to the claims around ${a.name} \u2014 or does it undercut them?` },
  { id: 'dimension_physics', label: 'Alternate dimension \u2192 physics rules', angle: 'Thought Experiment',
    applies: (a, b) => a.tags.includes('dimension') && b.tags.includes('physics'),
    hook: (a, b) => `If ${a.name} were real, would it have to obey the same rules as ${b.name} \u2014 or could it break them entirely?` },
  { id: 'phenomenon_amplify', label: 'Real phenomenon \u2192 extreme escalation', angle: 'Extreme Escalation',
    applies: (a) => a.tags.includes('phenomenon') || a.tags.includes('extreme'),
    hook: (a, b) => `What would happen if ${a.name} became a hundred times stronger \u2014 and does ${b.name} hint at what that might actually look like?` },
];
const GENERIC_COMBINATION = { id: 'generic_link', label: 'Unexpected cross-category link', angle: 'Mystery',
  hook: (a, b) => `What if ${a.name} turned out to be connected to ${b.name} in a way nobody has seriously considered?` };

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
// text / fingerprint helpers
// ---------------------------------------------------------------------
const STOPWORDS = new Set(['a', 'an', 'the', 'is', 'are', 'was', 'were', 'what', 'if', 'could', 'would',
  'to', 'of', 'in', 'on', 'at', 'and', 'or', 'that', 'this', 'it', 'its', 'be', 'been', 'into', 'than',
  'then', 'for', 'with', 'from', 'as', 'by', 'not', 'no', 'does', 'do', 'did', 'has', 'have', 'had',
  'will', 'shall', 'can', 'may', 'might', 'should', 'something', 'someone', 'who', 'which', 'you',
  'your', 'actually', 'really']);
function significantWords(text) {
  return (text.toLowerCase().match(/[a-z0-9']+/g) || []).filter((w) => w.length > 2 && !STOPWORDS.has(w));
}
function fingerprintOf(text) { return new Set(significantWords(text)); }
function jaccard(setA, setB) {
  if (!setA.size && !setB.size) return 1;
  let inter = 0;
  for (const w of setA) if (setB.has(w)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}
function clamp(n, min = 0, max = 100) { return Math.max(min, Math.min(max, n)); }
function titleCase(s) { return s.replace(/^(a |an |the )/i, '').replace(/\b\w/g, (c) => c.toUpperCase()); }
function shortName(s) { const stripped = s.replace(/^(a |an |the )/i, ''); return stripped.split(' ').slice(0, 4).join(' '); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pickAngle(candidateAngle, conceptAngles) {
  if (candidateAngle && conceptAngles && conceptAngles.includes(candidateAngle)) return candidateAngle;
  if (candidateAngle) return candidateAngle;
  return pick(conceptAngles && conceptAngles.length ? conceptAngles : window.Taxonomy.STORY_ANGLES);
}

// ---------------------------------------------------------------------
// Preference learning — transparent, additive weights in [0,100] per
// category/angle/discoveryMode, stored in IndexedDB settings. This never
// touches the topic score itself, only ranking/exploration order.
// ---------------------------------------------------------------------
const FEEDBACK_DELTAS = { saved: 6, published: 10, rated_high: 8, rejected: -6, deleted: -8, rated_low: -6 };
async function getPreferenceWeights() {
  const prefs = await DB.getSetting('preferenceWeights', null);
  return prefs || { categories: {}, angles: {}, modes: {} };
}
async function recordFeedback(idea, action) {
  const delta = FEEDBACK_DELTAS[action] || 0;
  if (!delta) return;
  const prefs = await getPreferenceWeights();
  if (idea.primaryCategory) prefs.categories[idea.primaryCategory] = clamp((prefs.categories[idea.primaryCategory] ?? 50) + delta);
  if (idea.angle) prefs.angles[idea.angle] = clamp((prefs.angles[idea.angle] ?? 50) + delta * 0.7);
  if (idea.discoveryMode) prefs.modes[idea.discoveryMode] = clamp((prefs.modes[idea.discoveryMode] ?? 50) + delta * 0.5);
  await DB.setSetting('preferenceWeights', prefs);
  return prefs;
}
function relevanceOf(cand, prefs) {
  const catW = prefs.categories[cand.primaryCategory] ?? 50;
  const angleW = prefs.angles[cand.angle] ?? 50;
  const compat = cand.kind === 'combo'
    ? window.Taxonomy.compatibilityScore(cand.primaryCategory, cand.secondaryCategory)
    : 70;
  return clamp(catW * 0.4 + angleW * 0.3 + compat * 0.3);
}

// ---------------------------------------------------------------------
// Stage: candidate materialization
// ---------------------------------------------------------------------
function materializeSingle(concept, transformation) {
  const hook = transformation.hook(concept.name);
  const description = `Starts from ${concept.name} (${concept.status.toLowerCase()}), then applies a "${transformation.label.toLowerCase()}" move: ${hook}`;
  return {
    kind: 'single',
    title: titleCase(shortName(concept.name)),
    premise: hook,
    primaryCategory: concept.primaryCategory,
    subcategory: concept.subcategory,
    realityStatus: concept.status,
    angle: pickAngle(transformation.angle, concept.angles),
    scoringTitle: hook,
    scoringDescription: description,
    conceptAngle: transformation.angle,
    angleGeneration: `Transformation "${transformation.label}" implies the "${transformation.angle}" angle` + (concept.angles.includes(transformation.angle) ? ', which also matches the concept.' : `; concept's own angles are ${concept.angles.join(', ')}.`),
    markieStarAngle: `Open on ${concept.name}, ground it in what's actually known, then pivot into: ${hook}`,
    whyInteresting: `Combines a ${concept.visual}-visual-potential subject with the "${transformation.label}" idea move.`,
    transformationLabel: transformation.label,
    subjectVisual: concept.visual,
    subjectName: concept.name,
  };
}
function materializeCombo(conceptA, conceptB, template) {
  const hook = template.hook(conceptA, conceptB);
  const description = `Combines ${conceptA.name} (${conceptA.primaryCategory}) with ${conceptB.name} (${conceptB.primaryCategory}) via a "${template.label}" cross-category move: ${hook}`;
  const status = conceptA.status === conceptB.status ? conceptA.status : 'Mixed';
  const visual = (conceptA.visual === 'high' || conceptB.visual === 'high') ? 'high' : (conceptA.visual === 'medium' || conceptB.visual === 'medium') ? 'medium' : 'low';
  return {
    kind: 'combo',
    title: `${titleCase(shortName(conceptA.name))} \u00d7 ${titleCase(shortName(conceptB.name))}`,
    premise: hook,
    primaryCategory: conceptA.primaryCategory,
    subcategory: conceptA.subcategory,
    secondaryCategory: conceptB.primaryCategory,
    realityStatus: status,
    angle: pickAngle(template.angle, conceptA.angles.concat(conceptB.angles)),
    scoringTitle: hook,
    scoringDescription: description,
    angleGeneration: `Combination template "${template.label}" implies the "${template.angle}" angle across ${conceptA.primaryCategory} + ${conceptB.primaryCategory}.`,
    markieStarAngle: `Open on ${conceptA.name}, then connect it to ${conceptB.name}: ${hook}`,
    whyInteresting: `Cross-category combination (${template.label}, compatibility ${window.Taxonomy.compatibilityScore(conceptA.primaryCategory, conceptB.primaryCategory)}/100) \u2014 the kind of unrelated-concept link that keeps Discover from repeating the same handful of subjects.`,
    transformationLabel: template.label,
    subjectVisual: visual,
    subjectName: `${conceptA.name} + ${conceptB.name}`,
  };
}
function buildSingleCandidates() {
  const out = [];
  for (const concept of CONCEPTS) {
    for (const transformation of TRANSFORMATIONS) out.push(materializeSingle(concept, transformation));
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
// Controlled combination: pairs are sampled with probability weighted toward
// higher category compatibility, rather than uniformly at random, per the
// "Concept Selection -> Compatibility Check -> Controlled Combination" stage.
function buildComboCandidates(sampleSize = 180) {
  const out = [];
  const seenPairs = new Set();
  let attempts = 0;
  while (out.length < sampleSize && attempts < sampleSize * 10) {
    attempts++;
    const a = pick(CONCEPTS);
    const b = pick(CONCEPTS);
    if (a === b || a.primaryCategory === b.primaryCategory) continue;
    const key = [a.name, b.name].sort().join('|');
    if (seenPairs.has(key)) continue;
    const compat = window.Taxonomy.compatibilityScore(a.primaryCategory, b.primaryCategory);
    // weighted acceptance: strongly-compatible pairs are almost always kept,
    // baseline pairs are kept only some of the time (still possible - not banned)
    const acceptProb = 0.3 + (compat / 100) * 0.7;
    if (Math.random() > acceptProb) continue;
    seenPairs.add(key);
    const { tpl, x, y } = pickCombinationTemplate(a, b);
    out.push(materializeCombo(x, y, tpl));
  }
  return out;
}

// ---------------------------------------------------------------------
// Ranking — mode-specific, over the unified score's own dimensions.
// ---------------------------------------------------------------------
function rankValue(mode, analysis) {
  const s = analysis.scores;
  switch (mode) {
    case 'most_bizarre': return s.curiosity * 0.4 + s.emotionalImpact * 0.35 + s.novelty * 0.25;
    case 'most_mysterious': case 'mystery_mode': return s.mystery * 0.7 + s.curiosity * 0.3;
    case 'most_original': return s.novelty;
    case 'best_hypothetical': case 'what_if': return s.hypotheticalPotential;
    case 'best_visual': return s.visualPotential;
    case 'most_unsettling': return s.emotionalImpact * 0.65 + s.mystery * 0.35;
    case 'most_thought_provoking': return s.explanationPotential * 0.5 + s.curiosity * 0.5;
    case 'reality_is_stranger': return s.curiosity * 0.5 + s.novelty * 0.5;
    case 'fiction_becoming_reality': return s.hypotheticalPotential * 0.5 + s.curiosity * 0.5;
    case 'hidden_world': return s.mystery * 0.5 + s.explanationPotential * 0.5;
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
async function generateIdeas({ count = 6, mode = 'best_overall' } = {}) {
  const recentCategories = (await DB.getSetting('recentDiscoverCategories', [])) || [];
  const recentFingerprintsRaw = (await DB.getSetting('recentDiscoverFingerprints', [])) || [];
  const recentFingerprints = recentFingerprintsRaw.map((arr) => new Set(arr));
  const recentCounts = {};
  for (const c of recentCategories) recentCounts[c] = (recentCounts[c] || 0) + 1;
  const prefs = await getPreferenceWeights();

  // Concept Selection -> Controlled Combination
  let pool = buildSingleCandidates().concat(buildComboCandidates());

  // Duplicate Detection (fingerprint + sliding-window near-duplicate filter,
  // bounded to O(n*k) for performance)
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

  // Relevance Filtering (preference-weight + compatibility based, ranking-only)
  for (const c of pool) c.relevance = relevanceOf(c, prefs);

  // Unified Topic Scoring — the one scoring engine, same as Topic Analyzer
  for (const c of pool) {
    c.analysis = window.Scoring.calculateTopicScore({ title: c.scoringTitle, description: c.scoringDescription });
  }

  // Ranking, within the mode
  if (mode === 'wildcard') pool.sort(() => Math.random() - 0.5);
  else pool.sort((a, b) => rankValue(mode, b.analysis) - rankValue(mode, a.analysis));

  // Controlled randomness: ~70% high-relevance, ~20% underexplored, ~10% wildcard.
  const highRelevance = pool.filter((c) => c.relevance >= 55).sort((a, b) => rankValue(mode, b.analysis) - rankValue(mode, a.analysis));
  const underexplored = pool.filter((c) => (recentCounts[c.primaryCategory] || 0) <= 1 && c.relevance >= 30 && c.relevance < 70)
    .sort((a, b) => rankValue(mode, b.analysis) - rankValue(mode, a.analysis));
  const wildcardPool = pool.filter((c) => c.relevance < 40).sort(() => Math.random() - 0.5);

  const CAT_CAP = 2;
  const chosen = [];
  const usedInBatch = {};
  function tryAdd(cand) {
    if (chosen.length >= count) return false;
    if (chosen.includes(cand)) return false;
    if (chosen.some((d) => jaccard(d.fp, cand.fp) >= 0.6)) return false;
    const catCount = usedInBatch[cand.primaryCategory] || 0;
    const overShown = (recentCounts[cand.primaryCategory] || 0) >= 3 && cand.analysis.weightedTotal < 70;
    if (catCount >= CAT_CAP || overShown) return false;
    chosen.push(cand);
    usedInBatch[cand.primaryCategory] = catCount + 1;
    return true;
  }
  const nHigh = Math.round(count * 0.7);
  const nUnder = Math.round(count * 0.2);
  for (const cand of highRelevance) { if (chosen.length >= nHigh) break; tryAdd(cand); }
  for (const cand of underexplored) { if (chosen.length >= nHigh + nUnder) break; tryAdd(cand); }
  for (const cand of wildcardPool) { if (chosen.length >= count) break; tryAdd(cand); }
  // backfill from the full ranked pool if any bucket came up short
  if (chosen.length < count) {
    for (const cand of pool) { if (chosen.length >= count) break; tryAdd(cand); }
  }
  // last-resort backfill: ignore category cap / recency penalty entirely (still
  // avoids near-duplicates) so a heavily-explored session can never return fewer
  // ideas than requested just because most categories look "recently shown"
  if (chosen.length < count) {
    for (const cand of pool) {
      if (chosen.length >= count) break;
      if (chosen.includes(cand)) continue;
      if (chosen.some((d) => jaccard(d.fp, cand.fp) >= 0.6)) continue;
      chosen.push(cand);
    }
  }

  // Forecast — separate from Topic Potential, only for the final chosen set
  const videos = (window.DB ? await DB.getAll('videos') : []);
  const ideas = chosen.map((cand) => {
    const catVideos = videos.filter((v) => v.category === cand.primaryCategory)
      .map((v) => ({ ...v, performanceIndex: window.Scoring.computePerformanceMetrics(v).performanceIndex }));
    const forecast = window.Scoring.computeForecast({ topicAnalysis: cand.analysis, categoryVideos: catVideos });
    const reason = forecast.dataPoints === 0
      ? 'Strong intrinsic topic potential, but insufficient historical Markie Star data for a reliable channel-specific forecast.'
      : (forecast.positives[0] || forecast.negatives[0] || `Based on ${forecast.dataPoints} historical video(s) in this category.`);
    const modeMeta = window.Taxonomy.DISCOVERY_MODES.find((m) => m.id === mode);

    return {
      title: cand.title,
      premise: cand.premise,
      hook: cand.premise, // backward-compat alias
      primaryCategory: cand.primaryCategory,
      category: cand.primaryCategory, // backward-compat alias (Library/Dashboard read `.category`)
      subcategory: cand.subcategory,
      secondaryCategory: cand.secondaryCategory || null,
      angle: cand.angle,
      angleGeneration: cand.angleGeneration,
      discoveryMode: mode,
      discoveryModeLabel: modeMeta ? modeMeta.label : mode,
      realityStatus: cand.realityStatus,
      relevance: Math.round(cand.relevance),
      topicPotential: cand.analysis.weightedTotal,
      analysis: cand.analysis, // reused, not recomputed, by "Analyze"
      forecast: { channelForecast: forecast.estimatedPotential, confidence: forecast.confidence, dataPoints: forecast.dataPoints, reason, raw: forecast },
      whyInteresting: cand.whyInteresting,
      markieStarAngle: cand.markieStarAngle,
      angleField: cand.markieStarAngle, // backward-compat alias
      suggestedHook: pick(OPENING_HOOK_LINES)(cand.subjectName),
      hypotheticalEscalation: pick(ESCALATION_LINES)(),
      visualPotential: { score: cand.analysis.scores.visualPotential, label: cand.subjectVisual },
      whyItCouldFail: whyItCouldFail(cand.analysis),
      scoringTitle: cand.scoringTitle,
      scoringDescription: cand.scoringDescription,
      transformationLabel: cand.transformationLabel,
      confidence: cand.analysis.confidence,
      _fp: Array.from(cand.fp),
    };
  });

  // Persist recency for future diversity control
  const updatedCategories = recentCategories.concat(ideas.map((i) => i.primaryCategory)).slice(-60);
  await DB.setSetting('recentDiscoverCategories', updatedCategories);
  const updatedFingerprints = recentFingerprintsRaw.concat(ideas.map((i) => i._fp)).slice(-150);
  await DB.setSetting('recentDiscoverFingerprints', updatedFingerprints);

  return ideas;
}

// ---------------------------------------------------------------------
// Reject: records negative preference feedback and keeps the topic from
// resurfacing soon, without permanently banning its category (per spec).
// ---------------------------------------------------------------------
async function rejectIdea(idea) {
  await recordFeedback(idea, 'rejected');
  const recentFingerprintsRaw = (await DB.getSetting('recentDiscoverFingerprints', [])) || [];
  recentFingerprintsRaw.push(idea._fp);
  await DB.setSetting('recentDiscoverFingerprints', recentFingerprintsRaw.slice(-150));
}

// ---------------------------------------------------------------------
// Future live-source integration point (unused today \u2014 no live data is
// faked). Produces the same shape Stage "Duplicate Detection" onward expects.
// ---------------------------------------------------------------------
function normalizeAndScoreExternalCandidate(raw) {
  const scoringTitle = raw.title || '';
  const scoringDescription = raw.description || '';
  const analysis = window.Scoring.calculateTopicScore({ title: scoringTitle, description: scoringDescription });
  return {
    kind: 'external',
    title: raw.title,
    premise: raw.description || raw.title,
    primaryCategory: raw.primaryCategory || 'Mysteries & Unexplained',
    subcategory: raw.subcategory || '',
    realityStatus: raw.realityStatus || 'Unverified Claim',
    angle: raw.angle || 'Mystery',
    scoringTitle,
    scoringDescription,
    analysis,
    fp: fingerprintOf(scoringTitle + ' ' + scoringDescription),
  };
}

window.Discover = {
  generateIdeas,
  recordFeedback,
  rejectIdea,
  getPreferenceWeights,
  DISCOVERY_MODES: window.Taxonomy ? window.Taxonomy.DISCOVERY_MODES : [],
  CONCEPTS,
  SUBJECTS: CONCEPTS, // backward-compat alias for older callers
  TRANSFORMATIONS,
  COMBINATION_TEMPLATES,
  normalizeAndScoreExternalCandidate,
};
