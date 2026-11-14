/**
 * Why this plan, on what evidence, for what gain, with what still unknown
 * and what needs a local eye.
 *
 * The brief asks for exactly these five things about every strategy, and in
 * that order. A sequence of crop names without them is an instruction to
 * trust the tool, which is the one thing a decision-support tool is not for.
 *
 * Two of the five are the ones worth getting right. **Evidence** names the
 * dataset behind each figure, so a farmer or an agronomist can go and
 * disagree with the source rather than with the output. **Gaps** names what
 * the platform does not know — and the list is long on purpose: there is no
 * price data in this project, no forage data, erosion is measured for the
 * ground and not for the plan, and the rotation rules are generic agronomy
 * rather than this valley's disease history. Every one of those is a reason
 * to ask somebody local, and leaving them out would make the comparison look
 * more complete than it is.
 *
 * A port of `App\Farms\Rotation\StrategyExplainer`.
 */

import { metric } from '../vocabulary';
import type { RankingRow } from '../ranking';
import type { Axes } from './axes';
import type { Slot } from './search';
import { strategyAim, type StrategyKey } from './strategy';

export interface EvidenceItem {
    label: string;
    detail: string;
    dataset: string | null;
}

export interface BenefitItem {
    label: string;
    detail: string;
}

export interface RiskItem {
    severity: 'severe' | 'high' | 'moderate' | 'slight';
    message: string;
}

export interface Explanation {
    why: string;
    evidence: EvidenceItem[];
    benefits: BenefitItem[];
    gaps: string[];
    risks: RiskItem[];
}

export interface Reference {
    label: string;
    axes: Axes;
    fingerprint: string;
}

/** Dataset slug => registered name, so the UI and the registry agree. */
let datasetNames = new Map<string, string>();

export function configureExplainer(names: Map<string, string>): void {
    datasetNames = names;
}

export function explain(
    strategy: StrategyKey,
    slots: Slot[],
    axesOf: Axes,
    legal: boolean,
    ranking: Map<string, RankingRow>,
    scenarioLabel: string,
    reference: Reference | null,
): Explanation {
    return {
        why: why(strategy, slots, axesOf, reference),
        evidence: evidence(strategy, slots, axesOf, ranking, scenarioLabel),
        benefits: benefits(axesOf, reference),
        gaps: gaps(slots, axesOf, ranking),
        risks: risks(strategy, slots, axesOf, legal, ranking, scenarioLabel),
    };
}

/* --------------------------------------------------------------- why ---- */

function why(
    strategy: StrategyKey,
    slots: Slot[],
    axesOf: Axes,
    reference: Reference | null,
): string {
    const order = slots.map((s) => s.name).join(', then ');

    if (strategy === 'carry_on') {
        return (
            `This is not a suggestion — it is what the field does if nothing changes: ` +
            `${order}. It is here because the other plans are only worth what they beat, ` +
            `and this is the thing they have to beat.`
        );
    }

    let line = `${strategyAim(strategy)} Here that comes out as ${order}.`;

    if (reference === null) {
        return line;
    }

    // Landing on the reference's own order is not a near-miss on score, it is
    // the same plan. Saying it "changes what the field leaves behind" would
    // be false, and on a field where the farmer is already doing the best
    // available thing, being told so plainly is the most useful output here.
    if (slots.map((s) => s.slug).join('>') === reference.fingerprint) {
        return (
            `${line} That is the same order as ${lcfirst(reference.label)}, crop for crop. ` +
            `On this field, chasing this aim does not move you off what is already there.`
        );
    }

    // Against what comes off the field rather than against how well the
    // ground carries it, so a season given to a green manure shows up here
    // as the cost it is.
    const cost = axesOf.returnMean - reference.axes.returnMean;

    if (cost < -0.5) {
        line +=
            ` It scores ${Math.abs(cost).toFixed(1)} points lower than ` +
            `${lcfirst(reference.label)} on what comes off the field, which is what the ` +
            `change costs${
                axesOf.coverSeasons > 0 ? ', most of it the season given to a green manure' : ''
            }.`;
    } else if (cost > 0.5) {
        line +=
            ` It also scores ${cost.toFixed(1)} points higher than ` +
            `${lcfirst(reference.label)}, so there is no trade to weigh here.`;
    } else {
        line +=
            ` It yields about the same as ${lcfirst(reference.label)}, so what it changes ` +
            `is what it leaves behind rather than what it takes off.`;
    }

    return line;
}

/* ---------------------------------------------------------- evidence ---- */

function evidence(
    strategy: StrategyKey,
    slots: Slot[],
    axesOf: Axes,
    ranking: Map<string, RankingRow>,
    scenarioLabel: string,
): EvidenceItem[] {
    const out: EvidenceItem[] = [];

    // 1. What the ground scored, and under which climate.
    out.push({
        label: 'Suitability on this field',
        detail:
            `Every season is scored against this field's own cells — terrain from SRTM at ` +
            `30 m, soil from SoilGrids at 250 m, climate from NASA POWER — and the figures ` +
            `here are area-weighted across the ground you picked. Mean ${axesOf.meanScore} ` +
            `out of 100 under the ${scenarioLabel} climate.`,
        dataset: null,
    });

    // 2. The metrics that actually decided it, with their provenance.
    const limits = limitingMetrics(slots, ranking);

    if (limits.length > 0) {
        out.push({
            label: 'What limits these crops here',
            detail: limits
                .map((item) => `${item.label} (${item.source}) holds back ${item.crops}.`)
                .join(' '),
            dataset: null,
        });
    }

    // 3. The agronomy that set the order.
    const reasons = ruleReasons(slots);

    if (reasons.length > 0) {
        out.push({
            label: 'Why this order',
            detail: reasons.join(' '),
            dataset:
                'FAO conservation agriculture and crop rotation principles; ' +
                'Malaysian DOA vegetable rotation intervals.',
        });
    }

    // 4. Whatever the strategy itself was optimising, in its own terms.
    const own = strategyEvidence(strategy, axesOf);

    if (own !== null) {
        out.push(own);
    }

    return out;
}

function strategyEvidence(strategy: StrategyKey, axesOf: Axes): EvidenceItem | null {
    if (strategy === 'build_soil') {
        const seasons = axesOf.seasons;

        const residue =
            axesOf.residueIndex === null
                ? 'No residue class is recorded for these crops, so that part of the index ' +
                  'is left out rather than guessed.'
                : `Residue returned after harvest averages ${axesOf.residueIndex.toFixed(2)} ` +
                  `on a 0-to-1 scale over the ${Math.round(
                      axesOf.residueCoverage * seasons,
                  )} of ${seasons} seasons that have a class recorded.`;

        // A soil-building plan with no legume in it needs to say why, or it
        // reads as the strategy having failed at its own job. On a wet field
        // in this district the answer is usually that no legume will grow
        // there, which is a finding about the ground.
        const nitrogen =
            axesOf.legumeSeasons > 0
                ? `${axesOf.legumeSeasons} of the ${seasons} seasons fix their own nitrogen.`
                : 'No legume earned a season here: none of them scores well enough on this ' +
                  'field to be worth planting, so there is no nitrogen credit in this plan ' +
                  'and the soil case rests on residue and variety instead.';

        return {
            label: 'What it does for the soil',
            detail:
                `${nitrogen} ${residue} The sequence uses ${axesOf.families} plant ` +
                `${axesOf.families === 1 ? 'family' : 'families'}, which is what keeps a ` +
                `family-specific pest from settling in.`,
            dataset:
                'Catalogue agronomy: plant family, nitrogen role and residue class per ' +
                'enterprise.',
        };
    }

    if (strategy === 'least_water') {
        if (axesOf.waterMmTotal === null) {
            return {
                label: 'Water demand',
                detail:
                    'None of the crops in this shortlist carries a cycle water demand, so ' +
                    'this strategy had nothing to minimise and returns the same plan as the ' +
                    'best-return one. That is a gap in the catalogue, not a finding about ' +
                    'the field.',
                dataset: null,
            };
        }

        return {
            label: 'Water demand',
            detail:
                `About ${number(axesOf.waterMmTotal)} mm over the whole sequence, from the ` +
                `FAO-56 cycle demand on each crop in the catalogue. What the field supplies ` +
                `without pumping comes from the rainfall and reference evapotranspiration ` +
                `in the year chart.`,
            dataset: 'FAO-56 crop water requirements; NASA POWER rainfall and ET₀.',
        };
    }

    return null;
}

function limitingMetrics(
    slots: Slot[],
    ranking: Map<string, RankingRow>,
): Array<{ label: string; source: string; crops: string }> {
    const byMetric = new Map<string, string[]>();

    for (const slot of uniqueSlots(slots)) {
        const row = ranking.get(slot.slug);

        for (const key of row?.limiting ?? []) {
            const list = byMetric.get(key);

            if (list === undefined) {
                byMetric.set(key, [slot.name]);
            } else {
                list.push(slot.name);
            }
        }
    }

    const out: Array<{ label: string; source: string; crops: string }> = [];

    for (const [key, crops] of byMetric) {
        const definition = metric(key);

        if (definition === undefined) {
            continue;
        }

        out.push({
            label: definition.label,
            source: datasetNames.get(definition.dataset) ?? definition.dataset,
            crops: list([...new Set(crops)]),
        });
    }

    return out.slice(0, 4);
}

/** The rules that fired, in the catalogue's own words, each named once. */
function ruleReasons(slots: Slot[]): string[] {
    const seen = new Set<string>();

    for (const slot of slots) {
        for (const effect of slot.effects) {
            if (typeof effect.reason === 'string' && effect.reason !== '') {
                seen.add(effect.reason);
            }
        }
    }

    return [...seen].slice(0, 4);
}

/* ---------------------------------------------------------- benefits ---- */

function benefits(axesOf: Axes, reference: Reference | null): BenefitItem[] {
    const out: BenefitItem[] = [];

    // Listed first, because it is the only item here that costs something,
    // and a farmer reading a list of benefits should meet the price before
    // the rest of it.
    if (axesOf.coverSeasons > 0) {
        out.push({
            label: 'A season spent on the soil',
            detail:
                `${axesOf.coverSeasons} of ${axesOf.seasons} seasons is a green manure, ` +
                `grown and turned in rather than harvested. That is where the nitrogen and ` +
                `the organic matter below come from, and it is why this plan yields less: ` +
                `the ground gets the season, not you.`,
        });
    }

    if (axesOf.legumeSeasons > 0) {
        out.push({
            label: 'Nitrogen cycled',
            detail:
                `${axesOf.legumeSeasons} of ${axesOf.seasons} seasons under a legume, which ` +
                `fixes its own nitrogen and leaves some for the crop behind it.`,
        });
    }

    if (axesOf.families > 1) {
        out.push({
            label: 'Pest cycles interrupted',
            detail:
                `${axesOf.families} plant families across the sequence, scoring ` +
                `${axesOf.pestBreakIndex.toFixed(2)} out of 1 on how far apart it keeps ` +
                `crops of one family. A pest or soil-borne disease that feeds on one family ` +
                `loses its host between seasons.`,
        });
    }

    if (axesOf.residueIndex !== null && axesOf.residueIndex >= 0.5) {
        out.push({
            label: 'Organic matter returned',
            detail:
                `Residue averages ${axesOf.residueIndex.toFixed(2)} out of 1 across the ` +
                `seasons that have a class recorded — stubble and haulm left on the field ` +
                `is where soil organic carbon comes from.`,
        });
    }

    if (axesOf.rootingDepthMeanCm !== null) {
        out.push({
            label: 'Rooting depth',
            detail:
                `Roots reach about ${axesOf.rootingDepthMeanCm} cm on average. Deeper roots ` +
                `open the subsoil, which improves infiltration and leaves less water ` +
                `running off the surface.`,
        });
    }

    if (
        reference !== null &&
        axesOf.waterMmTotal !== null &&
        reference.axes.waterMmTotal !== null
    ) {
        const saved = reference.axes.waterMmTotal - axesOf.waterMmTotal;

        if (saved > 1) {
            out.push({
                label: 'Water saved',
                detail:
                    `About ${number(saved)} mm less over the sequence than ` +
                    `${lcfirst(reference.label)} — the difference between needing stored ` +
                    `water in a dry spell and not.`,
            });
        }
    }

    if (out.length === 0) {
        out.push({
            label: 'Suitability',
            detail:
                `What this plan has going for it is the ground: it scores ` +
                `${axesOf.meanScore} out of 100 on this field, and nothing in it is ` +
                `working against the soil.`,
        });
    }

    return out;
}

/* -------------------------------------------------------------- gaps ---- */

function gaps(slots: Slot[], axesOf: Axes, ranking: Map<string, RankingRow>): string[] {
    const out: string[] = [];
    const seasons = slots.length;

    // Where the scoring itself ran short of data.
    const thin: string[] = [];

    for (const slot of uniqueSlots(slots)) {
        const coverage = ranking.get(slot.slug)?.coverage;

        if (typeof coverage === 'number' && coverage < 0.95) {
            thin.push(`${slot.name} (${Math.round(coverage * 100)}%)`);
        }
    }

    if (thin.length > 0) {
        out.push(
            `Not every requirement had data behind it. The share of the weighted ` +
                `requirements actually scored was ${list(thin)}. The rest were left out ` +
                `rather than filled in, so those scores rest on less than the others.`,
        );
    }

    if (axesOf.residueCoverage < 1) {
        out.push(
            `Residue class is recorded for ${Math.round(
                axesOf.residueCoverage * seasons,
            )} of the ${seasons} seasons, so the organic-matter part of this comparison is ` +
                `thinner than it looks.`,
        );
    }

    if (axesOf.waterCoverage < 1) {
        out.push(
            `A cycle water demand is recorded for ${Math.round(
                axesOf.waterCoverage * seasons,
            )} of the ${seasons} seasons. The water total is over those only, and is an ` +
                `underestimate of the whole sequence.`,
        );
    }

    // The price of a cover season is the sharpest case of the missing market
    // data, so it is said where it bites rather than left to the general
    // statement below.
    if (axesOf.coverSeasons > 0) {
        out.push(
            `What the green manure costs you is not in this. Giving ` +
                `${axesOf.coverSeasons === 1 ? 'one' : String(axesOf.coverSeasons)} of ` +
                `${axesOf.seasons} seasons to a cover crop means ` +
                `${axesOf.coverSeasons === 1 ? 'a' : 'each'} harvest you do not sell, and ` +
                `with no price data here the platform cannot weigh that against the nitrogen ` +
                `and the structure it buys. That one is yours to judge, and it depends on ` +
                `what else the household has coming in that year.`,
        );
    }

    out.push(
        'Nothing here weighs what you would be paid. There is no price or market data in ' +
            'this platform, so a plan that scores well agronomically may still be the wrong ' +
            'one to sell.',
    );

    out.push(
        'Erosion is measured for the ground and not for this plan. The evidence map has an ' +
            'erosion exposure layer — rainfall, soil and slope, scored for bare ground — but ' +
            'no sequence here is judged on how much of the year it leaves the soil covered, ' +
            'which is the part a rotation actually changes. Look the field up on that layer, ' +
            'and if it comes back high, weigh these orders yourself against what each one ' +
            'leaves on the surface.',
    );

    out.push(
        "The rotation rules are general agronomy by plant family, not this valley's history. " +
            'A disease already in your soil, or a pest your neighbours are fighting, will not ' +
            'be in them.',
    );

    out.push(
        'This is an order, not a calendar. Every score behind it is an annual figure, so the ' +
            'planner cannot say which month to plant in — that comes from the rains and from ' +
            'your own seasons. The cycle length on each season is there to lay the sequence ' +
            'against a real one.',
    );

    return out;
}

/* ------------------------------------------------------------- risks ---- */

function risks(
    strategy: StrategyKey,
    slots: Slot[],
    axesOf: Axes,
    legal: boolean,
    ranking: Map<string, RankingRow>,
    scenarioLabel: string,
): RiskItem[] {
    const out: RiskItem[] = [];

    if (!legal) {
        const broken = new Set<string>();

        for (const slot of slots) {
            for (const effect of slot.effects) {
                if (effect.effect === 'forbidden' && effect.reason) {
                    broken.add(effect.reason);
                }
            }
        }

        out.push({
            severity: 'severe',
            message:
                `This sequence breaks a rotation rule outright, which is why it is shown as ` +
                `a baseline rather than a plan. ${[...broken].join(' ')}`,
        });
    }

    // A crop that fails a make-or-break requirement is in the plan because
    // the work can fix it, not because the ground is ready.
    const needsWork: string[] = [];
    const partial: string[] = [];

    for (const slot of uniqueSlots(slots)) {
        if (slot.classCode === 'N1') {
            needsWork.push(slot.name);
        }

        const failing = ranking.get(slot.slug)?.failingShare;

        if (typeof failing === 'number' && failing > 0.05 && slot.classCode !== 'N1') {
            partial.push(`${slot.name} on ${Math.round(failing * 100)}% of it`);
        }
    }

    if (needsWork.length > 0) {
        out.push({
            severity: 'severe',
            message:
                `${list(needsWork)} ${needsWork.length === 1 ? 'fails' : 'fail'} a ` +
                `make-or-break requirement somewhere on this field, so ` +
                `${needsWork.length === 1 ? 'it belongs' : 'they belong'} here only after ` +
                `the work in the site report is done. The order is right; the ground is not ` +
                `ready yet.`,
        });
    }

    if (partial.length > 0) {
        out.push({
            severity: 'high',
            message:
                `Part of the field fails outright for ${list(partial)}. The plan is scored ` +
                `over the whole outline, so those corners would need either the work or a ` +
                `different crop.`,
        });
    }

    if (axesOf.pestBreakIndex < 0.5) {
        const repeated = repeatedFamilies(slots);

        out.push({
            severity: 'moderate',
            message:
                `This sequence comes back to ${
                    repeated.length === 0 ? 'the same plant family' : list(repeated)
                } quickly — it scores ${axesOf.pestBreakIndex.toFixed(2)} out of 1 on ` +
                `breaking a pest cycle. Whatever feeds on that family builds up in the soil, ` +
                `and a local agronomist is the right person to say how fast that happens in ` +
                `this district.`,
        });
    }

    if (strategy === 'carry_on') {
        out.push({
            severity: 'moderate',
            message:
                'Continuous cropping is scored with the rotation rules applied in full, so ' +
                'the penalty you see is what the agronomy says — not what your own field has ' +
                'actually done. If this has worked for you for years, that is evidence the ' +
                'model does not have.',
        });
    }

    out.push({
        severity: 'slight',
        message:
            `Scored under the ${scenarioLabel} climate. The projections disagree about when, ` +
            `not much about direction, and a sequence this short sits inside the spread of ` +
            `any of them — but the scores behind it would move.`,
    });

    out.push({
        severity: 'slight',
        message:
            'This is a tool for finding patterns, not a recommendation to act on by itself. ' +
            'Take it to your agricultural extension officer or an agronomist who knows this ' +
            'district before you commit seed to it.',
    });

    return out;
}

/* ---------------------------------------------------------- plumbing ---- */

/**
 * Families the sequence plants more than once, which is the thing a rotation
 * exists to avoid. Naming them is more use to a farmer than an index is.
 */
function repeatedFamilies(slots: Slot[]): string[] {
    const counts = new Map<string, number>();

    for (const slot of slots) {
        if (slot.family === null) {
            continue;
        }

        counts.set(slot.family, (counts.get(slot.family) ?? 0) + 1);
    }

    return [...counts.entries()].filter(([, n]) => n > 1).map(([family]) => family);
}

/** One entry per crop, however many slots it takes. */
function uniqueSlots(slots: Slot[]): Slot[] {
    const seen = new Set<string>();

    return slots.filter((slot) => {
        if (seen.has(slot.slug)) {
            return false;
        }

        seen.add(slot.slug);

        return true;
    });
}

export function list(items: string[]): string {
    if (items.length === 0) return '';
    if (items.length === 1) return items[0];

    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function lcfirst(value: string): string {
    return value.charAt(0).toLowerCase() + value.slice(1);
}

function number(value: number): string {
    return Math.round(value).toLocaleString('en-US');
}
