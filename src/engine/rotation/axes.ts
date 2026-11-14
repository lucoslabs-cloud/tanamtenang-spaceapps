/**
 * The axes a rotation gets compared on.
 *
 * The brief names them: nutrient cycling, organic matter contributions,
 * pest-cycle disruption, water use, erosion risk, forage potential and
 * market considerations. The first four are computed here from catalogue
 * columns that are actually populated. The last three are not, and the
 * explainer says so out loud rather than leaving a reader to assume the
 * comparison covers them — erosion is measured for the ground and not for
 * the plan, and there is no forage or price data in this project at all.
 *
 * Every axis carries its own coverage, because the catalogue is uneven:
 * `rootingDepthCm` is on all twelve annual crops, `residueClass` on six. The
 * house rule is that a missing figure scores null and the coverage falls — a
 * zero would read as "leaves nothing behind", which is a different and much
 * worse claim than "we do not know".
 *
 * A port of `App\Farms\Rotation\SequenceAxes`.
 */

import type { Meta } from '../types';
import type { Slot } from './search';

export interface Axes {
    seasons: number;
    meanScore: number;
    rotationEffect: number;
    returnMean: number;
    coverSeasons: number;
    legumeSeasons: number;
    legumeIndex: number;
    residueIndex: number | null;
    residueCoverage: number;
    pestBreakIndex: number;
    families: number;
    familyNames: string[];
    waterMmTotal: number | null;
    waterCoverage: number;
    rootingDepthMeanCm: number | null;
    rootingCoverage: number;
    cycleDaysTotal: number;
    soilIndex: number;
}

let config: Meta['rotation'] = {
    horizon_seasons: 4,
    max_candidates: 8,
    min_score: 25,
    max_cover_candidates: 2,
    min_cover_score: 15,
    penalty_weight: 0.5,
    bonus_weight: 0.25,
    strategies: {
        build_soil: { weight: 0.35, legume_share: 0.45, residue_share: 0.35, variety_share: 0.2 },
        least_water: { weight: 0.35, reference_mm_per_season: 500 },
    },
    residue_weights: { high: 1, medium: 0.6, low: 0.3 },
};

export function configureAxes(rotation: Meta['rotation']): void {
    config = rotation;
}

export function rotationConfig(): Meta['rotation'] {
    return config;
}

/**
 * Suitability summed over the sequence, in units of one perfect season.
 *
 * A statement about the land: how well the ground carries what is planted on
 * it, in the order it is planted. A cover crop counts here like anything
 * else, because a green manure that suits the field is a green manure that
 * will grow.
 */
export function suitabilityTotal(slots: Slot[]): number {
    return slots.reduce((sum, slot) => sum + slot.slotScore / 100, 0);
}

/**
 * What comes off the field, in the same units.
 *
 * The same sum with the cover seasons set to nothing, because nothing is what
 * they yield. This is the objective `highest_return` maximises and the base
 * the other two add their own term to, so the weights in config are
 * per-season fractions of it.
 *
 * Keeping the two apart is what makes a cover crop cost something. On
 * suitability alone a green manure that suits the field would beat a food
 * crop that suits it slightly less, and the planner would cheerfully
 * recommend a year of growing nothing. Scored this way a cover season is a
 * season given up, and a strategy only takes one where what it builds is
 * worth more than the harvest it costs — which is the trade a farmer is
 * actually making, and the one the panel has to show them.
 */
export function returnTotal(slots: Slot[]): number {
    return slots.reduce((sum, slot) => (slot.isCoverCrop ? sum : sum + slot.slotScore / 100), 0);
}

/**
 * How much this sequence does for the soil, 0 to 1.
 *
 * Three things, in the proportions set by config: nitrogen fixed by legumes,
 * organic matter returned as residue, and the variety of families — which is
 * what stops one pest or pathogen settling in. A component with no data
 * behind it contributes nothing and the shares are renormalised over what is
 * known, so a catalogue missing every residue class gives a soil index built
 * from the other two rather than an index two thirds of its real size.
 */
export function soilIndex(slots: Slot[], priorFamily: string | null = null): number {
    const shares = config.strategies.build_soil;
    const [residue] = residueIndex(slots);

    const parts: Array<[number, number | null]> = [
        [shares.legume_share, legumeIndex(slots)],
        [shares.residue_share, residue],
        [shares.variety_share, pestBreakIndex(slots, priorFamily)],
    ];

    let weighted = 0;
    let weight = 0;

    for (const [share, index] of parts) {
        if (index === null) {
            continue;
        }

        weighted += share * index;
        weight += share;
    }

    return weight > 0 ? weighted / weight : 0;
}

/**
 * Water demand against what an ordinary sequence of this length would draw,
 * 0 (nothing) to 1 (at or above the reference).
 *
 * Saturating at the reference is deliberate. There is no useful distinction
 * between a sequence that wants twice what the field can supply and one that
 * wants three times: both are the wrong plan for the same reason, and
 * letting the penalty run away would let one thirsty season veto an
 * otherwise good sequence.
 *
 * With no water figure on any crop in the shortlist this returns 0 for every
 * sequence, so the strategy degenerates to `highest_return`. That is the
 * honest outcome and the explainer reports it as a gap rather than
 * presenting an unchanged plan as a water-saving one.
 */
export function waterIndex(slots: Slot[]): number {
    const water = waterUse(slots);

    if (water.totalMm === null) {
        return 0;
    }

    const reference =
        config.strategies.least_water.reference_mm_per_season * Math.max(1, slots.length);

    if (reference <= 0) {
        return 0;
    }

    return Math.min(1, water.totalMm / reference);
}

/** The whole comparison block for one strategy. */
export function axes(slots: Slot[], priorFamily: string | null = null): Axes {
    const count = Math.max(1, slots.length);
    const [residue, residueKnown] = residueIndex(slots);
    const rooting = rootingDepth(slots);
    const water = waterUse(slots);

    const familyNames = [
        ...new Set(slots.map((s) => s.family).filter((f): f is string => f !== null)),
    ];

    const cycleDays = slots.reduce((sum, slot) => sum + (slot.cycleDays ?? 0), 0);

    return {
        seasons: slots.length,

        // How well the ground carries these crops, before and after the
        // order they are planted in.
        meanScore: round(slots.reduce((sum, s) => sum + s.slotScore, 0) / count, 1),
        rotationEffect: round(slots.reduce((sum, s) => sum + s.modifier, 0) / count, 3),

        // What the field gives back, with the cover seasons counted at
        // nothing. Divided by every season rather than only the cropped
        // ones: giving up one season in four to a green manure is a quarter
        // off the harvest, and averaging that away would hide the whole cost
        // of the decision.
        returnMean: round((returnTotal(slots) * 100) / count, 1),
        coverSeasons: slots.filter((s) => s.isCoverCrop).length,

        // Nutrient cycling: seasons that fix their own nitrogen.
        legumeSeasons: legumeSeasons(slots),
        legumeIndex: round(legumeIndex(slots), 3),

        // Organic matter returned after harvest.
        residueIndex: residue === null ? null : round(residue, 3),
        residueCoverage: round(residueKnown / count, 3),

        // Pest-cycle disruption: how far apart this sequence keeps crops of
        // one family.
        pestBreakIndex: round(pestBreakIndex(slots, priorFamily), 3),
        families: familyNames.length,
        familyNames,

        waterMmTotal: water.totalMm,
        waterCoverage: water.coverage,

        // Deep roots open the subsoil and improve infiltration, which is the
        // closest this platform gets to an erosion axis until a sequence can
        // be judged on how much of the year it leaves the soil covered.
        rootingDepthMeanCm: rooting.meanCm,
        rootingCoverage: rooting.coverage,

        cycleDaysTotal: cycleDays,
        soilIndex: round(soilIndex(slots, priorFamily), 3),
    };
}

function legumeSeasons(slots: Slot[]): number {
    return slots.filter((s) => s.nitrogenRole === 'fixer').length;
}

/**
 * Legume seasons as a share of the sequence.
 *
 * Capped at half: a rotation that is nothing but legumes is not a better
 * rotation, it is a rotation with a legume problem of its own, and the
 * `harmful` rule against Fabaceae following Fabaceae already says so. So
 * half the seasons under a legume reads as a full index.
 */
function legumeIndex(slots: Slot[]): number {
    const count = Math.max(1, slots.length);

    return Math.min(1, legumeSeasons(slots) / (count / 2));
}

/** Mean residue class over the seasons that have one recorded. */
function residueIndex(slots: Slot[]): [number | null, number] {
    let sum = 0;
    let known = 0;

    for (const slot of slots) {
        const weight =
            slot.residueClass === null ? undefined : config.residue_weights[slot.residueClass];

        if (weight === undefined) {
            continue;
        }

        sum += weight;
        known++;
    }

    return known === 0 ? [null, 0] : [sum / known, known];
}

/**
 * How well the sequence breaks a pest or disease cycle, 0 to 1.
 *
 * Per season: how long since the last crop of the same family. The season
 * immediately after its own family scores nothing, three or more seasons
 * clear scores full, and the two in between scale. A season whose family has
 * not appeared before — including the first, unless the farmer told us what
 * is in the ground — is clear.
 */
function pestBreakIndex(slots: Slot[], priorFamily: string | null = null): number {
    const history: Array<string | null> = priorFamily === null ? [] : [priorFamily];

    let sum = 0;
    let known = 0;

    for (const slot of slots) {
        const family = slot.family;

        if (family === null) {
            history.push(null);
            continue;
        }

        let gap: number | null = null;

        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i] === family) {
                gap = history.length - i;
                break;
            }
        }

        sum += gap === null ? 1 : Math.min(1, (gap - 1) / 3);
        known++;

        history.push(family);
    }

    return known === 0 ? 0 : sum / known;
}

function waterUse(slots: Slot[]): { totalMm: number | null; coverage: number } {
    let total = 0;
    let known = 0;

    for (const slot of slots) {
        if (slot.waterMm === null) {
            continue;
        }

        total += slot.waterMm;
        known++;
    }

    return {
        totalMm: known === 0 ? null : Math.round(total),
        coverage: round(known / Math.max(1, slots.length), 3),
    };
}

function rootingDepth(slots: Slot[]): { meanCm: number | null; coverage: number } {
    let total = 0;
    let known = 0;

    for (const slot of slots) {
        if (slot.rootingDepthCm === null) {
            continue;
        }

        total += slot.rootingDepthCm;
        known++;
    }

    return {
        meanCm: known === 0 ? null : Math.round(total / known),
        coverage: round(known / Math.max(1, slots.length), 3),
    };
}

function round(value: number, places: number): number {
    const factor = Math.pow(10, places);

    return Math.round(value * factor) / factor;
}
