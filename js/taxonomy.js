/* taxonomy.js
   The Markie Star content taxonomy — V2.

   Strict separation of five independent fields, per the V2 spec:
     A. Primary Topic Category  — WHAT the topic is about
     B. Subcategory              — a finer-grained slice of A
     C. Story Angle               — the narrative lens ("Hypothetical", "Horror", ...)
     D. Discovery Mode           — WHY Discover is surfacing it right now
     E. Reality Status            — how grounded in fact the premise is

   A discovery mode must never be written into the category field, and vice versa.
   None of this feeds scoring — Scoring.calculateTopicScore() only ever looks at
   title/description text. Taxonomy fields are classification + ranking metadata.

   The taxonomy is intentionally expandable: PRIMARY_CATEGORIES, STORY_ANGLES, and
   DISCOVERY_MODES are plain arrays/objects that future code (or a future live
   discovery source) can push additional entries into without changing any function
   signature here.
*/

const PRIMARY_CATEGORIES = [
  { id: 'mysteries', name: 'Mysteries & Unexplained', subcategories: ['Unexplained Events', 'Strange Disappearances', 'Mysterious Locations', 'Unidentified Phenomena', 'Unexplained Footage', 'Conspiracy Claims'] },
  { id: 'myths', name: 'Myths, Legends & Folklore', subcategories: ['Ancient Myths', 'Flood Myths', 'Gods & Monsters', 'Regional Legends', 'Folklore'] },
  { id: 'cryptids', name: 'Cryptids & Unknown Creatures', subcategories: ['Yeti / Bigfoot', 'Sea Monsters', 'Unknown Animals', 'Cryptid Sightings', 'Extinct Creatures'] },
  { id: 'science', name: 'Science & Nature', subcategories: ['Strange Biology', 'Extreme Evolution', 'Rare Phenomena', 'Extreme Environments', 'Unusual Natural Events'] },
  { id: 'space', name: 'Space & Cosmic Mysteries', subcategories: ['Black Holes', 'Dark Matter', 'Strange Planets', 'Alien Possibilities', 'Cosmic Anomalies'] },
  { id: 'human_evolution', name: 'Human Evolution & Extinction', subcategories: ['Human Origins', 'Human Relatives', 'Extinct Hominins', 'Future Evolution', 'Human Extinction', 'Post-Human Civilization'] },
  { id: 'history', name: 'History & Lost Worlds', subcategories: ['Lost Civilizations', 'Ancient Technology', 'Historical Mysteries', 'Forgotten Events', 'Archaeological Anomalies'] },
  { id: 'internet', name: 'Internet & Digital Mysteries', subcategories: ['Deep Web', 'Strange Websites', 'Internet Mysteries', 'ARGs', 'Analog Horror', 'Digital Phenomena'] },
  { id: 'psychology', name: 'Psychology & Human Behavior', subcategories: ['Perception', 'Memory', 'Consciousness', 'Strange Psychological Phenomena', 'Mass Behavior'] },
  { id: 'fiction', name: 'Games, Movies & Fiction', subcategories: ['Game Characters', 'Fictional Creatures', 'Movies', 'Cartoons', 'Fiction Becoming Reality'] },
  { id: 'technology', name: 'Technology & AI', subcategories: ['Artificial Intelligence', 'Robotics', 'Future Technology', 'Digital Consciousness', 'Technological Hypotheticals'] },
  { id: 'hypothetical', name: 'Hypothetical Worlds', subcategories: ['Alternate Earth', 'Alternate History', 'Impossible Scenarios', 'Parallel Worlds', 'Extreme What-If Scenarios'] },
];
const CATEGORY_NAMES = PRIMARY_CATEGORIES.map((c) => c.name);

const STORY_ANGLES = [
  'Mystery', 'Explanation', 'Hypothetical', 'Fiction Becoming Reality', 'Reality Is Stranger',
  'Hidden World', 'Scientific Possibility', 'Evolutionary Possibility', 'Existential', 'Horror',
  'Survival', 'Future', 'Alternate History', 'Thought Experiment', 'Unexplained', 'Myth vs Reality',
  'Could This Be Real?', 'Extreme Escalation',
];

// Discovery modes describe WHY an idea is being surfaced right now — never a
// substitute for its primary category. The list below is the union of the
// explicitly enumerated V2 modes plus the two modes used in the spec's own
// worked examples ("What If", "Mystery"), since the taxonomy must stay
// expandable rather than rejecting modes the spec itself demonstrates.
const DISCOVERY_MODES = [
  { id: 'best_overall', label: 'Best Overall' },
  { id: 'most_mysterious', label: 'Most Mysterious' },
  { id: 'most_bizarre', label: 'Most Bizarre' },
  { id: 'most_unsettling', label: 'Most Unsettling' },
  { id: 'most_thought_provoking', label: 'Most Thought-Provoking' },
  { id: 'best_hypothetical', label: 'Best Hypothetical' },
  { id: 'best_visual', label: 'Best Visual Potential' },
  { id: 'most_original', label: 'Most Original' },
  { id: 'reality_is_stranger', label: 'Reality Is Stranger' },
  { id: 'fiction_becoming_reality', label: 'Fiction Becoming Reality' },
  { id: 'hidden_world', label: 'Hidden World' },
  { id: 'what_if', label: 'What If' },
  { id: 'mystery_mode', label: 'Mystery' },
  { id: 'wildcard', label: 'Wildcard' },
];

const REALITY_STATUSES = [
  'Verified Fact', 'Real Event', 'Scientific Hypothesis', 'Unverified Claim',
  'Myth / Folklore', 'Fiction', 'Hypothetical Scenario', 'Mixed',
];

// ---------------------------------------------------------------------
// Concept compatibility model — a lightweight, transparent relevance graph
// between primary categories. Nothing here is a hard ban: unlisted pairs
// still get a modest baseline score (COMPAT_BASELINE) so an unusual
// combination can still surface if the resulting premise scores well.
// ---------------------------------------------------------------------
const COMPAT_STRONG = 82;
const COMPAT_BASELINE = 32;
const COMPATIBILITY_LINKS = {
  'Myths, Legends & Folklore': ['History & Lost Worlds', 'Human Evolution & Extinction', 'Science & Nature', 'Psychology & Human Behavior', 'Cryptids & Unknown Creatures'],
  'Human Evolution & Extinction': ['Cryptids & Unknown Creatures', 'Science & Nature', 'Hypothetical Worlds', 'Technology & AI', 'History & Lost Worlds'],
  'Games, Movies & Fiction': ['Science & Nature', 'Psychology & Human Behavior', 'Technology & AI', 'Hypothetical Worlds'],
  'Mysteries & Unexplained': ['Internet & Digital Mysteries', 'Space & Cosmic Mysteries', 'Cryptids & Unknown Creatures', 'History & Lost Worlds'],
  'Cryptids & Unknown Creatures': ['Myths, Legends & Folklore', 'Science & Nature', 'History & Lost Worlds'],
  'Science & Nature': ['Human Evolution & Extinction', 'Space & Cosmic Mysteries', 'Technology & AI'],
  'Space & Cosmic Mysteries': ['Science & Nature', 'Technology & AI', 'Mysteries & Unexplained', 'Hypothetical Worlds'],
  'History & Lost Worlds': ['Myths, Legends & Folklore', 'Human Evolution & Extinction', 'Mysteries & Unexplained'],
  'Internet & Digital Mysteries': ['Mysteries & Unexplained', 'Technology & AI', 'Psychology & Human Behavior'],
  'Psychology & Human Behavior': ['Myths, Legends & Folklore', 'Games, Movies & Fiction', 'Internet & Digital Mysteries'],
  'Technology & AI': ['Science & Nature', 'Games, Movies & Fiction', 'Space & Cosmic Mysteries', 'Hypothetical Worlds'],
  'Hypothetical Worlds': ['Human Evolution & Extinction', 'Technology & AI', 'Space & Cosmic Mysteries', 'Games, Movies & Fiction'],
};
// build a symmetric adjacency set so a link declared in either direction counts
const COMPAT_SET = {};
for (const [a, links] of Object.entries(COMPATIBILITY_LINKS)) {
  COMPAT_SET[a] = COMPAT_SET[a] || new Set();
  for (const b of links) {
    COMPAT_SET[a].add(b);
    COMPAT_SET[b] = COMPAT_SET[b] || new Set();
    COMPAT_SET[b].add(a);
  }
}

function compatibilityScore(categoryA, categoryB) {
  if (!categoryA || !categoryB) return COMPAT_BASELINE;
  if (categoryA === categoryB) return 100;
  if (COMPAT_SET[categoryA] && COMPAT_SET[categoryA].has(categoryB)) return COMPAT_STRONG;
  return COMPAT_BASELINE;
}
function compatibleCategoriesFor(categoryName) {
  return COMPAT_SET[categoryName] ? Array.from(COMPAT_SET[categoryName]) : [];
}
function subcategoriesFor(categoryName) {
  const cat = PRIMARY_CATEGORIES.find((c) => c.name === categoryName);
  return cat ? cat.subcategories : [];
}

window.Taxonomy = {
  PRIMARY_CATEGORIES,
  CATEGORY_NAMES,
  STORY_ANGLES,
  DISCOVERY_MODES,
  REALITY_STATUSES,
  compatibilityScore,
  compatibleCategoriesFor,
  subcategoriesFor,
};
