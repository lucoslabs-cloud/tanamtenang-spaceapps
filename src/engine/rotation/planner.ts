/**
 * What to do with this field over the next few seasons — as a comparison,
 * not an instruction.
 *
 * The scoring engine says what *suits* the ground. This says what to do with
 * it, which is the question a farmer with one hectare actually has. The brief
 * asks for the harder and better version: **at least three rotation
 * strategies, including the existing rotation**, each explained by why it was
 * suggested, what evidence supports it, what it may offer, where the
 * information gaps are, and what would need local review.
 *
 * One enumerator, several objectives. Every strategy walks the same space of
 * legal sequences and differs only in what it maximises, which is what makes
 * the comparison mean anything: a difference between two plans here is a
 * difference in goal, not in implementation.
 *
 * **The existing rotation is a baseline, never a recommendation.** It is what
 * the field does if nobody changes anything, scored with the rules applied in
 * full so the cost of continuous cropping is arithmetic rather than opinion.
 *
 * **What it does not do is pick planting dates.** It orders crops. A planting
 * window needs suitability month by month and every score here is annual; a
 * farmer plants to the rains, not to an ordinal. Each slot carries its cycle
 * length so the sequence can be laid against a real calendar, and every
 * strategy lists that as a gap rather than implying a schedule it cannot
 * compute.
 *
 * A port of `App\Farms\RotationPlanner`.
 */

import type { Enterprise, Meta, RotationRule } from '../types';
import type { Priorities } from '../suitability';
import type { RankingRow } from '../ranking';
import { axes as computeAxes, returnTotal, rotationConfig, soilIndex, waterIndex } from './axes';
import type { Axes } from './axes';
import { best, evaluate, type Candidate, type Objective, type Sequence, type Slot } from './search';
import { explain, type Explanation, type Reference } from './explainer';
import { drivingPriority, SEARCHED, strategyAim, strategyLabel, type StrategyKey } from './strategy';

export interface PlannedStrategy extends Explanation {
    key: StrategyKey;
    label: string;
    aim: string;
    isBaseline: boolean;
    isRecommended: boolean;
    legal: boolean;
    summary: string;
    sequence: Slot[];
    scores: Axes;
    /** Set when another strategy landed on the same crop order. */
    sameAs: StrategyKey | null;
}

export interface RotationPlan {
    possible: boolean;
    reason: string | null;
    horizonSeasons: number;
    scenario: string;
    startedFrom: { slug: string; name: string; family: string | null } | null;
    strategies: PlannedStrategy[];
    recommended: StrategyKey | null;
    recommendedBecause: string | null;
    comparedAgainst: StrategyKey | null;
    notes: Array<{ severity: string; message: string }>;
}

let priorityDefinitions: Meta['suitability']['priorities'] = {};

export function configurePlanner(priorities: Meta['suitability']['priorities']): void {
    priorityDefinitions = priorities;
}

export function plan(
    ranking: RankingRow[],
    enterprises: Map<string, Enterprise>,
    growing: Enterprise | null,
    scenarioLabel: string,
    scenarioKey: string,
    priorities: Priorities = {},
): RotationPlan {
    const config = rotationConfig();
    const horizon = config.horizon_seasons;

    if (growing !== null && !isRotatable(growing)) {
        return notPossible(standingCropReason(growing), growing, horizon, scenarioKey);
    }

    const candidates = shortlist(ranking, enterprises);

    // Counted on the food crops alone. A cover crop is something to put
    // between harvests, not one of the things being rotated, so a field with
    // one viable crop and two green manures is still a one-crop field — and
    // two green manures and nothing else is not a plan, it is a fallow with
    // extra steps.
    const cropping = candidates.filter((c) => !c.isCoverCrop);

    if (cropping.length < 2) {
        return notPossible(
            cropping.length === 1
                ? `Only ${cropping[0].name} comes out worth planting as a field crop here, ` +
                      `and a rotation needs something to rotate with. The ranking is the ` +
                      `better guide on this field: it is the ground that is limiting, not ` +
                      `the order.`
                : 'No annual crop scores well enough on this field to put in a rotation. ' +
                      'The site report says what is limiting, and on this district that is ' +
                      'usually water on the field or peat under it — both of which are work ' +
                      'to be done before a planting order matters.',
            growing,
            horizon,
            scenarioKey,
        );
    }

    const priorFamily = growing?.plantFamily ?? null;
    const history = growing === null ? [] : [{ slug: growing.slug, family: priorFamily }];

    const built = new Map<StrategyKey, Sequence>();

    // The baseline first, so everything else can be compared against what
    // the farmer is already doing rather than against the best plan the
    // platform could think of.
    const baseline = carryOn(ranking, growing, enterprises, horizon);

    if (baseline !== null) {
        built.set('carry_on', baseline);
    }

    for (const strategy of SEARCHED) {
        const found = best(candidates, history, horizon, objective(strategy, priorFamily));

        if (found !== null) {
            built.set(strategy, found);
        }
    }

    if (!built.has('highest_return')) {
        // Every sequence was forbidden the whole way down, which takes a
        // catalogue of crops from one family and a rule against it.
        return notPossible(
            'Every order these crops could be planted in breaks a rotation rule. That ' +
                'happens when the only crops the field will carry are from one family, and ' +
                'the answer is a break crop rather than a different order.',
            growing,
            horizon,
            scenarioKey,
        );
    }

    return assemble(
        built,
        ranking,
        growing,
        scenarioLabel,
        scenarioKey,
        priorities,
        horizon,
        priorFamily,
    );
}

/* ------------------------------------------------------- the objectives -- */

/**
 * The objective each strategy maximises.
 *
 * Every one starts from what comes off the field — summed suitability with
 * the cover seasons counted at nothing — and adds its own term scaled by the
 * number of seasons. That is what makes the config weights readable: a weight
 * of 0.35 can move a season by about a third of its suitability, which is
 * enough to reorder a sequence and not enough to plant something the field
 * will not carry.
 *
 * It is also what decides whether a cover crop is ever worth a slot. Giving
 * one a season costs that season's whole harvest, so only `build_soil` can
 * buy one, and only where the nitrogen, the residue and the break are worth
 * more than the crop it displaced.
 */
function objective(strategy: StrategyKey, priorFamily: string | null): Objective {
    const config = rotationConfig();

    if (strategy === 'build_soil') {
        const weight = config.strategies.build_soil.weight;

        return (slots) =>
            returnTotal(slots) + weight * soilIndex(slots, priorFamily) * slots.length;
    }

    if (strategy === 'least_water') {
        const weight = config.strategies.least_water.weight;

        return (slots) => returnTotal(slots) - weight * waterIndex(slots) * slots.length;
    }

    return (slots) => returnTotal(slots);
}

/**
 * The existing rotation: what is in the ground now, every season.
 *
 * Null when the farmer has not said what they grow, or when what they grow
 * is not in the ranking at all — there is no honest way to score a crop this
 * field was never scored for, and inventing one would make the baseline the
 * least trustworthy row on a panel built to be compared against it.
 */
function carryOn(
    ranking: RankingRow[],
    growing: Enterprise | null,
    enterprises: Map<string, Enterprise>,
    horizon: number,
): Sequence | null {
    if (growing === null) {
        return null;
    }

    const row = ranking.find((r) => r.slug === growing.slug);

    if (row === undefined) {
        return null;
    }

    const candidate = toCandidate(growing, row, enterprises);

    // The crop is already in the ground, so the history before the first
    // season is that same crop: planting it again next season is what carries
    // the same-family penalty, and that is the point.
    return evaluate(new Array(horizon).fill(candidate), [
        { slug: growing.slug, family: growing.plantFamily },
    ]);
}

/**
 * Which strategy gets put forward, from what the farmer asked for.
 *
 * The priority sliders already re-weight the suitability metrics. This makes
 * them do a second, more visible job: somebody who has pushed *build soil
 * health* to the top is not asking for the highest-return plan, and the
 * recommendation should follow what they said rather than what the
 * arithmetic prefers. Ties go to the best return, which needs no
 * justification. The baseline is never recommended; it is there to be beaten.
 */
function recommend(
    built: Map<StrategyKey, Sequence>,
    priorities: Priorities,
): [StrategyKey, string] {
    let bestKey: StrategyKey = 'highest_return';
    let bestWeight = -1;
    let bestLabel: string | null = null;

    for (const strategy of SEARCHED) {
        if (!built.has(strategy)) {
            continue;
        }

        const key = drivingPriority(strategy);

        if (key === null) {
            continue;
        }

        const weight = priorities[key] ?? priorityDefinitions[key]?.default ?? 0;

        // Strictly greater, so an all-equal weighting leaves the declaration
        // order standing and best return wins.
        if (weight > bestWeight) {
            bestKey = strategy;
            bestWeight = weight;
            bestLabel = priorityDefinitions[key]?.label ?? null;
        }
    }

    if (bestKey === 'highest_return' || bestLabel === null) {
        return [
            bestKey,
            'Put forward because nothing in your priorities outweighs getting the most out ' +
                'of the field. Move the sliders and this changes.',
        ];
    }

    return [
        bestKey,
        `Put forward because "${bestLabel}" is the priority you have weighted highest. ` +
            `Move the sliders and this changes.`,
    ];
}

/* ------------------------------------------------------------- assembly -- */

function assemble(
    built: Map<StrategyKey, Sequence>,
    ranking: RankingRow[],
    growing: Enterprise | null,
    scenarioLabel: string,
    scenarioKey: string,
    priorities: Priorities,
    horizon: number,
    priorFamily: string | null,
): RotationPlan {
    const bySlug = new Map(ranking.map((row) => [row.slug, row]));
    const [recommended, because] = recommend(built, priorities);

    // Everything is compared against what the farmer already does where they
    // have told us, and against the best return otherwise.
    const referenceKey: StrategyKey = built.has('carry_on') ? 'carry_on' : 'highest_return';

    const axesByKey = new Map<StrategyKey, Axes>();

    for (const [key, sequence] of built) {
        axesByKey.set(key, computeAxes(sequence.slots, priorFamily));
    }

    const reference: Reference = {
        label: strategyLabel(referenceKey),
        axes: axesByKey.get(referenceKey)!,

        // So a strategy can tell that it landed on the reference's own order
        // rather than merely scoring like it. On a sawah, where continuous
        // flooded paddy is both the best plan and the one already running,
        // that is the difference between "this changes what the field leaves
        // behind" and "this changes nothing".
        fingerprint: built
            .get(referenceKey)!
            .slots.map((s) => s.slug)
            .join('>'),
    };

    const strategies: PlannedStrategy[] = [];
    const seen = new Map<string, StrategyKey>();

    for (const [key, sequence] of built) {
        const axesOf = axesByKey.get(key)!;

        // Two objectives landing on the same sequence is a finding, not a
        // duplicate: it says the field does not force a trade. So the row
        // stays and names the other one rather than being dropped.
        const fingerprint = sequence.slots.map((s) => s.slug).join('>');
        const sameAs = seen.get(fingerprint) ?? null;

        if (!seen.has(fingerprint)) {
            seen.set(fingerprint, key);
        }

        const explanation = explain(
            key,
            sequence.slots,
            axesOf,
            sequence.legal,
            bySlug,
            scenarioLabel,
            key === referenceKey ? null : reference,
        );

        strategies.push({
            key,
            label: strategyLabel(key),
            aim: strategyAim(key),
            isBaseline: key === 'carry_on',
            isRecommended: key === recommended,
            legal: sequence.legal,
            summary: summary(sequence.slots, axesOf, key, growing),
            sequence: sequence.slots,
            scores: axesOf,
            sameAs,
            ...explanation,
        });
    }

    return {
        possible: true,
        reason: null,
        horizonSeasons: horizon,
        scenario: scenarioKey,
        startedFrom:
            growing === null
                ? null
                : { slug: growing.slug, name: growing.name, family: growing.plantFamily },
        strategies,
        recommended,
        recommendedBecause: because,
        comparedAgainst: referenceKey,
        notes: notes(growing, built.has('carry_on')),
    };
}

/** One strategy in a line, in the order it would be planted. */
function summary(
    slots: Slot[],
    axesOf: Axes,
    strategy: StrategyKey,
    growing: Enterprise | null,
): string {
    const names = slots.map((s) => s.name);

    if (strategy === 'carry_on') {
        return `${names[0] ?? 'The same crop'} for all ${slots.length} seasons — about ${duration(
            axesOf.cycleDaysTotal,
        )} to run.`;
    }

    // Naming the standing crop as a prefix rather than as the first item: a
    // bare list reads as five seasons when one of them is already planted.
    const prefix =
        growing === null
            ? ''
            : `After the ${growing.name.charAt(0).toLowerCase()}${growing.name.slice(
                  1,
              )} that is there now: `;

    return `${prefix}${names.join(', then ')} — about ${duration(axesOf.cycleDaysTotal)} to run.`;
}

/**
 * What applies to the comparison as a whole rather than to one strategy.
 * Each strategy carries its own gaps and risks.
 */
function notes(
    growing: Enterprise | null,
    hasBaseline: boolean,
): Array<{ severity: string; message: string }> {
    const out: Array<{ severity: string; message: string }> = [];

    if (growing === null) {
        out.push({
            severity: 'moderate',
            message:
                'The brief these plans answer asks for the rotation you already run to be ' +
                'compared alongside them, and nothing is recorded as growing on this field ' +
                '— so there is no baseline here. Say what is on it now and one appears: ' +
                'what is in the ground today is what the first rotation rule applies to.',
        });
    } else if (!hasBaseline) {
        out.push({
            severity: 'moderate',
            message:
                `${growing.name} is recorded as growing here but was not scored on this ` +
                `field, so there is no baseline to compare against. That usually means it ` +
                `has no requirement envelopes in the catalogue yet.`,
        });
    }

    out.push({
        severity: 'slight',
        message:
            'These are strategies to weigh, not a ranking to follow. The one put forward ' +
            'follows the priorities you set; the others are there because a different ' +
            'priority would change the answer, and only you know which applies this year.',
    });

    return out;
}

/* ----------------------------------------------------------- candidates -- */

/**
 * Crops that can be in a rotation at all.
 *
 * A perennial is a commitment, not a slot: oil palm holds the field for a
 * quarter of a century. A pond and a shed are not field crops in sequence
 * either. What is left is the seasonal and short-cycle block, which is what
 * rotation means.
 */
export function isRotatable(enterprise: Enterprise): boolean {
    if (enterprise.isPerennial) {
        return false;
    }

    return enterprise.category === 'seasonal' || enterprise.category === 'short_cycle';
}

/**
 * The shortlist, in suitability order, with the agronomy each rule and each
 * comparison axis needs beside it.
 *
 * Only the best few by suitability: a rotation built from the ninth-best crop
 * on a field is not a rotation anybody would plant. A cover crop is held to
 * its own floor and its own count, because it earns nothing and so can never
 * win a place in a shortlist ordered by suitability — which is how the
 * catalogue could hold a green manure the planner never once offered.
 */
function shortlist(ranking: RankingRow[], enterprises: Map<string, Enterprise>): Candidate[] {
    const config = rotationConfig();

    const crops: Candidate[] = [];
    const covers: Candidate[] = [];

    for (const row of ranking) {
        const enterprise = enterprises.get(row.slug);

        if (enterprise === undefined || !isRotatable(enterprise)) {
            continue;
        }

        // N2 is permanently unsuitable — land cover, or peat too deep for the
        // crop. No order of planting changes that.
        if (row.classCode === 'N2') {
            continue;
        }

        if (enterprise.isCoverCrop) {
            if (row.score >= config.min_cover_score && covers.length < config.max_cover_candidates) {
                covers.push(toCandidate(enterprise, row, enterprises));
            }

            continue;
        }

        if (row.score < config.min_score) {
            continue;
        }

        if (crops.length < config.max_candidates) {
            crops.push(toCandidate(enterprise, row, enterprises));
        }
    }

    return [...crops, ...covers];
}

/**
 * One crop as the search and the axes want it.
 *
 * The rules travel with the candidate rather than being looked up by id, so
 * the search has no database to consult and no second index to keep in step.
 */
function toCandidate(
    enterprise: Enterprise,
    row: RankingRow,
    enterprises: Map<string, Enterprise>,
): Candidate {
    return {
        slug: enterprise.slug,
        name: enterprise.name,
        family: enterprise.plantFamily,
        nitrogenRole: enterprise.nitrogenRole,
        residueClass: enterprise.residueClass,
        rootingDepthCm: enterprise.rootingDepthCm,
        isCoverCrop: enterprise.isCoverCrop,
        cycleDays: enterprise.cycleDaysMax,
        waterMm: enterprise.waterDemandMmCycle,
        score: row.score,
        classCode: row.classCode,
        rules: rulesFor(enterprise, enterprises),
    };
}

/**
 * An enterprise's rotation rules, with a rule that names a predecessor by
 * slug kept only where that predecessor is in the catalogue.
 */
function rulesFor(enterprise: Enterprise, enterprises: Map<string, Enterprise>): RotationRule[] {
    return enterprise.rotationRules.filter(
        (rule) => rule.followsSlug === null || enterprises.has(rule.followsSlug),
    );
}

/* -------------------------------------------------------------- refusal -- */

function notPossible(
    reason: string,
    growing: Enterprise | null,
    horizon: number,
    scenarioKey: string,
): RotationPlan {
    return {
        possible: false,
        reason,
        horizonSeasons: horizon,
        scenario: scenarioKey,
        startedFrom:
            growing === null
                ? null
                : { slug: growing.slug, name: growing.name, family: growing.plantFamily },
        strategies: [],
        recommended: null,
        recommendedBecause: null,
        comparedAgainst: null,
        notes: [],
    };
}

function standingCropReason(growing: Enterprise): string {
    if (growing.isPerennial) {
        return (
            `${growing.name} holds this field for ` +
            `${
                growing.productiveLifeYears === null
                    ? 'years'
                    : `${growing.productiveLifeYears} years or more`
            }, so there is nothing to rotate. A rotation is for cropped ground; what a ` +
            `stand like this wants instead is a cover crop between the rows and the ` +
            `interventions in the site report.`
        );
    }

    return (
        `${growing.name} is not a field crop in a sequence — it is stock, and the field ` +
        `under it is not being cropped. A rotation plan would be answering a question ` +
        `nobody asked here.`
    );
}

function duration(days: number): string {
    if (days <= 0) {
        return 'several seasons';
    }

    const years = days / 365;

    if (years < 1) {
        return `${Math.round(days / 30.4)} months`;
    }

    return `${years.toFixed(1)} years`;
}
