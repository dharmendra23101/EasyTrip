/** Turning request query strings into the criteria object `placeModel` expects. */

const parseArrayParam = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [value];
  } catch {
    return [value];
  }
};

const criteriaFromQuery = (query) => {
  const parsedMinRating = Number.parseFloat(query.minRating);
  return {
    searchTerm: query.searchTerm?.trim() || undefined,
    location: query.location?.trim() || undefined,
    district: query.district?.trim() || undefined,
    state: query.state?.trim() || undefined,
    tags: parseArrayParam(query.tags),
    themes: parseArrayParam(query.themes),
    minRating: Number.isFinite(parsedMinRating) ? parsedMinRating : undefined,
    date: query.date?.trim() || undefined,
    // `FV-029`. Same array shape as `tags`/`themes`, so `?stepFree=yes&stepFree=partial` and
    // `?stepFree=["yes","partial"]` both work — the browse UI sends the second, a hand-written
    // request is likelier to send the first.
    stepFree: parseArrayParam(query.stepFree)
  };
};

module.exports = { parseArrayParam, criteriaFromQuery };
