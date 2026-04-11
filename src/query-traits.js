import { normalizeWhitespace, uniqueStrings } from "./utils.js";

function hasPhrase(text, phrases) {
  return phrases.some((phrase) => new RegExp(`\\b${phrase}\\b`, "i").test(text));
}

function hasWoodMetalDisjunction(query) {
  return /\b(?:wood|wooden|oak|walnut|ash|maple)\b\s*(?:\/|or)\s*\b(?:metal|steel|aluminum|aluminium|chrome)\b|\b(?:metal|steel|aluminum|aluminium|chrome)\b\s*(?:\/|or)\s*\b(?:wood|wooden|oak|walnut|ash|maple)\b/i.test(
    query
  );
}

function hasAmbiguousBaseLegOrFrameMaterial(query) {
  return /\b(?:wood|wooden|oak|walnut|ash|maple|metal|steel|aluminum|aluminium|chrome)\b(?:[^.,;]{0,24})\b(?:or|\/)\b(?:[^.,;]{0,24})\b(?:base|leg|legs|frame)\b/i.test(
    query
  ) || /\b(?:base|leg|legs|frame)\b(?:[^.,;]{0,24})\b(?:wood|wooden|oak|walnut|ash|maple|metal|steel|aluminum|aluminium|chrome)\b(?:[^.,;]{0,24})\b(?:or|\/)\b/i.test(
    query
  );
}

function detectBaseType(query) {
  if (hasPhrase(query, ["sled base", "sled"])) {
    return "sled base";
  }
  if (hasPhrase(query, ["cantilever base", "cantilever"])) {
    return "cantilever base";
  }
  if (hasPhrase(query, ["caster base", "casters", "caster", "wheels", "wheel", "rolling base", "rolling"])) {
    return "caster base";
  }
  if (hasPhrase(query, ["pedestal base", "4 star", "four star", "5 star", "five star", "five-legged base", "five legged base", "five-leg base", "five spoke base", "five-spoke base", "square base", "flat square base"])) {
    return "pedestal base";
  }
  if (hasPhrase(query, ["4 point legs", "4 point leg", "four point legs", "four point leg", "four legs", "4 legs"])) {
    return "four-leg base";
  }
  if (hasPhrase(query, ["metal base", "chrome base", "steel base", "aluminum base", "aluminium base"])) {
    return "metal base";
  }
  return "";
}

function detectFrameMaterial(query) {
  if (hasWoodMetalDisjunction(query) && /\b(frame|base|leg|legs)\b/.test(query)) {
    return "";
  }
  if (hasPhrase(query, ["wood", "wooden", "oak", "walnut", "ash", "maple"])) {
    return "wood";
  }
  if (hasPhrase(query, ["metal", "steel", "aluminum", "aluminium", "chrome"])) {
    return "metal";
  }
  return "";
}

function detectBaseMaterial(query) {
  if (hasWoodMetalDisjunction(query) && /\b(base|leg|legs)\b/.test(query)) {
    return "";
  }
  if (hasPhrase(query, ["wood base", "wood legs", "wooden base", "wooden legs", "oak base", "walnut base"])) {
    return "wood";
  }
  if (hasPhrase(query, ["metal base", "metal legs", "chrome base", "chrome legs", "steel base", "aluminum base", "aluminium base"])) {
    return "metal";
  }
  return "";
}

function detectBaseFrameFinish(query) {
  if (hasPhrase(query, ["wood base", "wood legs", "wooden base", "wooden legs", "oak base", "walnut base"])) {
    return "wood";
  }
  if (hasPhrase(query, ["black", "charcoal", "graphite"])) {
    return "black";
  }
  if (hasPhrase(query, ["white", "arctic white"])) {
    return "white";
  }
  if (hasPhrase(query, ["chrome", "polished", "polished aluminum", "aluminum", "aluminium"])) {
    return "polished";
  }
  return "";
}

function detectBaseTypeDetail(query) {
  if (hasPhrase(query, ["five-spoke", "five spoke", "spoked base", "spoked legs"])) {
    return "spoked base";
  }
  if (hasPhrase(query, ["angled legs", "tapered legs"])) {
    return "angled legs";
  }
  if (hasPhrase(query, ["straight legs", "four straight legs"])) {
    return "straight legs";
  }
  if (hasPhrase(query, ["dowel base", "dowel legs"])) {
    return "dowel legs";
  }
  return "";
}

function detectFrameFinish(query) {
  if (hasPhrase(query, ["chrome", "polished chrome"])) {
    return "chrome";
  }
  return "";
}

function detectDominantColor(query) {
  if (hasPhrase(query, ["red", "crimson", "scarlet", "ruby", "burgundy"])) {
    return "red";
  }
  if (hasPhrase(query, ["orange", "rust", "terracotta", "coral"])) {
    return "orange";
  }
  if (hasPhrase(query, ["brown", "tan", "camel", "cognac", "caramel"])) {
    return "brown";
  }
  if (hasPhrase(query, ["blue", "navy", "teal"])) {
    return "blue";
  }
  if (hasPhrase(query, ["green", "olive"])) {
    return "green";
  }
  if (hasPhrase(query, ["yellow", "gold", "mustard"])) {
    return "yellow";
  }
  if (hasPhrase(query, ["black", "charcoal", "gray", "grey", "white", "neutral"])) {
    return "neutral";
  }
  return "";
}

function detectBackConstruction(query) {
  if (hasPhrase(query, ["mesh back", "suspension back", "pellicle", "interweave", "3d knit", "knit back"])) {
    return "mesh or suspension back";
  }
  if (hasPhrase(query, ["upholstered back"])) {
    return "upholstered back";
  }
  if (hasPhrase(query, ["polymer back", "plastic back"])) {
    return "polymer back";
  }
  return "";
}

function detectArmAdjustability(query) {
  if (hasPhrase(query, ["fully adjustable arms", "4d arms", "four-way arms", "pivot depth width adjustable arms"])) {
    return "fully adjustable";
  }
  if (hasPhrase(query, ["height adjustable arms", "height-adjustable arms", "adjustable arms"])) {
    return "height-adjustable";
  }
  if (hasPhrase(query, ["fixed arms", "with arms"])) {
    return "fixed";
  }
  return "";
}

function detectTopMaterial(query) {
  if (hasPhrase(query, ["wood top", "wood tabletop", "wood table"])) {
    return "wood";
  }
  if (hasPhrase(query, ["glass top", "glass table"])) {
    return "glass";
  }
  if (hasPhrase(query, ["metal top", "metal table"])) {
    return "metal";
  }
  return "";
}

function detectTopShape(query) {
  if (hasPhrase(query, ["round table", "round top"])) {
    return "round";
  }
  if (hasPhrase(query, ["rectangular table", "rectangle table", "rectangular top"])) {
    return "rectangular";
  }
  return "";
}

function detectSeatMaterial(query) {
  if (hasPhrase(query, ["leather", "leather upholstery"])) {
    return "leather upholstery";
  }
  if (hasPhrase(query, ["fabric", "upholstery", "textile", "mesh"])) {
    return "fabric upholstery";
  }
  return "";
}

function detectProductType(query) {
  if (hasPhrase(query, ["stool", "stools"])) {
    return "stool";
  }
  if (hasPhrase(query, ["table", "tables", "desk", "desks"])) {
    return "table";
  }
  if (hasPhrase(query, ["chair", "chairs", "seating"])) {
    return "chair";
  }
  return "";
}

function buildRequiredPhrases(traits) {
  return uniqueStrings([
    traits.base_type,
    traits.base_finish ? `${traits.base_finish} finish` : "",
    traits.base_frame_finish ? `${traits.base_frame_finish} base` : "",
    traits.frame ? `${traits.frame} frame` : "",
    traits.arm_adjustability ? `${traits.arm_adjustability} arms` : "",
    traits.back_style,
    traits.lumbar_support,
    traits.arm_material ? `${traits.arm_material} arms` : traits.arms_present === true ? "arms" : traits.arms_present === false ? "armless" : "",
    traits.seat_material,
    traits.seat_fabric,
    traits.design_register,
    ...(traits.required_features || [])
  ]);
}

export function extractQueryTraits(query) {
  const normalized = normalizeWhitespace(query).toLowerCase();
  const armsAbsent = hasPhrase(normalized, ["armless", "armrest-free", "armrest free", "without arms", "without arm", "without armrests", "no arms", "no arm"]);
  const armsPresent = !armsAbsent && hasPhrase(normalized, ["with arms", "armrests", "armrest", "arms", "arms"]);
  const frameMaterial = detectFrameMaterial(normalized);

  const traits = {
    product_type: detectProductType(normalized),
    seating_category_visual: hasPhrase(normalized, ["guest seating", "guest chair", "guest chairs"])
      ? "guest seating"
      : hasPhrase(normalized, ["lounge seating", "lounge chair", "lounge chairs"])
        ? "lounge seating"
        : "",
    dominant_color: detectDominantColor(normalized),
    base_type: detectBaseType(normalized),
    base_frame_finish: detectBaseFrameFinish(normalized) || detectBaseMaterial(normalized),
    frame: frameMaterial,
    base_finish: detectFrameFinish(normalized) || detectDominantColor(normalized),
    leg_material: detectBaseMaterial(normalized),
    leg_style: detectBaseTypeDetail(normalized),
    arms_present: armsAbsent ? false : armsPresent ? true : null,
    arm_type: armsAbsent ? "no arms" : armsPresent ? "fixed arms" : "",
    arm_material: armsPresent && frameMaterial ? frameMaterial : "",
    arm_adjustability: detectArmAdjustability(normalized),
    back_style: detectBackConstruction(normalized),
    lumbar_support: hasPhrase(normalized, ["lumbar support", "back support", "posturefit", "lumbar", "sacral"]) ? "lumbar support" : "",
    seat_depth_adjustable: hasPhrase(normalized, ["seat depth adjustment", "adjustable seat depth", "flexfront"]),
    headrest_present: hasPhrase(normalized, ["headrest", "neck support"]),
    caster_present: hasPhrase(normalized, ["caster", "casters", "wheel", "wheels", "rolling"]),
    seat_material: detectSeatMaterial(normalized),
    back_material: detectSeatMaterial(normalized),
    seat_fabric: detectSeatMaterial(normalized),
    design_register: hasPhrase(normalized, ["industrial"]) ? "industrial" : detectDominantColor(normalized),
    required_features: uniqueStrings([
      hasPhrase(normalized, ["exposed wood frame", "wood frame"]) ? "exposed wood frame" : "",
      hasPhrase(normalized, [
        "upholstered seat and back",
        "seat and back upholstered",
        "upholstered back and seat",
        "fully upholstered seat and back"
      ])
        ? "upholstered seat and back"
        : "",
      hasPhrase(normalized, ["legs", "leg"]) && !detectBaseType(normalized) ? "legs" : ""
    ])
  };

  if (hasAmbiguousBaseLegOrFrameMaterial(normalized)) {
    if (traits.base_type === "metal base") {
      traits.base_type = "";
    }
    traits.base_frame_finish = "";
    traits.leg_material = "";
    if (hasWoodMetalDisjunction(normalized)) {
      traits.frame = "";
    }
  }

  return {
    ...traits,
    required_phrases: buildRequiredPhrases(traits)
  };
}

export function normalizeBaseType(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("sled")) {
    return "sled base";
  }
  if (normalized.includes("cantilever")) {
    return "cantilever base";
  }
  if (normalized.includes("caster") || normalized.includes("wheel")) {
    return "caster base";
  }
  if (normalized.includes("pedestal") || normalized.includes("star")) {
    return "pedestal base";
  }
  if (normalized.includes("four") || normalized.includes("leg")) {
    return "four-leg base";
  }
  if (normalized.includes("metal base")) {
    return "metal base";
  }
  return normalized;
}

export function compareTraits(queryTraits, visualTraits) {
  const matches = [];
  const mismatches = [];
  const breakdown = [];
  let adjustment = 0;

  if (!queryTraits) {
    return { adjustment, matches, mismatches };
  }

  const imageBaseType = normalizeBaseType(visualTraits?.base_type);
  const imageBaseMaterial = String(visualTraits?.base_frame_finish || visualTraits?.base_material || "").toLowerCase();
  const imageFrameMaterial = String(visualTraits?.frame || visualTraits?.frame_material || "").toLowerCase();
  const imageFrameFinish = String(visualTraits?.base_finish || visualTraits?.frame_finish || "").toLowerCase();
  const imageLegMaterial = String(visualTraits?.base_frame_finish || visualTraits?.leg_material || "").toLowerCase();
  const imageLegStyle = String(visualTraits?.base_type || visualTraits?.leg_style || "").toLowerCase();
  const imageArmType = String(visualTraits?.arm_option || visualTraits?.arm_type || "").toLowerCase();
  const imageArmAdjustability = String(visualTraits?.arm_adjustability || "").toLowerCase();
  const imageBackConstruction = String(visualTraits?.back_style || visualTraits?.back_construction || "").toLowerCase();
  const imageBackSupport = String(visualTraits?.lumbar_support || visualTraits?.back_support_type || "").toLowerCase();
  const imageLumbarSupport = String(visualTraits?.lumbar_support || visualTraits?.lumbar_support_type || "").toLowerCase();
  const imageSeatMaterial = String(visualTraits?.seat_material || visualTraits?.top_material || "").toLowerCase();
  const imageBackMaterial = String(visualTraits?.back_material || "").toLowerCase();
  const imageArmMaterial = String(visualTraits?.arm_material || "").toLowerCase();
  const imageSeatFabric = String(visualTraits?.seat_fabric || visualTraits?.seat_type || "").toLowerCase();
  const imageDesignRegister = String(visualTraits?.design_register || visualTraits?.dominant_color || "").toLowerCase();
  const imageNotable = (visualTraits?.notable_features || []).join(" ").toLowerCase();
  const imageDetails = (visualTraits?.material_details || []).join(" ").toLowerCase();
  const explicitBaseType = normalizeBaseType(queryTraits.base_type);

  const comparisons = [
    {
      key: "base_type",
      expected: normalizeBaseType(queryTraits.base_type),
      actual: imageBaseType,
      weight: 0.15,
      label: queryTraits.base_type
    },
    {
      key: "frame",
      expected: String(queryTraits.frame || queryTraits.frame_material || "").toLowerCase(),
      actual: imageFrameMaterial,
      weight: 0.14,
      label: queryTraits.frame || queryTraits.frame_material ? `${queryTraits.frame || queryTraits.frame_material} frame` : ""
    },
    {
      key: "base_frame_finish",
      expected: String(queryTraits.base_frame_finish || queryTraits.base_material || "").toLowerCase(),
      actual: [imageBaseMaterial, imageLegMaterial].join(" "),
      weight: 0.14,
      label: queryTraits.base_frame_finish || queryTraits.base_material ? `${queryTraits.base_frame_finish || queryTraits.base_material} base` : ""
    },
    {
      key: "base_type_detail",
      expected: String(queryTraits.leg_style || "").toLowerCase(),
      actual: imageLegStyle,
      weight: 0.08,
      label: queryTraits.leg_style
    },
    {
      key: "base_finish",
      expected: String(queryTraits.base_finish || queryTraits.frame_finish || "").toLowerCase(),
      actual: imageFrameFinish,
      weight: 0.12,
      label: queryTraits.base_finish || queryTraits.frame_finish ? `${queryTraits.base_finish || queryTraits.frame_finish} finish` : ""
    },
    {
      key: "back_style",
      expected: String(queryTraits.back_style || queryTraits.back_construction || "").toLowerCase(),
      actual: imageBackConstruction,
      weight: 0.11,
      label: queryTraits.back_style || queryTraits.back_construction
    },
    {
      key: "lumbar_support",
      expected: String(queryTraits.lumbar_support || queryTraits.back_support_type || queryTraits.lumbar_support_type || "").toLowerCase(),
      actual: [imageBackSupport, imageLumbarSupport].join(" "),
      weight: 0.1,
      label: queryTraits.lumbar_support || queryTraits.back_support_type || queryTraits.lumbar_support_type
    },
    {
      key: "seat_material",
      expected: String(queryTraits.seat_material || queryTraits.top_material || "").toLowerCase(),
      actual: [imageSeatMaterial, imageBackMaterial, imageDetails, imageNotable].join(" "),
      weight: 0.11,
      label: queryTraits.seat_material || queryTraits.top_material
    },
    {
      key: "seat_fabric",
      expected: String(queryTraits.seat_fabric || queryTraits.seat_type || "").toLowerCase(),
      actual: [imageSeatFabric, imageSeatMaterial, imageDetails, imageNotable].join(" "),
      weight: 0.12,
      label: queryTraits.seat_fabric || queryTraits.seat_type || ""
    },
    {
      key: "design_register",
      expected: String(queryTraits.design_register || queryTraits.dominant_color || "").toLowerCase(),
      actual: [imageDesignRegister, imageFrameFinish].join(" "),
      weight: 0.16,
      label: queryTraits.design_register || queryTraits.dominant_color ? `${queryTraits.design_register || queryTraits.dominant_color}` : ""
    }
  ];

  for (const comparison of comparisons) {
    if (!comparison.expected) {
      continue;
    }

    if (
      comparison.key === "base_frame_finish" &&
      explicitBaseType === "metal base" &&
      comparison.expected === "metal"
    ) {
      continue;
    }

    if (comparison.key === "base_type" && comparison.expected === "metal base") {
      const hasMetalBase =
        [imageBaseMaterial, imageLegMaterial].join(" ").includes("metal") ||
        imageBaseType.includes("sled") ||
        imageBaseType.includes("cantilever");
      if (hasMetalBase) {
        adjustment += 0.08;
        matches.push("metal base");
        breakdown.push({
          label: "metal base match",
          value: 0.08
        });
      } else {
        adjustment -= 0.08;
        mismatches.push("missing metal base");
        breakdown.push({
          label: "missing metal base",
          value: -0.08
        });
      }
      continue;
    }

    if (comparison.key === "base_type" && comparison.expected === "caster base") {
      if (visualTraits?.caster_present || comparison.actual.includes("caster")) {
        adjustment += comparison.weight;
        matches.push("casters");
        breakdown.push({
          label: "caster match",
          value: comparison.weight
        });
      } else {
        adjustment -= 0.12;
        mismatches.push("missing casters");
        breakdown.push({
          label: "missing casters",
          value: -0.12
        });
      }
      continue;
    }

    if (comparison.key === "seat_material" && comparison.expected.includes("fabric")) {
      const actual = comparison.actual || "";
      if (/\b(fabric|textile|upholster)\b/.test(actual)) {
        adjustment += comparison.weight;
        matches.push(comparison.label);
        breakdown.push({
          label: `${comparison.label} match`,
          value: comparison.weight
        });
        continue;
      }

      if (/\b(cushion|cushioned|tufted|plush)\b/.test(actual)) {
        adjustment += 0.06;
        matches.push("upholstery-like seat");
        breakdown.push({
          label: "upholstery-like seat match",
          value: 0.06
        });
        continue;
      }
    }

    if (comparison.actual.includes(comparison.expected)) {
      adjustment += comparison.weight;
      matches.push(comparison.label);
      breakdown.push({
        label: `${comparison.label} match`,
        value: comparison.weight
      });
    } else {
      const penalty = comparison.key === "base_type" ? 0.24 : comparison.weight;
      adjustment -= penalty;
      mismatches.push(`missing ${comparison.label}`);
      breakdown.push({
        label: `missing ${comparison.label}`,
        value: -penalty
      });
    }
  }

  if (explicitBaseType) {
    const contradictoryBaseTypes = {
      "four-leg base": ["cantilever base", "sled base", "pedestal base", "caster base"],
      "cantilever base": ["four-leg base", "sled base", "pedestal base", "caster base"],
      "sled base": ["four-leg base", "cantilever base", "pedestal base", "caster base"],
      "pedestal base": ["four-leg base", "cantilever base", "sled base"],
      "caster base": ["four-leg base", "cantilever base", "sled base"]
    };

    if ((contradictoryBaseTypes[explicitBaseType] || []).includes(imageBaseType)) {
      adjustment -= 0.12;
      mismatches.push(`wrong base type: ${imageBaseType}`);
      breakdown.push({
        label: `wrong base type: ${imageBaseType}`,
        value: -0.12
      });
    }
  }

  if (queryTraits.arms_present === false) {
    if (visualTraits?.arms_present) {
      adjustment -= 0.1;
      mismatches.push("has arms");
      breakdown.push({
        label: "has arms",
        value: -0.1
      });
    } else {
      adjustment += 0.1;
      matches.push("armless");
      breakdown.push({
        label: "armless match",
        value: 0.1
      });
    }
  }

  if (queryTraits.arms_present === true) {
    if (visualTraits?.arms_present) {
      adjustment += 0.1;
      matches.push(imageArmType || (imageArmMaterial ? `${imageArmMaterial} arms` : "arms"));
      breakdown.push({
        label: "arms match",
        value: 0.1
      });
    } else {
      adjustment -= 0.16;
      mismatches.push("missing arms");
      breakdown.push({
        label: "missing arms",
        value: -0.16
      });
    }
  }

  if (queryTraits.arm_adjustability) {
    if (imageArmAdjustability.includes(String(queryTraits.arm_adjustability).toLowerCase())) {
      adjustment += 0.08;
      matches.push(`${queryTraits.arm_adjustability} arms`);
      breakdown.push({
        label: `${queryTraits.arm_adjustability} arms match`,
        value: 0.08
      });
    } else {
      adjustment -= 0.08;
      mismatches.push(`missing ${queryTraits.arm_adjustability} arms`);
      breakdown.push({
        label: `missing ${queryTraits.arm_adjustability} arms`,
        value: -0.08
      });
    }
  }

  if (queryTraits.seat_depth_adjustable) {
    if (visualTraits?.seat_depth_adjustable) {
      adjustment += 0.08;
      matches.push("adjustable seat depth");
      breakdown.push({
        label: "adjustable seat depth",
        value: 0.08
      });
    } else {
      adjustment -= 0.08;
      mismatches.push("missing adjustable seat depth");
      breakdown.push({
        label: "missing adjustable seat depth",
        value: -0.08
      });
    }
  }

  if (queryTraits.headrest_present) {
    if (visualTraits?.headrest_present) {
      adjustment += 0.08;
      matches.push("headrest");
      breakdown.push({
        label: "headrest match",
        value: 0.08
      });
    } else {
      adjustment -= 0.08;
      mismatches.push("missing headrest");
      breakdown.push({
        label: "missing headrest",
        value: -0.08
      });
    }
  }

  if (queryTraits.caster_present) {
    if (visualTraits?.caster_present) {
      adjustment += 0.08;
      matches.push("casters");
      breakdown.push({
        label: "casters match",
        value: 0.08
      });
    } else {
      adjustment -= 0.1;
      mismatches.push("missing casters");
      breakdown.push({
        label: "missing casters",
        value: -0.1
      });
    }
  }

  for (const phrase of queryTraits.required_features || []) {
    const haystack = [
      imageDetails,
      imageNotable,
      imageBaseType,
      imageBaseMaterial,
      imageFrameMaterial,
      imageSeatMaterial,
      imageSeatFabric,
      imageDesignRegister
    ].join(" ");
    const token = phrase.toLowerCase();
    if (haystack.includes(token) || (token === "legs" && imageBaseType.includes("base"))) {
      adjustment += 0.06;
      matches.push(phrase);
      breakdown.push({
        label: `${phrase} match`,
        value: 0.06
      });
    } else {
      adjustment -= 0.05;
      mismatches.push(`missing ${phrase}`);
      breakdown.push({
        label: `missing ${phrase}`,
        value: -0.05
      });
    }
  }

  return {
    adjustment,
    breakdown,
    matches: uniqueStrings(matches),
    mismatches: uniqueStrings(mismatches)
  };
}
