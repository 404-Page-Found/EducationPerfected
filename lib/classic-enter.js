// Final classic dispatch boundary, shared by the initial and retry paths.
// Reads are not atomic with the trusted key event; post-read drift remains possible.
// Box verification folds EP's IME punctuation normalization (issue #232): a box
// holding the normalized form (e.g. ？ for ?) still verifies, submitted as-is.
const { boxMatchesAnswer } = require('./answer-normalize');
async function guardClassicEnter({ readQuestion, readValue, pressEnter, shouldStop, question, answer, enter }) {
    const current = await readQuestion();
    if (current?.kind !== 'text' || current.text !== question) return false;
    const boxed = await readValue();
    if (!boxMatchesAnswer(answer, boxed) || shouldStop()) return false;
    if (enter) await pressEnter(); // A thrown/uncertain dispatch is never retried here.
    return true;
}
module.exports = { guardClassicEnter };
