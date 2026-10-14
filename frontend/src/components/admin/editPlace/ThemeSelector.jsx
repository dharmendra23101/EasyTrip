import { FiX } from 'react-icons/fi';
import { THEMES } from '../../../constants/themes';

export const ThemeSelector = ({ form }) => {
  const { formData, unknownThemes, handleToggleTheme, handleRemoveTheme } = form;

  return (
    <div className="mb-8">
      <h2 className="text-xl font-semibold text-gray-800 mb-1">Themes</h2>
      <p className="text-sm text-gray-500 mb-4">
        Select from the shared vocabulary. These are the exact themes visitors can filter by, so
        free text would make a place unfindable.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {THEMES.map((theme) => {
          const selected = formData.themes.includes(theme.id);
          return (
            <button
              key={theme.id}
              type="button"
              onClick={() => handleToggleTheme(theme.id)}
              aria-pressed={selected}
              title={theme.description}
              className={`text-left px-3 py-2 rounded-lg border transition-colors ${
                selected
                  ? 'bg-primary-50 border-primary-500 text-primary-700'
                  : 'bg-white border-gray-300 text-gray-700 hover:border-primary-300'
              }`}
            >
              <span className="block text-sm font-medium">{theme.label}</span>
              <span className="block text-xs text-gray-500 truncate">{theme.description}</span>
            </button>
          );
        })}
      </div>

      {unknownThemes.length > 0 && (
        <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-sm text-amber-800 mb-2">
            This place carries {unknownThemes.length === 1 ? 'a theme' : 'themes'} that{' '}
            {unknownThemes.length === 1 ? 'is' : 'are'} no longer offered, so{' '}
            {unknownThemes.length === 1 ? 'it is' : 'they are'} not filterable. Remove or replace:
          </p>
          <div className="flex flex-wrap gap-2">
            {unknownThemes.map((theme) => (
              <span
                key={theme}
                className="flex items-center bg-white text-amber-800 border border-amber-300 px-3 py-1 rounded-full text-sm"
              >
                {theme}
                <button
                  type="button"
                  onClick={() => handleRemoveTheme(theme)}
                  aria-label={`Remove theme ${theme}`}
                  className="ml-2 text-amber-600 hover:text-amber-900"
                >
                  <FiX className="w-4 h-4" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
