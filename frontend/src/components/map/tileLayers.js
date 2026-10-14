/**
 * The basemaps offered by the style switcher (IMP-070).
 *
 * Module scope, not component scope. This array was declared inside `ExploreMap`, so a new one —
 * along with six freshly constructed React elements for the icons — was allocated on every render
 * of a component that re-renders on every keystroke in its own search box. Nothing in it depends
 * on props or state.
 */
import { FiMapPin, FiGlobe, FiCompass, FiNavigation, FiSun, FiMoon } from 'react-icons/fi';

export const TILE_LAYERS = [
  {
    id: 'osm',
    name: 'OpenStreetMap',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    icon: <FiMapPin />
  },
  {
    id: 'terrain',
    name: 'Terrain',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    icon: <FiGlobe />
  },
  {
    id: 'humanitarian',
    name: 'Humanitarian',
    url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    icon: <FiCompass className="text-green-500" />
  },
  {
    id: 'cycle',
    name: 'Cycle Map',
    url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
    icon: <FiNavigation className="text-blue-500" />
  },
  {
    id: 'watercolor',
    name: 'Watercolor',
    url: 'https://stamen-tiles-{s}.a.ssl.fastly.net/watercolor/{z}/{x}/{y}.jpg',
    icon: <FiSun className="text-yellow-500" />
  },
  {
    id: 'dark',
    name: 'Dark Matter',
    url: 'https://cartodb-basemaps-{s}.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png',
    icon: <FiMoon className="text-indigo-500" />
  }
];

/** The basemap the map opens with. */
export const DEFAULT_TILE_URL = TILE_LAYERS[0].url;
