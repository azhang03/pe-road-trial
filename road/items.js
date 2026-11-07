// The six items: names and the text of what they do. No DOM. Copied from ../map/items.js, so both prototypes read the same.
// The prices and the numbers are in RULES in main.js.

export const ITEM_IDS = ['bookmark', 'secondOpinion', 'changeOrder', 'contingency', 'valueEngineering', 'overtime'];

export const ITEM_NAME = {
  bookmark: 'Handbook Bookmark',
  secondOpinion: 'Second Opinion',
  changeOrder: 'Change Order',
  contingency: 'Contingency Fund',
  valueEngineering: 'Value Engineering',
  overtime: 'Overtime',
};

/** Short names for the HUD. */
export const ITEM_SHORT = {
  bookmark: 'Bookmark',
  secondOpinion: '2nd Opinion',
  changeOrder: 'Change Order',
  contingency: 'Contingency',
  valueEngineering: 'Value Eng.',
  overtime: 'Overtime',
};

/** The items that have uses in each stage. The value is the key in run.used. */
export const USE_ITEMS = ['secondOpinion', 'changeOrder', 'contingency'];

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * What an item does with n copies.
 * nums: { valueEngineering (share for each copy), overtime (seconds for each copy) }.
 */
export function itemEffect(id, n, nums) {
  switch (id) {
    case 'bookmark':
      return n >= 2
        ? 'The Field Book button opens the entry for the question, and the card shows the first solution step.'
        : 'The Field Book button opens the entry for the question. A second copy also shows the first solution step.';
    case 'secondOpinion':
      return `On a choice question, a tap hides 2 wrong options. ${plural(n, 'use')} in each stage.`;
    case 'changeOrder':
      return `Skip a question at no cost. ${plural(n, 'use')} in each stage. Not in the design review.`;
    case 'contingency':
      return `The first ${n === 1 ? 'wrong answer' : plural(n, 'wrong answer')} in each stage cost${n === 1 ? 's' : ''} no budget.`;
    case 'valueEngineering':
      return `+${Math.round(nums.valueEngineering * n * 100)}% fee on each right answer.`;
    case 'overtime':
      return `+${nums.overtime * n} s on each time limit.`;
    default:
      return '';
  }
}
