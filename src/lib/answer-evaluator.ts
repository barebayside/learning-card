/**
 * MCQ answer evaluator — pure string matching, no API call needed.
 */

export interface EvalResult {
  correctness: 'correct' | 'partial' | 'incorrect';
  feedback: string;
  suggested_grade: number;
}

export function evaluateMcq(correctAnswer: string, userAnswer: string): EvalResult {
  const userLetter = userAnswer.trim().toUpperCase()[0] || '';
  const correctLower = correctAnswer.toLowerCase();

  // Extract the correct option letter from the answer text
  let correctLetter = '';
  for (const letter of ['A', 'B', 'C', 'D']) {
    if (correctLower.startsWith(`${letter.toLowerCase()})`) || correctLower.startsWith(`${letter.toLowerCase()}.`)) {
      correctLetter = letter;
      break;
    }
  }

  // If we couldn't extract a letter, try matching content
  if (!correctLetter) {
    if (correctLower.includes(userAnswer.toLowerCase().trim())) {
      return {
        correctness: 'correct',
        feedback: 'Correct!',
        suggested_grade: 2,
      };
    }
  }

  if (userLetter === correctLetter) {
    return {
      correctness: 'correct',
      feedback: 'Correct!',
      suggested_grade: 2,
    };
  } else {
    return {
      correctness: 'incorrect',
      feedback: correctLetter ? `The correct answer was ${correctLetter}.` : 'Incorrect.',
      suggested_grade: 0,
    };
  }
}
