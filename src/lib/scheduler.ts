/**
 * Spaced repetition scheduler using fixed interval progression.
 *
 * Interval progression (step_index):
 *   0: Day 0   (same day, 10 minutes)
 *   1: Day 1
 *   2: Day 4
 *   3: Day 10
 *   4: Day 25
 *   5: Day 60
 *   6: Day 150
 *   7: Day 365
 *
 * Grading:
 *   Again (0) → go back to step 0 (relearn from scratch)
 *   Hard  (1) → repeat current step
 *   Good  (2) → advance to next step
 *   Easy  (3) → skip one step ahead
 */

export interface ScheduleResult {
  card_state: string;
  ease_factor: number;
  interval_days: number;
  step_index: number;
  due_date: string; // ISO string
}

interface CardForScheduling {
  card_state: string;
  ease_factor: number;
  step_index: number;
}

const INTERVAL_STEPS = [0, 1, 4, 10, 25, 60, 150, 365];
const LEARNING_STEPS_MINUTES = [1, 10];

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function processGrade(card: CardForScheduling, grade: number, now?: Date): ScheduleResult {
  const currentTime = now || new Date();
  const state = card.card_state;

  if (state === 'new' || state === 'learning') {
    return processLearning(card, grade, currentTime);
  } else if (state === 'review' || state === 'relearning') {
    return processReview(card, grade, currentTime);
  } else {
    throw new Error(`Unknown card state: ${state}`);
  }
}

function processLearning(card: CardForScheduling, grade: number, now: Date): ScheduleResult {
  const steps = LEARNING_STEPS_MINUTES;
  const step = card.step_index;

  if (grade === 0) {
    // Again: restart learning
    return {
      card_state: 'learning',
      ease_factor: card.ease_factor,
      interval_days: 0,
      step_index: 0,
      due_date: addMinutes(now, steps[0]).toISOString(),
    };
  } else if (grade === 1) {
    // Hard: repeat current learning step
    const delay = steps[Math.min(step, steps.length - 1)];
    return {
      card_state: 'learning',
      ease_factor: card.ease_factor,
      interval_days: 0,
      step_index: step,
      due_date: addMinutes(now, delay).toISOString(),
    };
  } else if (grade === 2) {
    // Good: advance to next learning step
    const nextStep = step + 1;
    if (nextStep < steps.length) {
      return {
        card_state: 'learning',
        ease_factor: card.ease_factor,
        interval_days: 0,
        step_index: nextStep,
        due_date: addMinutes(now, steps[nextStep]).toISOString(),
      };
    } else {
      // Graduate into review progression at step 1 (Day 1)
      const interval = INTERVAL_STEPS[1];
      return {
        card_state: 'review',
        ease_factor: card.ease_factor,
        interval_days: interval,
        step_index: 1,
        due_date: addDays(now, interval).toISOString(),
      };
    }
  } else {
    // Easy: skip learning entirely, jump to step 2 (Day 4)
    const interval = INTERVAL_STEPS[2];
    return {
      card_state: 'review',
      ease_factor: card.ease_factor,
      interval_days: interval,
      step_index: 2,
      due_date: addDays(now, interval).toISOString(),
    };
  }
}

function processReview(card: CardForScheduling, grade: number, now: Date): ScheduleResult {
  const step = card.step_index;
  const maxStep = INTERVAL_STEPS.length - 1;

  if (grade === 0) {
    // Again: reset to step 0 (same-day review in 10 minutes)
    return {
      card_state: 'relearning',
      ease_factor: card.ease_factor,
      interval_days: 0,
      step_index: 0,
      due_date: addMinutes(now, 10).toISOString(),
    };
  } else if (grade === 1) {
    // Hard: stay at current step
    const interval = INTERVAL_STEPS[Math.min(step, maxStep)];
    return {
      card_state: 'review',
      ease_factor: card.ease_factor,
      interval_days: interval,
      step_index: step,
      due_date: addDays(now, Math.max(interval, 1)).toISOString(),
    };
  } else if (grade === 2) {
    // Good: advance one step
    const nextStep = Math.min(step + 1, maxStep);
    const interval = INTERVAL_STEPS[nextStep];
    return {
      card_state: 'review',
      ease_factor: card.ease_factor,
      interval_days: interval,
      step_index: nextStep,
      due_date: addDays(now, interval).toISOString(),
    };
  } else {
    // Easy: skip ahead two steps
    const nextStep = Math.min(step + 2, maxStep);
    const interval = INTERVAL_STEPS[nextStep];
    return {
      card_state: 'review',
      ease_factor: card.ease_factor,
      interval_days: interval,
      step_index: nextStep,
      due_date: addDays(now, interval).toISOString(),
    };
  }
}
