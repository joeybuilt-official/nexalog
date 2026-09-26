// SM-2 spaced repetition update. Pure function, no I/O.
// grade: 0=Again 1=Hard 2=Okay 3=Good 4=Great 5=Perfect

export interface ReviewState {
  intervalDays: number;
  easeFactor: number;
  reviewCount: number;
}

export interface SM2Result {
  intervalDays: number;
  easeFactor: number;
  nextReviewAt: Date;
}

export function sm2Update(state: ReviewState, grade: number): SM2Result {
  const { intervalDays, easeFactor, reviewCount } = state;

  let newEase = easeFactor + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02));
  newEase = Math.max(1.3, newEase);

  let newInterval: number;
  if (grade < 3) {
    newInterval = 1;
  } else if (reviewCount === 0) {
    newInterval = 1;
  } else if (reviewCount === 1) {
    newInterval = 6;
  } else {
    newInterval = Math.round(intervalDays * easeFactor);
  }
  newInterval = Math.max(1, newInterval);

  const nextReviewAt = new Date(Date.now() + newInterval * 24 * 60 * 60 * 1000);

  return { intervalDays: newInterval, easeFactor: newEase, nextReviewAt };
}
