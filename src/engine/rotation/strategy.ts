/**
 * The strategies a field gets compared under.
 *
 * The brief is explicit: at least three rotation strategies, including the
 * existing rotation. These are them. Each searches the same space of legal
 * sequences and scores it against a different objective, so the comparison
 * is between *goals* rather than between near-identical sequences that
 * differ by one crop and read as noise.
 *
 * `carry_on` is not optimised at all. It is what the field does if nobody
 * changes anything: the crop in the ground now, every season, with the
 * rotation rules applied in full so the cost of continuous cropping shows up
 * as arithmetic rather than as advice. It exists only when the farmer has
 * said what they grow — a baseline nobody stated would be a guess dressed as
 * their own practice, and the planner says so instead.
 */

export type StrategyKey = 'carry_on' | 'highest_return' | 'build_soil' | 'least_water';

/** The three the planner searches for. `carry_on` is built, not searched. */
export const SEARCHED: StrategyKey[] = ['highest_return', 'build_soil', 'least_water'];

export function strategyLabel(key: StrategyKey): string {
    return {
        carry_on: 'Carry on as you are',
        highest_return: 'Best return',
        build_soil: 'Build the soil',
        least_water: 'Use the least water',
    }[key];
}

/** What the strategy is after, in the second person, for the farmer. */
export function strategyAim(key: StrategyKey): string {
    return {
        carry_on:
            'Keep planting what is in the ground now, season after season. This is the ' +
            'baseline the others are worth measuring against, not a recommendation.',
        highest_return:
            'Get the most out of the field over the next few seasons, taking the ' +
            'best-suited crop each time the rotation rules allow it.',
        build_soil:
            'Leave the ground better than you found it: nitrogen fixed by legumes, residue ' +
            'returned after harvest, and the families varied so nothing builds up in the soil.',
        least_water:
            'Keep the total water demand down, so the sequence survives a dry spell on ' +
            'rainfall and stored water rather than on pumping.',
    }[key];
}

/**
 * The farmer priority this strategy answers.
 *
 * This is how a weighting set on the sliders decides which of the three is
 * put forward: somebody who has pushed *build soil health* to the top is not
 * asking for the highest-return plan, and the recommendation should follow
 * what they said rather than what the arithmetic prefers.
 */
export function drivingPriority(key: StrategyKey): string | null {
    return {
        carry_on: null,
        highest_return: 'yield',
        build_soil: 'soil_health',
        least_water: 'water_conservation',
    }[key];
}
