export const SCREEN_SECTIONS: Record<string, Array<{ name: string; slugs: string[] }>> = {
  freestyle: [
    { name: "The swim", slugs: ["free-head-position","free-horizontal-alignment","free-hip-position","free-rotation","free-reach-before-entry","free-catch","free-pull","free-recovery","free-kick","free-stroke-timing"] },
    { name: "Numbers", slugs: ["free-kick-rate","free-tempo","free-stroke-count","free-golf-score","free-finishing"] },
  ],
  backstroke: [
    { name: "The swim", slugs: ["back-head-position-stability","back-body-alignment","back-hip-position","back-rotation","back-reach-before-entry","back-catch","back-pull","back-arm-recovery","back-kick","back-swimming-straight","back-stroke-timing"] },
    { name: "Numbers", slugs: ["back-kick-rate","back-tempo","back-stroke-count","back-golf-score","back-finishing"] },
  ],
  breaststroke: [
    { name: "The swim", slugs: ["breast-head-position","breast-horizontal-alignment","breast-hip-position","breast-kick-mechanics","breast-arm-pull","breast-timing","breast-glide","breast-streamline-recovery"] },
    { name: "Numbers", slugs: ["breast-tempo","breast-stroke-count","breast-propulsion-efficiency","breast-finishing"] },
  ],
  butterfly: [
    { name: "The swim", slugs: ["fly-head-position","fly-horizontal-alignment","fly-hip-position","fly-body-undulation","fly-dolphin-kick","fly-reach-before-entry","fly-catch","fly-pull","fly-arm-recovery","fly-two-kick-rhythm"] },
    { name: "Numbers", slugs: ["fly-kick-rate","fly-tempo","fly-stroke-count","fly-golf-score","fly-finishing"] },
  ],
  "body-position-balance": [
    { name: "Fundamentals", slugs: ["buoyancy-balance","head-position-overall","core-stability","static-streamline","finger-spacing","sculling"] },
  ],
  "breathing-coordination": [
    { name: "Swimmer-level", slugs: ["exhalation","breath-control"] },
    { name: "Freestyle", slugs: ["breathing-timing-free","stroke-breath-coordination-free","free-rhythmic-breathing","free-bilateral-breathing"] },
    { name: "Backstroke", slugs: ["back-rhythmic-breathing"] },
    { name: "Breaststroke", slugs: ["breathing-timing-breast","stroke-breath-coordination-breast"] },
    { name: "Butterfly", slugs: ["breathing-timing-fly","stroke-breath-coordination-fly","fly-rhythmic-breathing"] },
  ],
  "starts-turns-underwaters": [
    { name: "Underwaters", slugs: ["udk-free","udk-fly","udk-back","pullout"] },
    { name: "Push-off & Streamline", slugs: ["push-off","streamline-in-motion"] },
    { name: "Breakouts", slugs: ["breakout-free","breakout-back","breakout-breast","breakout-fly"] },
    { name: "Starts", slugs: ["track-start","relay-start","back-start"] },
    { name: "Turns", slugs: ["wall-approach","freestyle-flip-turn","backstroke-flip-turn","breaststroke-open-turn","butterfly-open-turn","im-fly-to-back","im-back-to-breast-open","im-back-to-breast-bucket","im-back-to-breast-crossover","im-breast-to-free"] },
  ],
  "racing-performance": [
    { name: "Racing", slugs: ["pacing","speed-endurance","race-strategy","race-awareness","adaptability"] },
  ],
  "water-confidence": [
    { name: "Water Confidence", slugs: ["water-submerging","water-front-float","water-back-float","water-treading","water-wall"] },
  ],
};
