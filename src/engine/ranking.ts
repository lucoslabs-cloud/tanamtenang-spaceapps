/**
 * Every enterprise ranked for one place.
 *
 * Two shapes of place, and the difference is not cosmetic. A clicked point
 * is one 250 m cell. A drawn plot straddles two or three, and on this
 * floodplain those cells disagree — a plot across the peat edge near
 * Simanggang spans 60 to 120 cm of peat and a flood hazard from 0.41 to
 * 0.91, which is to say one end of it is land the drainage designer will
 * work with and the other end is land it refuses outright.
 *
 * So a plot does not get its metrics averaged and then scored. Every cell is
 * scored and the *results* are area-weighted, which is what lets the row
 * carry the spread: how much of the field is genuinely suitable, how much
 * fails outright, and the best and worst class on it. A farmer whose plot is
 * 70% suitable and 30% unworkable is being told something useful. A farmer
 * told "62" is not.
 *
 * A port of `App\Farms\PlotRanker`, with the same aggregation rules —
 * including the one that matters most: the plot as a whole only fails
 * outright when all of it does.
 */

import { assess, type Priorities } from './suitability';
import { classFromScore, classRank, isSuitable } from './vocabulary';
import type { Assessment, ClassCode, Enterprise, Site } from './types';

export interface RankingRow {
    slug: string;
    name: string;
    localName: string | null;
    category: Enterprise['category'];
    isCoverCrop: boolean;
    isPerennial: boolean;
    icon: string | null;
    color: string | null;

    score: number;
    classCode: ClassCode;
    coverage: number;

    /** The spread across the cells a plot covers. Equal on a single cell. */
    bestClass: ClassCode;
    worstClass: ClassCode;
    uniform: boolean;
    suitableShare: number;
    failingShare: number;

    /** Metric keys, worst first, that hold this enterprise back here. */
    limiting: string[];

    /** The full factor list, kept only for a single-cell assessment. */
    assessment: Assessment | null;
}

export function rankPoint(
    site: Site,
    enterprises: Enterprise[],
    priorities: Priorities = {},
): RankingRow[] {
    const out: RankingRow[] = [];

    for (const enterprise of enterprises) {
        if (enterprise.requirements.length === 0) {
            continue;
        }

        const result = assess(site, enterprise, priorities);

        out.push({
            slug: enterprise.slug,
            name: enterprise.name,
            localName: enterprise.localName,
            category: enterprise.category,
            isCoverCrop: enterprise.isCoverCrop,
            isPerennial: enterprise.isPerennial,
            icon: enterprise.icon,
            color: enterprise.color,

            score: result.score,
            classCode: result.classCode,
            coverage: result.coverage,

            bestClass: result.classCode,
            worstClass: result.classCode,
            uniform: true,
            suitableShare: isSuitable(result.classCode) ? 1 : 0,
            failingShare: result.criticalFail ? 1 : 0,

            limiting: result.limiting.map((f) => f.metric),
            assessment: result,
        });
    }

    return out.sort((a, b) => b.score - a.score);
}

export function rankPlot(
    sites: Array<{ site: Site; weight: number }>,
    enterprises: Enterprise[],
    priorities: Priorities = {},
): RankingRow[] {
    if (sites.length === 0) {
        return [];
    }

    const out: RankingRow[] = [];

    for (const enterprise of enterprises) {
        if (enterprise.requirements.length === 0) {
            continue;
        }

        let score = 0;
        let coverage = 0;
        let used = 0;
        let suitable = 0;
        let failing = 0;
        let permanent = 0;

        const classesSeen: ClassCode[] = [];
        const limitingVotes = new Map<string, number>();

        // Kept so a plot still has a factor list to show. The cell carrying
        // the largest share of the field is the one whose envelopes are
        // worth printing; naming the plot's own spread is the other half,
        // and that is what suitableShare and failingShare are for.
        let widest: { weight: number; result: Assessment } | null = null;

        for (const { site, weight } of sites) {
            if (weight <= 0) {
                continue;
            }

            const result = assess(site, enterprise, priorities);

            used += weight;
            score += result.score * weight;
            coverage += result.coverage * weight;
            classesSeen.push(result.classCode);

            if (isSuitable(result.classCode)) {
                suitable += weight;
            }

            if (result.criticalFail) {
                failing += weight;
            }

            if (result.permanentFail) {
                permanent += weight;
            }

            // The limiting metric on the largest share of the plot is the
            // one worth naming, so the votes are weighted by area rather
            // than taken from whichever cell came back first.
            for (const factor of result.limiting) {
                limitingVotes.set(
                    factor.metric,
                    (limitingVotes.get(factor.metric) ?? 0) + weight,
                );
            }

            if (widest === null || weight > widest.weight) {
                widest = { weight, result };
            }
        }

        if (used <= 0) {
            continue;
        }

        const weighted = score / used;

        // The plot as a whole only fails outright when all of it does. Part
        // of a field failing is a different statement, and failingShare is
        // where that statement gets made.
        const allFail = failing >= used - 1e-9;
        const allPermanent = permanent >= used - 1e-9;

        const sorted = [...classesSeen].sort((a, b) => classRank(a) - classRank(b));

        out.push({
            slug: enterprise.slug,
            name: enterprise.name,
            localName: enterprise.localName,
            category: enterprise.category,
            isCoverCrop: enterprise.isCoverCrop,
            isPerennial: enterprise.isPerennial,
            icon: enterprise.icon,
            color: enterprise.color,

            score: round(weighted, 1),
            classCode: classFromScore(weighted, allFail, allPermanent),
            coverage: round(coverage / used, 3),

            bestClass: sorted[0],
            worstClass: sorted[sorted.length - 1],
            uniform: new Set(classesSeen).size === 1,
            suitableShare: round(suitable / used, 3),
            failingShare: round(failing / used, 3),

            limiting: [...limitingVotes.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([key]) => key),

            assessment: widest?.result ?? null,
        });
    }

    return out.sort((a, b) => b.score - a.score);
}

function round(value: number, places: number): number {
    const factor = Math.pow(10, places);

    return Math.round(value * factor) / factor;
}
