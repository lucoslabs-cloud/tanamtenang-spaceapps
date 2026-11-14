/**
 * The trapezoid.
 *
 * A direct port of `App\Suitability\Membership`, branch for branch, because
 * the whole claim of this build is that it agrees with the platform. The
 * platform compiles this same shape into SQL so it can score 67,855 cells
 * inside Postgres; here it runs in a worker instead, which is why the
 * hackathon build can re-score the district while a slider moves and the
 * platform cannot.
 *
 *      1 |        ______________
 *        |       /              \
 *      0 |______/                \______
 *          absMin optMin   optMax absMax
 *
 * A missing bound leaves that side open. **A missing value scores null, not
 * zero** — "we did not measure this" and "this is lethal" are different
 * claims and only one of them is ours to make. Everything downstream
 * excludes nulls from the mean and counts them against coverage.
 */

import type { Requirement } from './types';

let severityBands = { severe: 0.35, moderate: 0.6, slight: 0.8 };

export function configureSeverity(bands: {
    severe: number;
    moderate: number;
    slight: number;
}): void {
    severityBands = bands;
}

/**
 * Score one value against one envelope, 0 to 1, or null if unknown.
 *
 * Branch order matters and matches the PHP and the SQL exactly: the absolute
 * bounds are tested before the ramps, so a value outside them scores zero
 * rather than falling into a ramp that would run negative.
 */
export function score(
    value: number | null,
    absMin: number | null,
    optMin: number | null,
    optMax: number | null,
    absMax: number | null,
): number | null {
    if (value === null || !Number.isFinite(value)) {
        return null;
    }

    if (absMin !== null && value < absMin) {
        return 0;
    }

    if (absMax !== null && value > absMax) {
        return 0;
    }

    if (optMin !== null && absMin !== null && optMin > absMin && value < optMin) {
        return (value - absMin) / (optMin - absMin);
    }

    // No absolute floor given: a gentle decline toward zero at the origin,
    // which keeps "more is better" metrics orderable instead of flat.
    if (optMin !== null && absMin === null && value < optMin) {
        return Math.max(0, value / optMin);
    }

    if (optMax !== null && absMax !== null && absMax > optMax && value > optMax) {
        return (absMax - value) / (absMax - optMax);
    }

    return 1;
}

/**
 * A categorical metric is matched against an allow-list of codes rather
 * than scored on an envelope. An empty list means the requirement makes no
 * demand, which is not the same as every code failing.
 */
export function scoreCategorical(
    value: number | null,
    allowed: Array<number | string> | null,
): number | null {
    if (value === null || !Number.isFinite(value)) {
        return null;
    }

    if (allowed === null || allowed.length === 0) {
        return 1;
    }

    return allowed.some((code) => Number(code) === value) ? 1 : 0;
}

/** Score a requirement of either kind against a value. */
export function scoreRequirement(
    requirement: Requirement,
    value: number | null,
    categorical: boolean,
): number | null {
    return categorical
        ? scoreCategorical(value, requirement.allowedCodes)
        : score(
              value,
              requirement.absMin,
              requirement.optMin,
              requirement.optMax,
              requirement.absMax,
          );
}

/**
 * Which way a value missed, for saying so in words. Null when the value is
 * comfortable, or when there is no bound on the side it would have missed.
 */
export function direction(
    value: number | null,
    absMin: number | null,
    optMin: number | null,
    optMax: number | null,
    absMax: number | null,
): 'below' | 'above' | null {
    if (value === null) {
        return null;
    }

    const low = optMin ?? absMin;
    const high = optMax ?? absMax;

    if (low !== null && value < low) {
        return 'below';
    }

    if (high !== null && value > high) {
        return 'above';
    }

    return null;
}

/**
 * The project's severity bands, so a monthly figure is described in the same
 * words as a limiting factor on the site report.
 */
export function severity(value: number | null): 'severe' | 'moderate' | 'slight' | null {
    if (value === null) {
        return null;
    }

    if (value < severityBands.severe) return 'severe';
    if (value < severityBands.moderate) return 'moderate';
    if (value < severityBands.slight) return 'slight';

    return null;
}
