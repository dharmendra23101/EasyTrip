/**
 * Daily activity, three series (`FV-022`).
 *
 * ---------------------------------------------------------------------------
 * Why this is hand-drawn SVG and not a charting library
 * ---------------------------------------------------------------------------
 * The frontend has twelve runtime dependencies and none of them draws charts. Adding one for a
 * single admin-only view is a bundle, a licence, an upgrade path and a `BL-075` entry, in exchange
 * for a grouped bar chart that is about forty lines of arithmetic. `IMP-120`'s lesson is that a
 * dependency is easy to add and hard to remove.
 *
 * ---------------------------------------------------------------------------
 * A chart is not readable by everybody, so it is not the only thing here
 * ---------------------------------------------------------------------------
 * An `<svg>` full of `<rect>` elements says nothing to a screen reader, and this project gates six
 * routes on `axe` precisely so that visual-only information does not ship. So the SVG is
 * `aria-hidden` and the same numbers are also a real `<table>`, visually hidden but fully
 * navigable. **The table is the source; the chart is the illustration** — not the other way round,
 * which is the version that decays the first time somebody edits one and not the other.
 *
 * ---------------------------------------------------------------------------
 * The empty case is not an empty chart
 * ---------------------------------------------------------------------------
 * A window in which nothing happened is a real answer and a common one for a project with no
 * deployment. Drawing thirty invisible bars and a y-axis labelled 0 looks like a broken render; a
 * sentence saying nothing happened is the truth and reads as deliberate.
 */

const SERIES = [
  {
    key: 'reviews',
    label: 'Reviews',
    // The three fills double as the legend swatches, so a colour changed here cannot disagree with
    // the key beside the chart.
    fill: '#2563eb',
    hint: 'Content arriving'
  },
  { key: 'trips', label: 'Trips', fill: '#059669', hint: 'The planner being used' },
  { key: 'reports', label: 'Reports', fill: '#d97706', hint: 'Moderation inflow' }
];

const VIEW_WIDTH = 720;
const VIEW_HEIGHT = 200;
const PAD_LEFT = 28;
const PAD_BOTTOM = 18;

export const ActivityChart = ({ activity = [] }) => {
  const days = activity.length;

  // The tallest bar in any series, which is what every bar is scaled against. `1` rather than `0`
  // as the floor so an all-zero window divides by one instead of producing `Infinity` heights.
  const peak = Math.max(
    1,
    ...activity.flatMap((day) => SERIES.map((series) => day[series.key] || 0))
  );

  const total = activity.reduce(
    (sum, day) => sum + SERIES.reduce((n, series) => n + (day[series.key] || 0), 0),
    0
  );

  if (days === 0) {
    return <p className="py-6 text-sm text-gray-600">No activity data for this window.</p>;
  }

  const plotWidth = VIEW_WIDTH - PAD_LEFT;
  const plotHeight = VIEW_HEIGHT - PAD_BOTTOM;
  const slot = plotWidth / days;
  const barWidth = Math.max(1, (slot - 1) / SERIES.length);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-4">
        {SERIES.map((series) => (
          <span key={series.key} className="flex items-center text-xs text-gray-600">
            <span
              className="mr-2 inline-block h-3 w-3 rounded-sm"
              style={{ backgroundColor: series.fill }}
            />
            <span className="font-medium text-gray-800">{series.label}</span>
            <span className="ml-1 text-gray-500">— {series.hint}</span>
          </span>
        ))}
      </div>

      {total === 0 ? (
        // Said, not drawn. See the header: thirty invisible bars read as a broken chart.
        <p className="rounded-lg border border-dashed border-gray-300 py-8 text-center text-sm text-gray-600">
          Nothing happened in the last {days} days — no reviews, trips or reports.
        </p>
      ) : (
        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          className="w-full"
          // The table below carries the same numbers, so this is decoration to a screen reader.
          aria-hidden="true"
          focusable="false"
        >
          <line
            x1={PAD_LEFT}
            y1={plotHeight}
            x2={VIEW_WIDTH}
            y2={plotHeight}
            stroke="#d1d5db"
            strokeWidth="1"
          />
          <text x="0" y="10" fontSize="10" fill="#6b7280">
            {peak}
          </text>
          <text x="0" y={plotHeight} fontSize="10" fill="#6b7280">
            0
          </text>

          {activity.map((day, index) =>
            SERIES.map((series, seriesIndex) => {
              const value = day[series.key] || 0;
              if (value === 0) return null;
              const height = (value / peak) * (plotHeight - 4);
              return (
                <rect
                  key={`${day.date}-${series.key}`}
                  x={PAD_LEFT + index * slot + seriesIndex * barWidth}
                  y={plotHeight - height}
                  width={barWidth}
                  height={height}
                  fill={series.fill}
                />
              );
            })
          )}
        </svg>
      )}

      <table className="sr-only">
        <caption>
          Daily activity for the last {days} days: reviews, trips and reports created each day.
        </caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            {SERIES.map((series) => (
              <th key={series.key} scope="col">
                {series.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {activity.map((day) => (
            <tr key={day.date}>
              <th scope="row">{day.date}</th>
              {SERIES.map((series) => (
                <td key={series.key}>{day[series.key] || 0}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default ActivityChart;
