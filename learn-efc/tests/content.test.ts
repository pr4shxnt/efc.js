import assert from 'node:assert/strict';
import test from 'node:test';
import { TUTORIALS, TRACKS, tutorialIndex } from '../lib/tutorials';
import { EXTRAS } from '../lib/practice';

test('chapter URLs are unique and resolve to the intended chapter', () => {
  assert.ok(TUTORIALS.length > 0);
  assert.equal(new Set(TUTORIALS.map((chapter) => chapter.id)).size, TUTORIALS.length);
  for (const [index, chapter] of TUTORIALS.entries()) {
    assert.match(chapter.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(tutorialIndex(chapter.id), index);
    assert.ok(chapter.title && chapter.summary && chapter.sections.length);
    assert.ok(TRACKS.some((track) => track === chapter.track));
  }
  assert.equal(tutorialIndex('missing-chapter'), -1);
});

test('quizzes have distinct choices and a valid answer after shuffling', () => {
  const answerPositions = new Set<number>();
  for (const { id, quiz } of TUTORIALS) {
    assert.ok(quiz.question && quiz.explanation, id);
    assert.ok(quiz.options.length >= 2, id);
    assert.equal(new Set(quiz.options).size, quiz.options.length, id);
    assert.ok(Number.isInteger(quiz.correctIndex), id);
    assert.ok(quiz.correctIndex >= 0 && quiz.correctIndex < quiz.options.length, id);
    const authored = EXTRAS[id]?.quiz;
    if (authored) {
      assert.equal(quiz.options[quiz.correctIndex], authored.options[authored.correctIndex], id);
    }
    answerPositions.add(quiz.correctIndex);
  }
  assert.ok(answerPositions.size > 1, 'The answer must not always occupy the same position');
});
