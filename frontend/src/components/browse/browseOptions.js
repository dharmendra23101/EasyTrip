/**
 * Presentation vocabularies for the browse page (IMP-070).
 *
 * Icons and colours only. The ids and labels come from `constants/themes`, which is the shared
 * vocabulary the admin forms assign from — this module cannot introduce a theme that is filterable
 * here but assignable nowhere (IMP-118), because it only decorates ids it is given.
 *
 * These were module constants inside `browse.jsx`. Five of the six extracted sections need them,
 * so they live here rather than being threaded through as props.
 */
import {
  FiSun,
  FiCloud,
  FiCloudRain,
  FiHeart,
  FiBook,
  FiClock,
  FiCpu,
  FiMonitor,
  FiCompass,
  FiGlobe,
  FiUmbrella,
  FiTriangle,
  FiUsers,
  FiCalendar,
  FiGrid,
  FiList,
  FiMap,
  FiStar,
  FiInfo,
  FiActivity,
  FiSearch
} from 'react-icons/fi';
import { THEMES, SEASONS } from '../../constants/themes';

// Enhanced theme options with better styling
// Presentation only. The ids and labels come from the shared vocabulary so this page cannot drift
// from what the admin forms can actually assign (IMP-118) — the bug this replaces was `beach` and
// `mountain` being filterable here but assignable nowhere.
const THEME_PRESENTATION = {
  hot: { icon: <FiSun />, color: 'orange', bgColor: 'bg-orange-500' },
  cold: { icon: <FiCloud />, color: 'blue', bgColor: 'bg-blue-500' },
  rainy: { icon: <FiCloudRain />, color: 'indigo', bgColor: 'bg-indigo-500' },
  romantic: { icon: <FiHeart />, color: 'pink', bgColor: 'bg-pink-500' },
  religious: { icon: <FiBook />, color: 'purple', bgColor: 'bg-purple-500' },
  historical: { icon: <FiClock />, color: 'amber', bgColor: 'bg-amber-600' },
  science: { icon: <FiCpu />, color: 'cyan', bgColor: 'bg-cyan-500' },
  tech: { icon: <FiMonitor />, color: 'slate', bgColor: 'bg-slate-500' },
  adventure: { icon: <FiCompass />, color: 'green', bgColor: 'bg-green-500' },
  nature: { icon: <FiGlobe />, color: 'emerald', bgColor: 'bg-emerald-500' },
  beach: { icon: <FiUmbrella />, color: 'sky', bgColor: 'bg-sky-500' },
  mountain: { icon: <FiTriangle />, color: 'stone', bgColor: 'bg-stone-600' },
  family: { icon: <FiUsers />, color: 'teal', bgColor: 'bg-teal-500' },
  weekend: { icon: <FiCalendar />, color: 'violet', bgColor: 'bg-violet-500' }
};

export const themeOptions = THEMES.map((theme) => ({
  id: theme.id,
  label: theme.label,
  ...THEME_PRESENTATION[theme.id]
}));

const SEASON_PRESENTATION = {
  any: { icon: <FiCalendar />, color: 'gray' },
  summer: { icon: <FiSun />, color: 'yellow' },
  monsoon: { icon: <FiCloudRain />, color: 'blue' },
  winter: { icon: <FiCloud />, color: 'cyan' }
};

export const dateOptions = SEASONS.map((season) => ({
  id: season.id,
  label: season.label,
  ...SEASON_PRESENTATION[season.id]
}));

// View modes with enhanced options
export const viewModes = [
  { id: 'grid', label: 'Grid', icon: <FiGrid />, description: 'Card view' },
  { id: 'list', label: 'List', icon: <FiList />, description: 'Detailed list' },
  { id: 'map', label: 'Map', icon: <FiMap />, description: 'Interactive map' }
];

// Sort options.
//
// `relevance` is first because it is the default once a search term exists (IMP-112), and it is
// deliberately not offered when there is none: with nothing to rank, the server resolves it back to
// `newest`, so a "Best Match" label on an unsearched catalogue would name an order that is not
// running. `BrowseResults` filters it out via `canSortByRelevance`.
export const sortOptions = [
  { id: 'relevance', label: 'Best Match', icon: <FiSearch /> },
  { id: 'newest', label: 'Newest First', icon: <FiClock /> },
  { id: 'rating', label: 'Highest Rated', icon: <FiStar /> },
  { id: 'name', label: 'Alphabetical', icon: <FiInfo /> },
  { id: 'popular', label: 'Most Popular', icon: <FiActivity /> }
];

// Animation variants
export const fadeInUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4 } }
};

export const staggerChildren = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.1
    }
  }
};
