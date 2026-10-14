import {
  FiBook,
  FiClock,
  FiCloudRain,
  FiCpu,
  FiGlobe,
  FiHeart,
  FiHome,
  FiMap,
  FiSun,
  FiThermometer
} from 'react-icons/fi';
import { THEMES } from '../../../constants/themes';

// Enhanced theme options with icons and descriptions
// Presentation only — ids/labels/descriptions come from the shared vocabulary so this form can
// always assign every theme the browse filters offer (IMP-118).
const THEME_PRESENTATION = {
  hot: { icon: <FiSun className="mr-2" />, color: 'orange' },
  cold: { icon: <FiThermometer className="mr-2" />, color: 'blue' },
  rainy: { icon: <FiCloudRain className="mr-2" />, color: 'gray' },
  romantic: { icon: <FiHeart className="mr-2" />, color: 'pink' },
  religious: { icon: <FiBook className="mr-2" />, color: 'purple' },
  historical: { icon: <FiClock className="mr-2" />, color: 'amber' },
  science: { icon: <FiCpu className="mr-2" />, color: 'green' },
  tech: { icon: <FiCpu className="mr-2" />, color: 'indigo' },
  adventure: { icon: <FiMap className="mr-2" />, color: 'red' },
  nature: { icon: <FiGlobe className="mr-2" />, color: 'green' },
  beach: { icon: <FiGlobe className="mr-2" />, color: 'sky' },
  mountain: { icon: <FiMap className="mr-2" />, color: 'stone' },
  family: { icon: <FiHome className="mr-2" />, color: 'blue' },
  weekend: { icon: <FiClock className="mr-2" />, color: 'teal' }
};

export const themeOptions = THEMES.map((theme) => ({
  id: theme.id,
  label: theme.label,
  description: theme.description,
  ...THEME_PRESENTATION[theme.id]
}));

// Common tag suggestions
export const tagSuggestions = [
  'family-friendly',
  'weekend',
  'nature',
  'photography',
  'trekking',
  'peaceful',
  'crowded',
  'budget-friendly',
  'luxury',
  'heritage',
  'beach',
  'mountain',
  'temple',
  'museum',
  'park',
  'market',
  'shopping',
  'food',
  'nightlife',
  'cultural',
  'educational'
];

/** The wizard's four steps, in order. Rendered by FormProgress and used as the Next: labels. */
export const STEP_TITLES = {
  1: 'Basic Information',
  2: 'Location Details',
  3: 'Media & Themes',
  4: 'Tags & Details'
};
