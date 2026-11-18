// Section layout per screen. Stroke screens follow race order
// (Start → Underwaters → Breakout → The swim → The wall → Finish → Numbers)
// per docs/reference/decisions-screens-skills-2026-10-14.md.
//
// A single skill slug may appear in more than one section on the same screen
// (push-off and streamline-in-motion show up in both "Start" and "The wall").
// buildSectionGroups renders the row in each section it's listed under; the
// draft state is keyed by skillId, so one grade flows through all appearances.
//
// Composite start skills (`track-start`, `relay-start`, `back-start`) are
// listed by the PARENT slug only — StartGroupSection renders their
// components. Listing the component slugs here as well would double-render.

export const SCREEN_SECTIONS: Record<string, Array<{ name: string; slugs: string[] }>> = {
  fundamentals: [
    { name: "Fundamentals", slugs: ["buoyancy-balance","head-position-overall","core-stability","static-streamline","finger-spacing","sculling","exhalation","breath-control"] },
  ],
  "water-confidence": [
    { name: "Water Confidence", slugs: ["water-submerging","water-front-float","water-back-float","water-treading","water-wall"] },
  ],
  freestyle: [
    { name: "Start", slugs: ["track-start","push-off","streamline-in-motion"] },
    { name: "Underwaters", slugs: ["udk-free"] },
    { name: "Breakout", slugs: ["breakout-free"] },
    { name: "The swim", slugs: ["free-head-position","free-horizontal-alignment","free-hip-position","free-rotation","free-reach-before-entry","free-catch","free-pull","free-recovery","free-kick","breathing-timing-free","stroke-breath-coordination-free","free-rhythmic-breathing","free-stroke-timing","free-bilateral-breathing"] },
    { name: "The wall", slugs: ["wall-approach","freestyle-flip-turn","push-off","streamline-in-motion"] },
    { name: "Finish", slugs: ["free-finishing"] },
    { name: "Numbers", slugs: ["free-kick-rate","free-tempo","free-stroke-count","free-golf-score"] },
  ],
  backstroke: [
    { name: "Start", slugs: ["back-start","streamline-in-motion"] },
    { name: "Underwaters", slugs: ["udk-back"] },
    { name: "Breakout", slugs: ["breakout-back"] },
    { name: "The swim", slugs: ["back-head-position-stability","back-body-alignment","back-hip-position","back-rotation","back-reach-before-entry","back-catch","back-pull","back-arm-recovery","back-kick","back-swimming-straight","back-rhythmic-breathing","back-stroke-timing"] },
    { name: "The wall", slugs: ["wall-approach","backstroke-flip-turn","push-off","streamline-in-motion"] },
    { name: "Finish", slugs: ["back-finishing"] },
    { name: "Numbers", slugs: ["back-kick-rate","back-tempo","back-stroke-count","back-golf-score"] },
  ],
  breaststroke: [
    { name: "Start", slugs: ["track-start","push-off","streamline-in-motion"] },
    { name: "Underwaters", slugs: ["pullout"] },
    { name: "Breakout", slugs: ["breakout-breast"] },
    { name: "The swim", slugs: ["breast-head-position","breast-horizontal-alignment","breast-hip-position","breast-kick-mechanics","breast-arm-pull","breathing-timing-breast","stroke-breath-coordination-breast","breast-timing","breast-glide","breast-streamline-recovery"] },
    { name: "The wall", slugs: ["wall-approach","breaststroke-open-turn"] },
    { name: "Finish", slugs: ["breast-finishing"] },
    { name: "Numbers", slugs: ["breast-tempo","breast-stroke-count","breast-propulsion-efficiency"] },
  ],
  butterfly: [
    { name: "Start", slugs: ["track-start","push-off","streamline-in-motion"] },
    { name: "Underwaters", slugs: ["udk-fly"] },
    { name: "Breakout", slugs: ["breakout-fly"] },
    { name: "The swim", slugs: ["fly-head-position","fly-horizontal-alignment","fly-hip-position","fly-body-undulation","fly-dolphin-kick","fly-reach-before-entry","fly-catch","fly-pull","fly-arm-recovery","breathing-timing-fly","stroke-breath-coordination-fly","fly-rhythmic-breathing","fly-two-kick-rhythm"] },
    { name: "The wall", slugs: ["wall-approach","butterfly-open-turn","push-off","streamline-in-motion"] },
    { name: "Finish", slugs: ["fly-finishing"] },
    { name: "Numbers", slugs: ["fly-kick-rate","fly-tempo","fly-stroke-count","fly-golf-score"] },
  ],
  starts: [
    { name: "Underwaters", slugs: ["udk-free","udk-fly","udk-back","pullout"] },
    { name: "Push-off & Streamline", slugs: ["push-off","streamline-in-motion"] },
    { name: "Breakouts", slugs: ["breakout-free","breakout-back","breakout-breast","breakout-fly"] },
    { name: "Starts", slugs: ["track-start","relay-start","back-start"] },
    { name: "Turns", slugs: ["wall-approach","freestyle-flip-turn","backstroke-flip-turn","breaststroke-open-turn","butterfly-open-turn"] },
  ],
  "im-turns": [
    { name: "IM Turns", slugs: ["im-fly-to-back","im-back-to-breast-open","im-back-to-breast-bucket","im-back-to-breast-crossover","im-breast-to-free"] },
  ],
  racing: [
    { name: "Racing", slugs: ["pacing","speed-endurance","race-strategy","race-awareness","adaptability"] },
  ],
};
