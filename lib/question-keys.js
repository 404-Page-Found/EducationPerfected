// Question-key variants for classic vocab items (issue #234).
// EP can render the same item with "," or ";" ("eight, 8" vs "eight; 8"):
// the detected question text and the correction modal's question can differ
// by punctuation only. All dictionary reads (findAnswer) and writes
// (learnEntry/recordRejection) must index the same symmetric set so a
// correction learned under one rendering is found from the other.
function cleanString(string) {
    return String(string)
        .replace(/\([^)]*\)/g, "").trim()
        .split(";")[0].trim()
        .split(",")[0].trim()
        .split("|")[0].trim();
}

// Ordered, deduplicated key variants for a question: the literal text, the
// comma->semicolon rendering, the semicolon->comma rendering, then the
// punctuation-stripped clean form shared by all renderings. Empty keys are
// dropped so callers never index "".
function questionKeyVariants(question) {
    const trimmed = String(question).trim();
    const commaToSemi = trimmed.replace(/,/g, ";");
    const semiToComma = trimmed.replace(/;/g, ",");
    const cleaned = cleanString(question);
    const out = [];
    const seen = new Set();
    for (const candidate of [trimmed, commaToSemi, semiToComma, cleaned]) {
        const key = String(candidate).trim();
        if (key === '' || seen.has(key)) continue;
        seen.add(key);
        out.push(key);
    }
    return out;
}

module.exports = { cleanString, questionKeyVariants };
