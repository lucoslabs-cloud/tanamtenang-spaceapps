/**
 * Scores a site against an enterprise's requirement envelopes.
 *
 * A port of `App\Suitability\SuitabilityEngine`, with one difference that is
 * the reason this build exists. The platform compiles the envelopes into SQL
 * because a map tile asks for the score of up to 68,000 cells and the
 * arithmetic has to happen next to the data. Here the data is already in the
 * browser, so the same arithmetic runs in a worker — and a farmer can drag a
 * priority slider and watch the district repaint, which no amount of SQL can
 * do over a network.
 *
 * The three stages are unchanged:
 *
 *  1. Fold the farmer's priorities into each requirement's weight.
 *  2. Evaluate the trapezoid per requirement — 0..1, or null where the
 *     metric was never ingested.
 *  3. Aggregate: a weighted *geometric* mean, pulled toward its weakest
 *     term, plus coverage and the limiting factors.
 *
 * The geometric mean is the important choice and it is not a detail. An
 * arithmetic mean lets four excellent metrics hide one fatal one, and a
 * farmer cannot eat the average of good rainfall and impossible soil. This
 * encodes Liebig's law of the minimum instead.
 */

import { direction, scoreRequirement, severity } from './membership';
import { classFromScore, metric } from './vocabulary';
import type {
    Assessment,
    ClassCode,
    Enterprise,
    FactorScore,
    Meta,
    MetricKey,
    Requirement,
    Site,
} from './types';

interface Weighted {
    requirement: Requirement;
    weight: number;
}

let config: Meta['suitability'] = {
    classThresholds: { S1: 85, S2: 70, S3: 50, N1: 25 },
    aggregation: { method: 'weighted_geometric_mean', score_floor: 0.02, minimum_factor_pull: 0.25 },
    limitingFactors: {
        threshold: 0.8,
        max_reported: 6,
        severity: { severe: 0.35, moderate: 0.6, slight: 0.8 },
    },
    groupWeights: { climate: 1, terrain: 1, soil: 1, water: 1, vegetation: 0.5 },
    priorities: {},
    priorityPresets: {},
    waterTemperature: { lapse_rate_c_per_km: 6.5, pond_warming_c: 1 },
    erosion: { reference_rkls: 100, structure_code: 3, slope_length_m: 50 },
};

export function configureSuitability(suitability: Meta['suitability']): void {
    config = suitability;
}

export type Priorities = Record<string, number>;

/** The default weighting, from the catalogue rather than from a guess. */
export function defaultPriorities(): Priorities {
    const out: Priorities = {};

    for (const [key, definition] of Object.entries(config.priorities)) {
        out[key] = definition.default;
    }

    return out;
}

export function priorityDefinitions(): Meta['suitability']['priorities'] {
    return config.priorities;
}

export function priorityPresets(): Meta['suitability']['priorityPresets'] {
    return config.priorityPresets;
}

/**
 * Requirements with the farmer's priorities folded into the weights.
 *
 * Each priority the farmer has turned up scales the metrics it cares about.
 * A priority weight of 0 leaves the metric alone; a weight of 1 applies the
 * full multiplier. Turning everything up is the same as turning nothing up,
 * because the aggregation divides by the weight sum.
 */
export function weightedRequirements(
    enterprise: Enterprise,
    priorities: Priorities = {},
): Weighted[] {
    const out: Weighted[] = [];

    for (const requirement of enterprise.requirements) {
        const definition = metric(requirement.metric);

        if (definition === undefined) {
            continue;
        }

        let weight = requirement.weight * (config.groupWeights[definition.group] ?? 1);

        for (const [key, priorityWeight] of Object.entries(priorities)) {
            const multiplier = config.priorities[key]?.metric_multipliers?.[requirement.metric];

            if (multiplier === undefined) {
                continue;
            }

            const clamped = Math.max(0, Math.min(1, priorityWeight));
            weight *= 1 + (multiplier - 1) * clamped;
        }

        out.push({ requirement, weight });
    }

    return out;
}

/* ----------------------------------------------------------- the scorer -- */

/**
 * The full assessment: a score, a class, how much of the model could be
 * applied, and every factor with its envelope beside it.
 *
 * `coverage` is not decoration. Without it a cell missing its soil data
 * would score identically to one that genuinely has good soil, which is the
 * most dangerous failure mode available here.
 */
export function assess(
    site: Site,
    enterprise: Enterprise,
    priorities: Priorities = {},
): Assessment {
    const weighted = weightedRequirements(enterprise, priorities);

    const factors: FactorScore[] = [];

    let logSum = 0;
    let scoredWeight = 0;
    let totalWeight = 0;
    let worst: number | null = null;
    let criticalFail = false;
    let permanentFail = false;

    const floor = config.aggregation.score_floor;

    for (const { requirement, weight } of weighted) {
        const definition = metric(requirement.metric);

        if (definition === undefined) {
            continue;
        }

        totalWeight += weight;

        const value = site.values[requirement.metric] ?? null;
        const s = scoreRequirement(requirement, value, definition.categorical);

        if (s !== null) {
            scoredWeight += weight;
            logSum += weight * Math.log(Math.max(s, floor));

            if (worst === null || s < worst) {
                worst = s;
            }

            if (requirement.isCritical && s === 0) {
                criticalFail = true;

                if (requirement.isPermanentWhenFailed) {
                    permanentFail = true;
                }
            }
        }

        factors.push({
            metric: requirement.metric,
            label: definition.label,
            value,
            unit: requirement.unit ?? definition.unit,
            score: s === null ? null : round(s, 3),
            weight: round(weight, 4),
            severity: severity(s),
            direction: direction(
                value,
                requirement.absMin,
                requirement.optMin,
                requirement.optMax,
                requirement.absMax,
            ),
            isCritical: requirement.isCritical,
            failed: s === 0,
            remedyKey: requirement.remedyKey,
            dataset: definition.dataset,
            absMin: requirement.absMin,
            optMin: requirement.optMin,
            optMax: requirement.optMax,
            absMax: requirement.absMax,
            sourceCitation: requirement.sourceCitation,
            notes: requirement.notes,
        });
    }

    const gmean = scoredWeight > 0 ? Math.exp(logSum / scoredWeight) : 0;
    const pull = config.aggregation.minimum_factor_pull;
    const pulled = Math.max(0, Math.min(1, gmean - pull * (gmean - (worst ?? gmean))));
    const score = round(pulled * 100, 1);

    const limiting = factors
        .filter((f) => f.score !== null && f.score < config.limitingFactors.threshold)
        .sort((a, b) => b.weight * (1 - (b.score ?? 0)) - a.weight * (1 - (a.score ?? 0)))
        .slice(0, config.limitingFactors.max_reported);

    return {
        slug: enterprise.slug,
        name: enterprise.name,
        score,
        classCode: classFromScore(score, criticalFail, permanentFail),
        coverage: totalWeight > 0 ? round(scoredWeight / totalWeight, 4) : 0,
        criticalFail,
        permanentFail,
        factors,
        limiting,
    };
}

/**
 * The score alone, for the map.
 *
 * The same arithmetic with nothing allocated: painting the district means
 * running this 67,855 times per repaint, so the full factor list — which
 * nobody looks at for a pixel — is not built.
 */
export interface FastScore {
    score: number;
    classCode: ClassCode;
    coverage: number;
}

export function assessFast(
    read: (metric: MetricKey) => number | null,
    weighted: Weighted[],
    categorical: Set<MetricKey>,
): FastScore {
    let logSum = 0;
    let scoredWeight = 0;
    let totalWeight = 0;
    let worst = Number.POSITIVE_INFINITY;
    let criticalFail = false;
    let permanentFail = false;
    let any = false;

    const floor = config.aggregation.score_floor;

    for (let i = 0; i < weighted.length; i++) {
        const { requirement, weight } = weighted[i];
        totalWeight += weight;

        const s = scoreRequirement(
            requirement,
            read(requirement.metric),
            categorical.has(requirement.metric),
        );

        if (s === null) {
            continue;
        }

        any = true;
        scoredWeight += weight;
        logSum += weight * Math.log(s > floor ? s : floor);

        if (s < worst) {
            worst = s;
        }

        if (s === 0 && requirement.isCritical) {
            criticalFail = true;

            if (requirement.isPermanentWhenFailed) {
                permanentFail = true;
            }
        }
    }

    if (!any) {
        return { score: 0, classCode: 'N1', coverage: 0 };
    }

    const gmean = Math.exp(logSum / scoredWeight);
    const pull = config.aggregation.minimum_factor_pull;
    const pulled = Math.max(0, Math.min(1, gmean - pull * (gmean - worst)));
    const score = pulled * 100;

    return {
        score,
        classCode: classFromScore(score, criticalFail, permanentFail),
        coverage: totalWeight > 0 ? scoredWeight / totalWeight : 0,
    };
}

export function limitingThreshold(): number {
    return config.limitingFactors.threshold;
}

function round(value: number, places: number): number {
    const factor = Math.pow(10, places);

    return Math.round(value * factor) / factor;
}
