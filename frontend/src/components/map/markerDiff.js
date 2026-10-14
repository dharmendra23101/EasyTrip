/**
 * What the marker layer should do next, decided as data (IMP-070).
 *
 * The reconciliation this describes is the fix from IMP-048: the map used to `clearLayers()` and
 * rebuild every marker on each change, and `filteredPlaces` changes on every keystroke in the map's
 * own search box — so typing "goa" destroyed and recreated every `divIcon` in the catalogue three
 * times. The diff below is what replaced it.
 *
 * It is separated from the Leaflet calls because the decision is the part worth checking. Given the
 * places that should be shown and what is already on the map, this returns a plan; applying it
 * needs a map instance, comparing it to what you expected does not.
 */

/**
 * @param places   the places that should be on the map (unfiltered by coordinates)
 * @param selected the currently selected place, or null
 * @param index    Map of place id -> { isSelected }, describing what is on the map now
 * @returns {{ add: [], rebuild: [], remove: [], keep: [] }} place ids per action
 */
export const planMarkerUpdate = (places, selected, index) => {
  const plan = { add: [], rebuild: [], remove: [], keep: [] };
  const wanted = new Set();

  places.forEach((place) => {
    // A place without usable coordinates is not "removed", it was never placeable. Postgres hands
    // DECIMAL back as a string, so this guard runs on already-normalised numbers (IMP-007).
    if (!place.latitude || !place.longitude) return;
    wanted.add(place.id);

    const isSelected = Boolean(selected && selected.id === place.id);
    const existing = index.get(place.id);

    if (!existing) {
      plan.add.push(place.id);
      return;
    }

    // Selection is the only thing that changes a marker's icon, so it is the only thing that
    // justifies rebuilding one. Everything else stays put — the common case while typing, and the
    // whole point of the diff.
    if (existing.isSelected !== isSelected) plan.rebuild.push(place.id);
    else plan.keep.push(place.id);
  });

  index.forEach((_entry, id) => {
    if (!wanted.has(id)) plan.remove.push(id);
  });

  return plan;
};

export default planMarkerUpdate;
