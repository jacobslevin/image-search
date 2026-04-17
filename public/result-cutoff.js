export const RESULT_CUTOFF_DEFAULTS = {
  minResults: 3,
  maxResults: 20,
  minGapAbsolute: 0.3,
  minGapRatio: 1.5,
  relativeFloor: 0.7,
  uniformThreshold: 0.8
};

function clampCutoff(value, minResults, maxResults, total) {
  const bounded = Math.max(minResults, Number(value) || 0);
  if (Number.isFinite(maxResults) && maxResults > 0) {
    return Math.min(bounded, maxResults, total);
  }
  return Math.min(bounded, total);
}

export function findCutoff(scores, options = {}) {
  const {
    minResults,
    maxResults,
    minGapAbsolute,
    minGapRatio,
    relativeFloor,
    uniformThreshold
  } = { ...RESULT_CUTOFF_DEFAULTS, ...(options || {}) };

  const sorted = [...(Array.isArray(scores) ? scores : [])]
    .map((score) => Number(score))
    .filter((score) => Number.isFinite(score))
    .sort((a, b) => b - a);

  if (sorted.length <= minResults) {
    return { cutoff: sorted.length, reason: "too_few" };
  }

  if (sorted[sorted.length - 1] >= sorted[0] * uniformThreshold) {
    return { cutoff: sorted.length, reason: "uniform" };
  }

  const gaps = [];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    gaps.push({
      index: index + 1,
      gap: sorted[index] - sorted[index + 1]
    });
  }

  const sortedGaps = gaps
    .map((entry) => entry.gap)
    .sort((a, b) => a - b);
  const medianGap = sortedGaps.length
    ? sortedGaps[Math.floor(sortedGaps.length / 2)]
    : 0;

  const candidates = gaps.filter((entry) =>
    entry.index >= minResults &&
    entry.index <= maxResults &&
    entry.gap >= minGapAbsolute &&
    entry.gap >= medianGap * minGapRatio
  );

  if (candidates.length) {
    const best = candidates.reduce((currentBest, candidate) =>
      candidate.gap > currentBest.gap ? candidate : currentBest
    );
    return { cutoff: best.index, reason: "gap" };
  }

  const threshold = sorted[0] * relativeFloor;
  const firstBelowThreshold = sorted.findIndex((score) => score < threshold);
  const cutoff = firstBelowThreshold === -1
    ? sorted.length
    : clampCutoff(firstBelowThreshold, minResults, maxResults, sorted.length);

  return { cutoff, reason: "relative" };
}
