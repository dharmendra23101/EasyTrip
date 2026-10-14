import { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import { getPlaceById, updatePlace } from '../services/placeService';
import { getPlaceImageUrl } from '../utils/placeImage';
import { isValidThemeId } from '../constants/themes';
import { collectErrors } from '../utils/placeFormValidation';

/**
 * Loading, editing and saving an existing place (IMP-070 / IMP-126).
 *
 * Shares `collectErrors` with the create form rather than keeping its own rules. Before this the
 * edit form checked only that coordinates parsed as numbers — not that they were in range — so
 * latitude 999 passed the client and was rejected by the API's `placeBodyRules`, i.e. the same
 * mistake produced an inline message on create and a server error toast on edit. Same rules now,
 * same messages, caught in the same place.
 *
 * @param {String|undefined} id
 * @param {Object} auth - `{ currentUser, isAdmin, getIdToken }`
 * @param {Function} onSaved - where to go after a successful update
 */
export function useEditPlace(id, { currentUser, isAdmin, getIdToken }, onSaved) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    location: '',
    district: '',
    state: '',
    locality: '',
    pin_code: '',
    latitude: '',
    longitude: '',
    themes: [],
    tags: [],
    custom_keys: {},
    // TD-023. Defaulted rather than blank: the column is NOT NULL with this default, so a form
    // that started empty would send '' and the validator would read it as "not provided" —
    // silently keeping whatever was there while appearing to have set it.
    setting: 'unknown',
    // FV-029. Defaulted for the same reason `setting` is — the columns are NOT NULL with this
    // default, and a blank would be read as "not provided". The provenance three start empty
    // because absent is what they genuinely are until somebody surveys the place.
    step_free_access: 'unknown',
    accessible_restroom: 'unknown',
    accessibility_notes: '',
    accessibility_source: '',
    accessibility_checked_on: '',
    // FV-028. `best_months` is `[]` and not `null`, matching the column: `buildPlaceFormData` drops
    // null, so a cleared month list would send nothing and the API would keep the old months while
    // the form showed none. `typical_visit_minutes` is '' because absent is genuinely what it is.
    best_months: [],
    crowd_level: 'unknown',
    typical_visit_minutes: '',
    seasonality_source: '',
    seasonality_checked_on: '',
    created_by: '',
    created_by_name: '',
    updated_by: '',
    updated_by_name: ''
  });

  const [currentImageUrl, setCurrentImageUrl] = useState(null);
  const [newTag, setNewTag] = useState('');
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyValue, setNewKeyValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadingPlace, setLoadingPlace] = useState(true);
  const [error, setError] = useState(null);
  const [errors, setErrors] = useState({});
  const [createdAt, setCreatedAt] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');
  const [previousUpdate, setPreviousUpdate] = useState('');

  // Fetch place data
  useEffect(() => {
    const fetchPlace = async () => {
      if (!id) return;

      try {
        setLoadingPlace(true);
        setError(null);

        const data = await getPlaceById(id);

        setFormData({
          name: data.name || '',
          description: data.description || '',
          location: data.location || '',
          district: data.district || '',
          state: data.state || '',
          locality: data.locality || '',
          pin_code: data.pin_code || '',
          latitude: data.latitude || '',
          longitude: data.longitude || '',
          themes: data.themes || [],
          tags: data.tags || [],
          custom_keys: data.custom_keys || {},
          setting: data.setting || 'unknown',
          step_free_access: data.step_free_access || 'unknown',
          accessible_restroom: data.accessible_restroom || 'unknown',
          accessibility_notes: data.accessibility_notes || '',
          accessibility_source: data.accessibility_source || '',
          // Already `YYYY-MM-DD` from the API (`to_char` in `placeModel`), which is exactly what an
          // <input type="date"> wants. A serialised Date would need slicing and would be a day out.
          accessibility_checked_on: data.accessibility_checked_on || '',
          // FV-028. `?? []` rather than `|| []` for the months so an existing empty array survives
          // as itself, and `?? ''` for the duration so a real 0 would not be swallowed — it cannot
          // be one today (the CHECK refuses it), which is exactly why `||` here would be a trap
          // waiting for the constraint to change.
          best_months: data.best_months ?? [],
          crowd_level: data.crowd_level || 'unknown',
          typical_visit_minutes: data.typical_visit_minutes ?? '',
          seasonality_source: data.seasonality_source || '',
          // Already `YYYY-MM-DD` from the API, like the accessibility date above.
          seasonality_checked_on: data.seasonality_checked_on || '',
          created_by: data.created_by || currentUser?.uid || '',
          created_by_name:
            data.created_by_name ||
            currentUser?.displayName ||
            currentUser?.email ||
            'Unknown User',
          updated_by: currentUser?.uid || '',
          updated_by_name: currentUser?.displayName || currentUser?.email || 'Unknown User'
        });

        setCurrentImageUrl(getPlaceImageUrl(data, null));
        setCreatedAt(data.created_at || '');
        setUpdatedAt(data.updated_at || '');
        setPreviousUpdate(data.previous_update || '');
        setLoadingPlace(false);
      } catch (err) {
        console.error(`Error fetching place ID ${id}:`, {
          message: err.message,
          status: err.status
        });
        setError(err.message || 'Place not found or could not be loaded');
        setLoadingPlace(false);
        toast.error(err.message || 'Failed to load place');
      }
    };

    if (id && currentUser && isAdmin) {
      fetchPlace();
    }
  }, [id, currentUser, isAdmin]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
    if (errors[name]) {
      setErrors({ ...errors, [name]: '' });
    }
  };

  const handleImageChange = (file) => {
    setFormData({ ...formData, image: file });
  };

  const handleAddTag = () => {
    if (newTag.trim() && !formData.tags.includes(newTag.trim())) {
      setFormData({ ...formData, tags: [...formData.tags, newTag.trim()] });
      setNewTag('');
    }
  };

  const handleRemoveTag = (tagToRemove) => {
    setFormData({
      ...formData,
      tags: formData.tags.filter((tag) => tag !== tagToRemove)
    });
  };

  // Themes are a fixed vocabulary, not free text (IMP-020). This form used to accept any string,
  // so an edit could write a theme no browse filter would ever match — and because editing is how
  // most places get corrected, free text here quietly undid the taxonomy addPlace enforced.
  const handleToggleTheme = (themeId) => {
    setFormData((current) => ({
      ...current,
      themes: current.themes.includes(themeId)
        ? current.themes.filter((theme) => theme !== themeId)
        : [...current.themes, themeId]
    }));
  };

  // A place saved before the vocabulary was enforced may carry ids that are no longer offered.
  // They are shown separately rather than dropped silently, so an admin can see and clear them —
  // deleting someone's data on page load because the taxonomy changed would be worse.
  const unknownThemes = formData.themes.filter((theme) => !isValidThemeId(theme));

  const handleRemoveTheme = (themeToRemove) => {
    setFormData({
      ...formData,
      themes: formData.themes.filter((theme) => theme !== themeToRemove)
    });
  };

  const handleAddCustomKey = () => {
    if (newKeyName.trim() && newKeyValue.trim()) {
      setFormData({
        ...formData,
        custom_keys: {
          ...formData.custom_keys,
          [newKeyName.trim()]: newKeyValue.trim()
        }
      });
      setNewKeyName('');
      setNewKeyValue('');
    }
  };

  const handleRemoveCustomKey = (keyToRemove) => {
    const updatedCustomKeys = { ...formData.custom_keys };
    delete updatedCustomKeys[keyToRemove];
    setFormData({ ...formData, custom_keys: updatedCustomKeys });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // The same rules the create form uses. `formData.image` is the newly picked file, if any.
    const validationErrors = collectErrors(formData, formData.image || null);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      toast.error('Please fix the errors before saving');
      return;
    }

    try {
      setIsSubmitting(true);
      const token = await getIdToken();
      if (!token) {
        throw new Error('Your session has expired. Please sign in again.');
      }
      const updatedFormData = {
        ...formData,
        created_by: formData.created_by || currentUser.uid,
        created_by_name:
          formData.created_by_name ||
          currentUser.displayName ||
          currentUser.email ||
          'Unknown User',
        updated_by: currentUser.uid,
        updated_by_name: currentUser.displayName || currentUser.email || 'Unknown User',
        updated_at: new Date().toISOString()
      };

      await updatePlace(id, updatedFormData, token);

      toast.success('Place updated successfully!');
      onSaved();
    } catch (err) {
      console.error('Error updating place:', {
        message: err.message,
        status: err.status,
        responseData: err.response?.data
      });
      toast.error(err.message || 'Failed to update place');
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    formData,
    errors,
    currentImageUrl,
    newTag,
    newKeyName,
    newKeyValue,
    isSubmitting,
    loadingPlace,
    error,
    createdAt,
    updatedAt,
    previousUpdate,
    unknownThemes,
    setNewTag,
    setNewKeyName,
    setNewKeyValue,
    handleChange,
    handleImageChange,
    handleToggleTheme,
    handleRemoveTheme,
    handleAddTag,
    handleRemoveTag,
    handleAddCustomKey,
    handleRemoveCustomKey,
    handleSubmit
  };
}
