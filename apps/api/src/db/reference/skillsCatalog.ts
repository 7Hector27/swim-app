// Typed catalog of every skill category and skill, transcribed from
// docs/reference/skill-rubric.md (sections 1–9). Build decisions from section 10.
// Updated per Jason's Phase 1 answers (docs/reference/skills-rubric-answers-2026-10.md).

export type SkillType = "rubric" | "measured" | "score" | "composite" | "rollup";
export type Stroke = "free" | "back" | "breast" | "fly";

export type CatalogDescriptor = {
  level: 1 | 2 | 3 | 4 | 5;
  text: string;
};

export type CatalogSkill = {
  slug: string;
  name: string;
  type: SkillType;
  unit?: string;
  stroke?: Stroke;
  appliesTo?: Stroke[];
  parentSlug?: string;
  sortOrder: number;
  builtOnSlugs?: string[];
  descriptors?: CatalogDescriptor[];
  faultTags?: string[];
  ratedPerSide?: boolean;
};

export type CatalogCategory = {
  slug: string;
  name: string;
  sortOrder: number;
  skills: CatalogSkill[];
};

// ── Shared descriptor sets ────────────────────────────────────────────────────

const HEAD_POSITION_DESCRIPTORS: CatalogDescriptor[] = [
  { level: 1, text: "Head lifts or swings to look forward or breathe; hips drop visibly." },
  { level: 2, text: "Neutral when cued; drifts up when swimming fast or breathing." },
  { level: 3, text: "Neutral spine, eyes in the correct line for the stroke, at practice pace." },
  { level: 4, text: "Stays neutral at race pace and through breaths; minimal bounce." },
  { level: 5, text: "Stays neutral through the full race distance, including breaths, turns and the finish." },
];

const UDK_DESCRIPTORS: CatalogDescriptor[] = [
  { level: 1, text: "Holds streamline only a few yards; arms separate or head lifts; kick small and irregular." },
  { level: 2, text: "Recognizable streamline to about the flags; kick present but slow and from the knees." },
  { level: 3, text: "Roughly half the pool with locked arms and head between them; moderate tempo." },
  { level: 4, text: "Most or all of the pool with proper form and high kick tempo, but not repeatable lap after lap." },
  { level: 5, text: "Full pool underwater with proper form and high kick tempo, repeatable lap after lap on adequate rest." },
];

// ── Rating scale (generic fallback) ──────────────────────────────────────────

export type RatingScaleRow = {
  level: 1 | 2 | 3 | 4 | 5;
  label: string;
  meaning: string;
};

export const RATING_SCALE: RatingScaleRow[] = [
  {
    level: 1,
    label: "Emerging",
    meaning: "Limited understanding or execution; needs significant guidance, demonstration and frequent correction",
  },
  {
    level: 2,
    label: "Developing",
    meaning: "Understands the fundamentals; executes inconsistently; needs regular feedback",
  },
  {
    level: 3,
    label: "Competent",
    meaning: "Executes independently and consistently in normal practice, with some inefficiencies",
  },
  {
    level: 4,
    label: "Advanced",
    meaning: "Efficient, repeatable technique at higher speeds and under fatigue; occasional refinement",
  },
  {
    level: 5,
    label: "Mastery",
    meaning: "Refined across speeds, distances and competitive conditions, with minimal breakdown",
  },
];

// ── Catalog ───────────────────────────────────────────────────────────────────

export const SKILLS_CATALOG: CatalogCategory[] = [
  // ── 1. Body Position & Balance ──────────────────────────────────────────────
  {
    slug: "body-position-balance",
    name: "Body Position & Balance",
    sortOrder: 1,
    skills: [
      {
        slug: "buoyancy-balance",
        name: "Buoyancy & balance",
        type: "rubric",
        sortOrder: 1,
        // Per Jason A1: buoyancy-balance depends on head-position-overall and core-stability.
        builtOnSlugs: ["head-position-overall", "core-stability"],
      },
      {
        slug: "head-position-overall",
        name: "Head position (overall)",
        type: "rollup",
        sortOrder: 2,
        // Per Jason A1: head-position-overall is a pure rollup — no explicit deps.
      },
      {
        slug: "horizontal-alignment",
        name: "Horizontal alignment",
        type: "rubric",
        sortOrder: 3,
        builtOnSlugs: ["head-position-overall"],
      },
      {
        slug: "hip-position",
        name: "Hip position",
        type: "rubric",
        sortOrder: 4,
        builtOnSlugs: ["head-position-overall", "core-stability"],
      },
      {
        slug: "core-stability",
        name: "Core stability",
        type: "rubric",
        sortOrder: 5,
      },
      // body-rotation archived (replaced by per-stroke free-rotation; back-rotation already existed).
      {
        slug: "static-streamline",
        name: "Static streamline",
        type: "rubric",
        sortOrder: 6,
        builtOnSlugs: ["core-stability"],
      },
      {
        slug: "finger-spacing",
        name: "Finger spacing",
        type: "rubric",
        sortOrder: 7,
      },
      {
        slug: "sculling",
        name: "Sculling / feel for the water",
        type: "rubric",
        sortOrder: 8,
      },
    ],
  },

  // ── 2. Breathing & Coordination ─────────────────────────────────────────────
  {
    slug: "breathing-coordination",
    name: "Breathing & Coordination",
    sortOrder: 2,
    skills: [
      {
        slug: "exhalation",
        name: "Exhalation",
        type: "rubric",
        sortOrder: 1,
      },
      {
        slug: "breath-control",
        name: "Breath control",
        type: "rubric",
        sortOrder: 2,
        builtOnSlugs: ["exhalation"],
        descriptors: [
          { level: 1, text: "Breathes every 1-2 strokes; stops or stands to breathe." },
          { level: 2, text: "Reaches the flags before the first breath." },
          { level: 3, text: "Covers most of the distance on the target breaths; stroke shortens near the wall." },
          { level: 4, text: "Hits the target breaths, but stroke or tempo falls apart at the finish." },
          { level: 5, text: "Hits the target breaths at race tempo, repeatable on normal rest." },
        ],
      },
      // rhythmic-breathing (free+fly, shared) archived — replaced by per-stroke below.
      // bilateral-breathing (shared) archived — replaced by free-bilateral-breathing below.
      // Per-stroke instances of Breathing timing
      {
        slug: "breathing-timing-free",
        name: "Breathing timing",
        type: "rubric",
        stroke: "free",
        sortOrder: 3,
        ratedPerSide: true,
        builtOnSlugs: ["free-head-position", "free-stroke-timing"],
      },
      // breathing-timing-back archived per Jason A5.
      {
        slug: "breathing-timing-breast",
        name: "Breathing timing",
        type: "rubric",
        stroke: "breast",
        sortOrder: 4,
        builtOnSlugs: ["breast-head-position", "breast-timing"],
      },
      {
        slug: "breathing-timing-fly",
        name: "Breathing timing",
        type: "rubric",
        stroke: "fly",
        sortOrder: 5,
        // Per Jason A7: fly breathing timing builds on fly-head-position and fly-two-kick-rhythm.
        builtOnSlugs: ["fly-head-position", "fly-two-kick-rhythm"],
      },
      // Per-stroke instances of Stroke-breath coordination
      {
        slug: "stroke-breath-coordination-free",
        name: "Stroke-breath coordination",
        type: "rubric",
        stroke: "free",
        sortOrder: 6,
        ratedPerSide: true,
        // Per Jason A15: links to free-rotation, not shared body-rotation.
        builtOnSlugs: ["breathing-timing-free", "free-rotation"],
      },
      // stroke-breath-coordination-back archived per Jason A5.
      {
        slug: "stroke-breath-coordination-breast",
        name: "Stroke-breath coordination",
        type: "rubric",
        stroke: "breast",
        sortOrder: 7,
        // Per Jason A10: body-rotation removed from breaststroke. Depends only on breathing-timing-breast.
        builtOnSlugs: ["breathing-timing-breast"],
      },
      {
        slug: "stroke-breath-coordination-fly",
        name: "Stroke-breath coordination",
        type: "rubric",
        stroke: "fly",
        sortOrder: 8,
        // Per Jason A10: body-rotation removed from fly coordination.
        builtOnSlugs: ["breathing-timing-fly"],
      },
      // New per-stroke rhythmic breathing skills (replacing archived shared rhythmic-breathing).
      {
        slug: "free-rhythmic-breathing",
        name: "Rhythmic breathing",
        type: "rubric",
        stroke: "free",
        sortOrder: 9,
        builtOnSlugs: ["exhalation", "free-head-position"],
      },
      {
        slug: "fly-rhythmic-breathing",
        name: "Rhythmic breathing",
        type: "rubric",
        stroke: "fly",
        sortOrder: 10,
        builtOnSlugs: ["exhalation", "fly-head-position"],
      },
      {
        slug: "back-rhythmic-breathing",
        name: "Rhythmic breathing",
        type: "rubric",
        stroke: "back",
        sortOrder: 11,
        builtOnSlugs: ["exhalation", "back-head-position-stability"],
      },
      {
        slug: "free-bilateral-breathing",
        name: "Bilateral breathing",
        type: "rubric",
        stroke: "free",
        sortOrder: 12,
        ratedPerSide: true,
        builtOnSlugs: ["free-rhythmic-breathing", "free-rotation"],
      },
    ],
  },

  // ── 3. Freestyle ────────────────────────────────────────────────────────────
  {
    slug: "freestyle",
    name: "Freestyle",
    sortOrder: 3,
    skills: [
      {
        slug: "free-head-position",
        name: "Head position",
        type: "rubric",
        stroke: "free",
        sortOrder: 1,
        // Per Jason: per-stroke head positions have no explicit builds-on; they are the inputs to the rollup.
        descriptors: HEAD_POSITION_DESCRIPTORS,
      },
      {
        slug: "free-reach-before-entry",
        name: "Reach before entry",
        type: "rubric",
        stroke: "free",
        sortOrder: 2,
        // Per Jason: body-rotation archived; use free-rotation instead.
        builtOnSlugs: ["free-rotation"],
      },
      {
        slug: "free-catch",
        name: "Catch",
        type: "rubric",
        stroke: "free",
        sortOrder: 3,
        builtOnSlugs: ["free-reach-before-entry", "finger-spacing"],
        descriptors: [
          { level: 1, text: "Hand slaps or pushes down; elbow drops first; no feel for the water." },
          { level: 2, text: "Fingertips point down when cued; elbow still drops on most strokes." },
          { level: 3, text: "Early vertical forearm on most strokes at practice pace; elbow stays above the hand." },
          { level: 4, text: "Consistent high-elbow catch at race pace and on the breathing side." },
          { level: 5, text: "High-elbow catch holds through the full race distance with no slipping at the finish." },
        ],
      },
      {
        slug: "free-pull",
        name: "Pull",
        type: "rubric",
        stroke: "free",
        sortOrder: 4,
        builtOnSlugs: ["free-catch", "core-stability"],
      },
      {
        slug: "free-recovery",
        name: "Recovery",
        type: "rubric",
        stroke: "free",
        sortOrder: 5,
        // Per Jason: body-rotation archived; use free-rotation instead.
        builtOnSlugs: ["free-rotation"],
      },
      {
        slug: "free-kick",
        name: "Kick",
        type: "rubric",
        stroke: "free",
        sortOrder: 6,
        builtOnSlugs: ["horizontal-alignment"],
      },
      {
        slug: "free-rotation",
        name: "Rotation",
        type: "rubric",
        stroke: "free",
        sortOrder: 7,
        builtOnSlugs: ["core-stability", "horizontal-alignment"],
      },
      {
        slug: "free-kick-rate",
        name: "Kick rate",
        type: "measured",
        unit: "kicks/min",
        stroke: "free",
        sortOrder: 8,
        builtOnSlugs: ["free-kick"],
      },
      {
        slug: "free-breathing-mechanics",
        name: "Breathing mechanics",
        type: "rubric",
        stroke: "free",
        sortOrder: 9,
        // Per Jason: body-rotation archived; use free-rotation instead.
        builtOnSlugs: ["free-head-position", "free-rotation", "breath-control"],
      },
      {
        slug: "free-stroke-timing",
        name: "Stroke timing",
        type: "rubric",
        stroke: "free",
        sortOrder: 10,
        builtOnSlugs: ["free-catch", "free-kick"],
      },
      // free-distance-per-stroke archived — merged into free-stroke-count.
      {
        slug: "free-stroke-count",
        name: "Stroke count",
        type: "measured",
        unit: "strokes/length",
        stroke: "free",
        sortOrder: 11,
        builtOnSlugs: ["free-catch", "free-pull", "horizontal-alignment"],
      },
      {
        slug: "free-finishing",
        name: "Finishing",
        type: "rubric",
        stroke: "free",
        sortOrder: 12,
        builtOnSlugs: ["wall-approach", "breath-control"],
      },
      {
        slug: "free-tempo",
        name: "Tempo",
        type: "measured",
        unit: "cycles/min",
        stroke: "free",
        sortOrder: 13,
        builtOnSlugs: ["free-stroke-timing"],
      },
    ],
  },

  // ── 4. Backstroke ───────────────────────────────────────────────────────────
  {
    slug: "backstroke",
    name: "Backstroke",
    sortOrder: 4,
    skills: [
      {
        slug: "back-body-alignment",
        name: "Body alignment",
        type: "rubric",
        stroke: "back",
        sortOrder: 1,
        builtOnSlugs: ["horizontal-alignment", "hip-position"],
      },
      {
        slug: "back-head-position-stability",
        name: "Head position / stability",
        type: "rubric",
        stroke: "back",
        sortOrder: 2,
        // Per Jason: per-stroke head positions have no explicit builds-on.
        descriptors: HEAD_POSITION_DESCRIPTORS,
      },
      {
        slug: "back-rotation",
        name: "Rotation",
        type: "rubric",
        stroke: "back",
        sortOrder: 3,
        // Per Jason: body-rotation archived; use horizontal-alignment (what body-rotation depended on).
        builtOnSlugs: ["core-stability", "horizontal-alignment"],
      },
      {
        slug: "back-reach-before-entry",
        name: "Reach before entry",
        type: "rubric",
        stroke: "back",
        sortOrder: 4,
        builtOnSlugs: ["back-rotation"],
      },
      {
        slug: "back-catch",
        name: "Catch",
        type: "rubric",
        stroke: "back",
        sortOrder: 5,
        builtOnSlugs: ["back-reach-before-entry", "back-rotation"],
      },
      {
        slug: "back-pull",
        name: "Pull",
        type: "rubric",
        stroke: "back",
        sortOrder: 6,
        builtOnSlugs: ["back-catch"],
      },
      {
        slug: "back-arm-recovery",
        name: "Arm recovery",
        type: "rubric",
        stroke: "back",
        sortOrder: 7,
        builtOnSlugs: ["back-rotation"],
      },
      {
        slug: "back-kick",
        name: "Kick",
        type: "rubric",
        stroke: "back",
        sortOrder: 8,
        builtOnSlugs: ["back-body-alignment"],
      },
      {
        slug: "back-kick-rate",
        name: "Kick rate",
        type: "measured",
        unit: "kicks/min",
        stroke: "back",
        sortOrder: 9,
        builtOnSlugs: ["back-kick"],
      },
      {
        slug: "back-swimming-straight",
        name: "Swimming straight",
        type: "rubric",
        stroke: "back",
        sortOrder: 10,
        builtOnSlugs: ["back-head-position-stability", "back-stroke-timing"],
        descriptors: [
          { level: 1, text: "Zig-zags or hits the lane line within a few strokes." },
          { level: 2, text: "Drifts but corrects; touches the lane line once or twice per length." },
          { level: 3, text: "Holds a line at practice pace; uses flags or ceiling to orient." },
          { level: 4, text: "Stays straight at race pace; occasional drift on the last few strokes." },
          { level: 5, text: "Stays centered at race pace through the full race, including into the wall." },
        ],
      },
      {
        slug: "back-stroke-timing",
        name: "Stroke timing",
        type: "rubric",
        stroke: "back",
        sortOrder: 11,
        builtOnSlugs: ["back-rotation", "back-catch"],
      },
      {
        slug: "back-stroke-count",
        name: "Stroke count",
        type: "measured",
        unit: "strokes/length",
        stroke: "back",
        sortOrder: 12,
        builtOnSlugs: ["back-catch", "back-pull", "horizontal-alignment"],
      },
      {
        slug: "back-finishing",
        name: "Finishing",
        type: "rubric",
        stroke: "back",
        sortOrder: 13,
        builtOnSlugs: ["wall-approach", "breath-control"],
      },
      {
        slug: "back-tempo",
        name: "Tempo",
        type: "measured",
        unit: "cycles/min",
        stroke: "back",
        sortOrder: 14,
        builtOnSlugs: ["back-stroke-timing"],
      },
    ],
  },

  // ── 5. Breaststroke ─────────────────────────────────────────────────────────
  {
    slug: "breaststroke",
    name: "Breaststroke",
    sortOrder: 5,
    skills: [
      {
        slug: "breast-kick-mechanics",
        name: "Kick mechanics",
        type: "rubric",
        stroke: "breast",
        sortOrder: 1,
        builtOnSlugs: ["hip-position"],
        descriptors: [
          { level: 1, text: "Scissor or flutter kick; feet not turned out." },
          { level: 2, text: "Whip kick shape when cued; feet turn out on some kicks; knees too wide." },
          { level: 3, text: "Feet flexed and turned out on every kick at practice pace; knees about hip-width; legal." },
          { level: 4, text: "Narrow, fast whip at race pace; legs finish together into streamline." },
          { level: 5, text: "Powerful, legal kick holds through the full race distance with no shortening at the finish." },
        ],
      },
      {
        slug: "breast-arm-pull",
        name: "Arm pull",
        type: "rubric",
        stroke: "breast",
        sortOrder: 2,
        builtOnSlugs: ["finger-spacing"],
      },
      {
        slug: "breast-head-position",
        name: "Head position",
        type: "rubric",
        stroke: "breast",
        sortOrder: 3,
        // Per Jason: per-stroke head positions have no explicit builds-on.
        descriptors: HEAD_POSITION_DESCRIPTORS,
      },
      {
        slug: "breast-breathing",
        name: "Breathing",
        type: "rubric",
        stroke: "breast",
        sortOrder: 4,
        builtOnSlugs: ["breast-head-position", "breast-arm-pull"],
      },
      {
        slug: "breast-timing",
        name: "Timing",
        type: "rubric",
        stroke: "breast",
        sortOrder: 5,
        builtOnSlugs: ["breast-kick-mechanics", "breast-arm-pull"],
      },
      {
        slug: "breast-glide",
        name: "Glide",
        type: "rubric",
        stroke: "breast",
        sortOrder: 6,
        builtOnSlugs: ["static-streamline", "breast-timing"],
      },
      {
        slug: "breast-streamline-recovery",
        name: "Streamline recovery",
        type: "rubric",
        stroke: "breast",
        sortOrder: 7,
        builtOnSlugs: ["static-streamline"],
      },
      // breast-stroke-rate archived (duplicate of breast-tempo below).
      {
        slug: "breast-propulsion-efficiency",
        name: "Propulsion efficiency (golf score)",
        type: "score",
        unit: "time_s + stroke_count",
        stroke: "breast",
        sortOrder: 8,
        builtOnSlugs: ["breast-kick-mechanics", "breast-glide", "breast-timing"],
      },
      {
        slug: "breast-stroke-count",
        name: "Stroke count",
        type: "measured",
        unit: "strokes/length",
        stroke: "breast",
        sortOrder: 9,
        builtOnSlugs: ["breast-kick-mechanics", "breast-arm-pull"],
      },
      {
        slug: "breast-finishing",
        name: "Finishing",
        type: "rubric",
        stroke: "breast",
        sortOrder: 10,
        builtOnSlugs: ["wall-approach", "breast-timing"],
      },
      {
        slug: "breast-tempo",
        name: "Tempo",
        type: "measured",
        unit: "cycles/min",
        stroke: "breast",
        sortOrder: 11,
        builtOnSlugs: ["breast-timing"],
      },
    ],
  },

  // ── 6. Butterfly ────────────────────────────────────────────────────────────
  // Note: breathing-timing-fly is placed in Breathing & Coordination.
  {
    slug: "butterfly",
    name: "Butterfly",
    sortOrder: 6,
    skills: [
      {
        slug: "fly-body-undulation",
        name: "Body undulation",
        type: "rubric",
        stroke: "fly",
        sortOrder: 1,
        builtOnSlugs: ["core-stability", "head-position-overall"],
        descriptors: [
          { level: 1, text: "Bends at the knees or waist; chest stays flat; no wave." },
          { level: 2, text: "Chest press visible on some strokes; movement starts at the hips." },
          { level: 3, text: "Wave starts at the chest and flows to the feet at practice pace." },
          { level: 4, text: "Tight, controlled undulation at race pace; hips stay near the surface." },
          { level: 5, text: "Undulation drives the stroke through the full race distance, including breathing strokes." },
        ],
      },
      {
        slug: "fly-dolphin-kick",
        name: "Dolphin kick",
        type: "rubric",
        stroke: "fly",
        sortOrder: 2,
        builtOnSlugs: ["fly-body-undulation"],
      },
      {
        slug: "fly-kick-rate",
        name: "Kick rate",
        type: "measured",
        unit: "kicks/min",
        stroke: "fly",
        sortOrder: 3,
        builtOnSlugs: ["fly-dolphin-kick"],
      },
      {
        slug: "fly-head-position",
        name: "Head position",
        type: "rubric",
        stroke: "fly",
        sortOrder: 4,
        // Per Jason: per-stroke head positions have no explicit builds-on.
        descriptors: HEAD_POSITION_DESCRIPTORS,
      },
      {
        slug: "fly-reach-before-entry",
        name: "Reach before entry",
        type: "rubric",
        stroke: "fly",
        sortOrder: 5,
        builtOnSlugs: ["fly-body-undulation"],
      },
      {
        slug: "fly-catch",
        name: "Catch",
        type: "rubric",
        stroke: "fly",
        sortOrder: 6,
        builtOnSlugs: ["fly-reach-before-entry", "finger-spacing"],
      },
      {
        slug: "fly-pull",
        name: "Pull",
        type: "rubric",
        stroke: "fly",
        sortOrder: 7,
        builtOnSlugs: ["fly-catch"],
      },
      {
        slug: "fly-arm-recovery",
        name: "Arm recovery",
        type: "rubric",
        stroke: "fly",
        sortOrder: 8,
        builtOnSlugs: ["fly-body-undulation"],
      },
      {
        slug: "fly-two-kick-rhythm",
        name: "Two-kick rhythm",
        type: "rubric",
        stroke: "fly",
        sortOrder: 9,
        builtOnSlugs: ["fly-dolphin-kick", "fly-pull"],
      },
      {
        slug: "fly-stroke-count",
        name: "Stroke count",
        type: "measured",
        unit: "strokes/length",
        stroke: "fly",
        sortOrder: 10,
        builtOnSlugs: ["fly-catch", "fly-pull"],
      },
      {
        slug: "fly-finishing",
        name: "Finishing",
        type: "rubric",
        stroke: "fly",
        sortOrder: 11,
        builtOnSlugs: ["wall-approach", "breath-control"],
      },
      {
        slug: "fly-tempo",
        name: "Tempo",
        type: "measured",
        unit: "cycles/min",
        stroke: "fly",
        sortOrder: 12,
        builtOnSlugs: ["fly-two-kick-rhythm"],
      },
    ],
  },

  // ── 7. Starts, Turns & Underwaters ──────────────────────────────────────────
  {
    slug: "starts-turns-underwaters",
    name: "Starts, Turns & Underwaters",
    sortOrder: 7,
    skills: [
      // Underwaters — three separate grades per Jason A4.
      // udk-free-fly (old shared skill) is archived; udk-free and udk-fly are new slugs.
      {
        slug: "udk-free",
        name: "Underwater dolphin kick",
        type: "rubric",
        stroke: "free",
        sortOrder: 1,
        builtOnSlugs: ["static-streamline", "fly-dolphin-kick"],
        descriptors: UDK_DESCRIPTORS,
      },
      {
        slug: "udk-fly",
        name: "Underwater dolphin kick",
        type: "rubric",
        stroke: "fly",
        sortOrder: 2,
        builtOnSlugs: ["static-streamline", "fly-dolphin-kick"],
        descriptors: UDK_DESCRIPTORS,
      },
      {
        slug: "udk-back",
        name: "Underwater dolphin kick",
        type: "rubric",
        stroke: "back",
        sortOrder: 3,
        builtOnSlugs: ["static-streamline", "fly-dolphin-kick"],
        descriptors: UDK_DESCRIPTORS,
      },
      {
        slug: "pullout",
        name: "Pullout",
        type: "rubric",
        appliesTo: ["breast"],
        sortOrder: 3,
        builtOnSlugs: ["static-streamline", "breast-kick-mechanics"],
      },
      {
        slug: "push-off",
        name: "Push-off",
        type: "rubric",
        appliesTo: ["free", "back", "breast", "fly"],
        sortOrder: 4,
        builtOnSlugs: ["static-streamline"],
      },
      {
        slug: "breakout-free",
        name: "Breakout",
        type: "rubric",
        stroke: "free",
        sortOrder: 5,
        builtOnSlugs: ["udk-free", "free-stroke-timing"],
      },
      {
        slug: "breakout-back",
        name: "Breakout",
        type: "rubric",
        stroke: "back",
        sortOrder: 6,
        builtOnSlugs: ["udk-back", "back-stroke-timing"],
      },
      {
        slug: "breakout-breast",
        name: "Breakout",
        type: "rubric",
        stroke: "breast",
        sortOrder: 7,
        // "Stroke timing" → breast-timing (closest equivalent). See ADR 019, question 4.
        builtOnSlugs: ["pullout", "breast-timing"],
      },
      {
        slug: "breakout-fly",
        name: "Breakout",
        type: "rubric",
        stroke: "fly",
        sortOrder: 8,
        // Per Jason A9: fly breakout builds on fly UDK and two-kick rhythm.
        builtOnSlugs: ["udk-fly", "fly-two-kick-rhythm"],
      },

      // Track start (composite) + 6 components
      {
        slug: "track-start",
        name: "Track start",
        type: "composite",
        sortOrder: 9,
      },
      {
        slug: "track-start-reaction",
        name: "Reaction",
        type: "measured",
        unit: "s",
        parentSlug: "track-start",
        sortOrder: 10,
      },
      {
        slug: "track-start-acceleration",
        name: "Acceleration / force",
        type: "rubric",
        parentSlug: "track-start",
        sortOrder: 11,
      },
      {
        slug: "track-start-height",
        name: "Height",
        type: "rubric",
        parentSlug: "track-start",
        sortOrder: 12,
      },
      {
        slug: "track-start-distance",
        name: "Distance",
        type: "measured",
        unit: "ft",
        parentSlug: "track-start",
        sortOrder: 13,
      },
      {
        slug: "track-start-head-arm-hand",
        name: "Head-arm-hand alignment on entry",
        type: "rubric",
        parentSlug: "track-start",
        sortOrder: 14,
      },
      {
        slug: "track-start-leg-feet",
        name: "Leg and feet position on entry",
        type: "rubric",
        parentSlug: "track-start",
        sortOrder: 15,
      },

      // Relay start (composite) + 6 components
      {
        slug: "relay-start",
        name: "Relay start",
        type: "composite",
        sortOrder: 16,
      },
      {
        slug: "relay-start-reaction",
        name: "Reaction",
        type: "measured",
        unit: "s",
        parentSlug: "relay-start",
        sortOrder: 17,
      },
      {
        slug: "relay-start-acceleration",
        name: "Acceleration / force",
        type: "rubric",
        parentSlug: "relay-start",
        sortOrder: 18,
      },
      {
        slug: "relay-start-height",
        name: "Height",
        type: "rubric",
        parentSlug: "relay-start",
        sortOrder: 19,
      },
      {
        slug: "relay-start-distance",
        name: "Distance",
        type: "measured",
        unit: "ft",
        parentSlug: "relay-start",
        sortOrder: 20,
      },
      {
        slug: "relay-start-head-arm-hand",
        name: "Head-arm-hand alignment on entry",
        type: "rubric",
        parentSlug: "relay-start",
        sortOrder: 21,
      },
      {
        slug: "relay-start-leg-feet",
        name: "Leg and feet position on entry",
        type: "rubric",
        parentSlug: "relay-start",
        sortOrder: 22,
      },

      // Turns (rubric)
      {
        slug: "wall-approach",
        name: "Wall approach",
        type: "rubric",
        appliesTo: ["free", "back", "breast", "fly"],
        sortOrder: 23,
      },
      {
        slug: "freestyle-flip-turn",
        name: "Freestyle flip turn",
        type: "rubric",
        // Per Jason A8: applies only to freestyle; IM breast-to-free is its own skill.
        appliesTo: ["free"],
        sortOrder: 24,
      },
      {
        slug: "backstroke-flip-turn",
        name: "Backstroke flip turn",
        type: "rubric",
        stroke: "back",
        sortOrder: 25,
      },
      {
        slug: "breaststroke-open-turn",
        name: "Breaststroke open turn",
        type: "rubric",
        stroke: "breast",
        sortOrder: 26,
      },
      {
        slug: "butterfly-open-turn",
        name: "Butterfly open turn",
        type: "rubric",
        stroke: "fly",
        sortOrder: 27,
      },
      {
        slug: "im-fly-to-back",
        name: "Fly to back (open turn)",
        type: "rubric",
        appliesTo: ["fly", "back"],
        sortOrder: 28,
      },
      // im-back-to-breast archived — split into three skills below per Jason A9.
      {
        slug: "im-back-to-breast-open",
        name: "Back to breast (open turn)",
        type: "rubric",
        appliesTo: ["back", "breast"],
        sortOrder: 29,
      },
      {
        slug: "im-back-to-breast-bucket",
        name: "Back to breast (bucket turn)",
        type: "rubric",
        appliesTo: ["back", "breast"],
        sortOrder: 30,
      },
      {
        slug: "im-back-to-breast-crossover",
        name: "Back to breast (crossover turn)",
        type: "rubric",
        appliesTo: ["back", "breast"],
        sortOrder: 31,
      },
      {
        slug: "im-breast-to-free",
        name: "Breast to free (open turn)",
        type: "rubric",
        appliesTo: ["breast", "free"],
        sortOrder: 32,
      },

      // Backstroke start (composite) + 6 components
      {
        slug: "back-start",
        name: "Backstroke start",
        type: "composite",
        stroke: "back",
        sortOrder: 33,
      },
      {
        slug: "back-start-reaction",
        name: "Reaction",
        type: "measured",
        unit: "s",
        stroke: "back",
        parentSlug: "back-start",
        sortOrder: 34,
      },
      {
        slug: "back-start-push",
        name: "Push and drive",
        type: "rubric",
        stroke: "back",
        parentSlug: "back-start",
        sortOrder: 35,
      },
      {
        slug: "back-start-arch",
        name: "Arch and entry angle",
        type: "rubric",
        stroke: "back",
        parentSlug: "back-start",
        sortOrder: 36,
      },
      {
        slug: "back-start-distance",
        name: "Distance",
        type: "measured",
        unit: "ft",
        stroke: "back",
        parentSlug: "back-start",
        sortOrder: 37,
      },
      {
        slug: "back-start-entry-alignment",
        name: "Head-arm-hand alignment on entry",
        type: "rubric",
        stroke: "back",
        parentSlug: "back-start",
        sortOrder: 38,
      },
      {
        slug: "back-start-streamline",
        name: "Streamline off the wall",
        type: "rubric",
        stroke: "back",
        parentSlug: "back-start",
        sortOrder: 39,
      },
    ],
  },

  // ── 8. Racing & Performance ─────────────────────────────────────────────────
  // tempo, stroke-count, and finishing archived — replaced by per-stroke in their stroke categories.
  {
    slug: "racing-performance",
    name: "Racing & Performance",
    sortOrder: 8,
    skills: [
      {
        slug: "pacing",
        name: "Pacing",
        type: "rubric",
        sortOrder: 1,
        // Per Jason: tempo archived; keep breath-control dependency.
        builtOnSlugs: ["breath-control"],
        descriptors: [
          { level: 1, text: "Sprints the start and dies; second half far slower than the first." },
          { level: 2, text: "Aware of going out too fast; splits still widely uneven." },
          { level: 3, text: "Splits within a reasonable fade for age and event." },
          { level: 4, text: "Even or slightly negative splits in most races." },
          { level: 5, text: "Executes a planned split strategy and adjusts it in-race." },
        ],
      },
      {
        slug: "speed-endurance",
        name: "Speed endurance",
        type: "rubric",
        sortOrder: 2,
        builtOnSlugs: ["pacing"],
      },
      {
        slug: "race-strategy",
        name: "Race strategy",
        type: "rubric",
        sortOrder: 3,
        builtOnSlugs: ["pacing"],
      },
      {
        slug: "race-awareness",
        name: "Race awareness",
        type: "rubric",
        sortOrder: 4,
      },
      {
        slug: "adaptability",
        name: "Adaptability",
        type: "rubric",
        sortOrder: 5,
        builtOnSlugs: ["race-awareness"],
      },
    ],
  },

  // ── 9. Water Confidence ─────────────────────────────────────────────────────
  {
    slug: "water-confidence",
    name: "Water Confidence",
    sortOrder: 9,
    skills: [
      {
        slug: "water-submerging",
        name: "Submerging",
        type: "rubric",
        sortOrder: 1,
      },
      {
        slug: "water-front-float",
        name: "Front float",
        type: "rubric",
        sortOrder: 2,
      },
      {
        slug: "water-back-float",
        name: "Back float",
        type: "rubric",
        sortOrder: 3,
      },
      {
        slug: "water-treading",
        name: "Treading water",
        type: "rubric",
        sortOrder: 4,
      },
      {
        slug: "water-wall",
        name: "Getting to the wall",
        type: "rubric",
        sortOrder: 5,
      },
    ],
  },
];
