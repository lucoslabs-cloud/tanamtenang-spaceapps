/**
 * The space of sequences a field could legally carry, and the arithmetic
 * that scores one.
 *
 * There is one enumerator and one rule engine; what each strategy supplies
 * is an objective. That matters for honesty as much as for tidiness — three
 * strategies scored by three implementations would disagree in ways nobody
 * could attribute to agronomy.
 *
 * **The rules are by plant family, not by crop**, because that is how
 * soil-borne disease works. Bacterial wilt does not distinguish tomato from
 * chilli, so planting one after the other is planting the same crop as far
 * as the soil is concerned. The one place a rule names a specific
 * predecessor is where the catalogue names one.
 *
 * A port of `App\Farms\Rotation\SequenceSearch`.
 */

import type { Meta, RotationRule } from '../types';

export interface Candidate {
    slug: string;
    name: string;
    family: string | null;
    nitrogenRole: string | null;
    residueClass: string | null;
    rootingDepthCm: number | null;
    isCoverCrop: boolean;
    cycleDays: number | null;
    waterMm: number | null;
    score: number;
    classCode: string;
    rules: RotationRule[];
}

export interface Effect {
    effect: RotationRule['effect'];
    family: string | null;
    afterSlug: string | null;
    magnitude: number;
    gapSeasons: number;
    reason: string | null;
    source: string | null;
}

export interface Slot {
    season: number;
    slug: string;
    name: string;
    family: string | null;
    isCoverCrop: boolean;
    nitrogenRole: string | null;
    residueClass: string | null;
    rootingDepthCm: number | null;
    cycleDays: number | null;
    waterMm: number | null;
    score: number;
    classCode: string;
    legal: boolean;
    modifier: number;
    slotScore: number;
    effects: Effect[];
}

export interface Sequence {
    slots: Slot[];
    legal: boolean;
}

interface HistoryEntry {
    slug: string;
    family: string | null;
}

export type Objective = (slots: Slot[]) => number;

let weights = { bonus: 0.25, penalty: 0.5 };

export function configureSearch(rotation: Meta['rotation']): void {
    weights = { bonus: rotation.bonus_weight, penalty: rotation.penalty_weight };
}

/**
 * Every legal sequence, scored by the strategy's own objective; the best one
 * wins.
 *
 * **Exhaustive rather than greedy**, and that is the whole reason this is not
 * fifteen lines. A greedy planner picks the best crop each season and would
 * therefore never plant a legume: a legume's value is not in its own slot,
 * it is in the nitrogen it leaves for the slot behind it. Only a planner
 * that scores whole sequences can see that. With eight candidates over four
 * seasons that is 4,096 sequences, each a handful of array lookups, walked
 * once per strategy.
 *
 * The objective is handed the whole slot list rather than one slot at a
 * time, because that is the only way a term like "how many families does
 * this sequence use" can be expressed at all.
 *
 * The tiebreaker is the number of distinct families, which only ever
 * separates sequences of equal value. It keeps the output stable and, where
 * the arithmetic genuinely cannot choose, prefers the more varied plan.
 */
export function best(
    candidates: Candidate[],
    history: HistoryEntry[],
    horizon: number,
    objective: Objective,
): Sequence | null {
    let bestValue = Number.NEGATIVE_INFINITY;
    let bestSlots: Slot[] | null = null;

    const walk = (past: HistoryEntry[], chosen: Slot[]): void => {
        if (chosen.length === horizon) {
            const families = new Set(
                chosen.map((s) => s.family).filter((f): f is string => f !== null),
            ).size;

            const value = objective(chosen) + families * 1e-6;

            if (bestSlots === null || value > bestValue) {
                bestValue = value;
                bestSlots = [...chosen];
            }

            return;
        }

        for (const candidate of candidates) {
            const assessment = assess(candidate, past);

            if (!assessment.legal) {
                continue;
            }

            past.push({ slug: candidate.slug, family: candidate.family });
            chosen.push(slot(chosen.length + 1, candidate, assessment));

            walk(past, chosen);

            past.pop();
            chosen.pop();
        }
    };

    walk([...history], []);

    return bestSlots === null ? null : { slots: bestSlots, legal: true };
}

/**
 * Score a sequence that was chosen for us rather than searched for.
 *
 * This is how the existing rotation gets onto the comparison. It is not
 * optimised and it is not filtered: if what the farmer is doing breaks a
 * rotation rule outright, the sequence still comes back, with `legal` false
 * and the rule that forbids it attached to the slot it applies to. That is
 * the finding, and dropping it would hide the most useful thing on the panel.
 */
export function evaluate(sequence: Candidate[], history: HistoryEntry[]): Sequence {
    const past = [...history];
    const slots: Slot[] = [];
    let legal = true;

    sequence.forEach((candidate, index) => {
        const assessment = assess(candidate, past);

        if (!assessment.legal) {
            legal = false;
        }

        slots.push(slot(index + 1, candidate, assessment));
        past.push({ slug: candidate.slug, family: candidate.family });
    });

    return { slots, legal };
}

function slot(
    season: number,
    candidate: Candidate,
    assessment: { legal: boolean; modifier: number; effects: Effect[] },
): Slot {
    return {
        season,
        slug: candidate.slug,
        name: candidate.name,
        family: candidate.family,
        isCoverCrop: candidate.isCoverCrop,
        nitrogenRole: candidate.nitrogenRole,
        residueClass: candidate.residueClass,
        rootingDepthCm: candidate.rootingDepthCm,
        cycleDays: candidate.cycleDays,
        waterMm: candidate.waterMm,
        score: candidate.score,
        classCode: candidate.classCode,
        legal: assessment.legal,
        modifier: round(assessment.modifier, 3),
        slotScore: round(candidate.score * assessment.modifier, 1),
        effects: assessment.effects,
    };
}

/**
 * What the rules say about putting this crop here, after that history.
 *
 * The gap is a window, and reading it that way is what makes both columns
 * mean something. `forbidden` with a three-season gap is illegal while the
 * family is still inside those three seasons. `harmful` with a two-season
 * gap costs its magnitude while the family is inside two, and nothing once
 * it is out. A `beneficial` rule has no gap to satisfy, so its window is one
 * season: nitrogen left by a legume feeds the crop immediately behind it,
 * not the one after that.
 *
 * A family appearing twice inside a window is charged once. The soil does
 * not care twice as much, and double-charging would quietly outweigh the
 * suitability score.
 *
 * A neutral rule moves nothing and is still worth carrying. It is the
 * catalogue saying it considered this pairing and found no cost —
 * continuous flooded paddy, a legume before rice — which to a farmer looking
 * at a plan is a different statement from silence, and the only way to show
 * the reasoning behind an absent penalty.
 */
export function assess(
    candidate: Candidate,
    history: HistoryEntry[],
): { legal: boolean; modifier: number; effects: Effect[] } {
    let bonus = 0;
    let penalty = 0;
    let legal = true;

    const effects: Effect[] = [];

    for (const rule of candidate.rules) {
        const window = rule.effect === 'beneficial' ? 1 : Math.max(1, rule.minGapSeasons);
        const recent = history.slice(-window);

        if (!matches(rule, recent)) {
            continue;
        }

        if (rule.effect === 'forbidden') {
            legal = false;
        } else if (rule.effect === 'beneficial') {
            bonus += rule.magnitude * weights.bonus;
        } else if (rule.effect === 'harmful') {
            penalty += rule.magnitude * weights.penalty;
        }

        effects.push({
            effect: rule.effect,
            family: rule.followsFamily,
            afterSlug: rule.followsSlug,
            magnitude: rule.magnitude,
            gapSeasons: rule.minGapSeasons,
            reason: rule.reason,
            source: rule.source,
        });
    }

    return {
        legal,
        // A sequence nobody should plant is not also given a score: the
        // modifier on an illegal slot is zero, which is what it is worth.
        modifier: legal ? Math.max(0, 1 + bonus - penalty) : 0,
        effects,
    };
}

function matches(rule: RotationRule, recent: HistoryEntry[]): boolean {
    for (const past of recent) {
        if (rule.followsSlug !== null && past.slug === rule.followsSlug) {
            return true;
        }

        if (
            rule.followsFamily !== null &&
            past.family !== null &&
            past.family === rule.followsFamily
        ) {
            return true;
        }
    }

    return false;
}

function round(value: number, places: number): number {
    const factor = Math.pow(10, places);

    return Math.round(value * factor) / factor;
}
