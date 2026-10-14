import { useState } from 'react';
import { toast } from 'react-toastify';
import { collectErrors, collectStepErrors, emptyPlaceForm } from '../utils/placeFormValidation';

/**
 * The add-place wizard's state and every operation on it (IMP-070).
 *
 * Returns one bundle rather than twenty values, because each step component destructures the
 * handful it needs — which keeps the step JSX identical to what it was inline in the page.
 *
 * @param {Object} deps - `{ getIdToken, createPlace, onCreated, geocode }`; injected so the submit
 *   and lookup paths are callable without a router, a Firebase session or a network.
 */
export function usePlaceForm({ getIdToken, createPlace, onCreated, geocode }) {
  const [formData, setFormData] = useState(emptyPlaceForm);

  // UI state
  const [primaryImage, setPrimaryImage] = useState(null);
  const [newTag, setNewTag] = useState('');
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyValue, setNewKeyValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState({});
  const [step, setStep] = useState(1);
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);

  // Geocoding (IMP-116). `geocodeResults` is non-empty only while an ambiguous lookup is awaiting a
  // choice — an exact match applies itself and never populates this.
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [geocodeResults, setGeocodeResults] = useState([]);

  const validateStep = (stepNumber) => {
    const stepErrors = collectStepErrors(stepNumber, formData, primaryImage);
    setErrors(stepErrors);
    return Object.keys(stepErrors).length === 0;
  };

  const goToStep = (target) => {
    // Going backwards never blocks — a user must always be able to return and fix something.
    if (target < step) {
      setErrors({});
      setStep(target);
      return;
    }
    if (validateStep(step)) {
      setStep(target);
    }
  };

  const validateForm = () => {
    const newErrors = collectErrors(formData, primaryImage);
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  /**
   * One field changes.
   *
   * The updater form (`setFormData(previous => …)`) rather than `setFormData({ ...formData, … })`,
   * and that is a fix rather than a style choice. The spread closes over the `formData` of the
   * render the handler was created in, so **two updates in one batch both start from the same
   * snapshot and the first is lost.** React 18 batches automatically, so any code path that sets
   * two fields without a render in between — filling several fields at once, a paste handler, a
   * test — silently drops one.
   *
   * Found by `placeGeocoding.test.jsx`, which types a location, a district and a state before
   * asking for a lookup and got only the last one.
   */
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((previous) => ({
      ...previous,
      [name]: value,
      // Typing over a coordinate revokes the lookup's claim to it (IMP-127). The server enforces
      // this too — it compares the pin it is given against the pin it has — but leaving a stale
      // `nominatim` in the form would mean the UI and the row disagree about what is about to be
      // saved, and the admin would be reading the wrong one.
      ...(name === 'latitude' || name === 'longitude' ? { coordinates_source: null } : {})
    }));

    // Clear the error as soon as the user starts fixing the field.
    if (errors[name]) {
      setErrors((previous) => ({ ...previous, [name]: '' }));
    }
  };

  const handleThemeToggle = (themeId) => {
    setFormData({
      ...formData,
      themes: formData.themes.includes(themeId)
        ? formData.themes.filter((id) => id !== themeId)
        : [...formData.themes, themeId]
    });
  };

  const handleImageChange = (file) => {
    if (file) {
      // Validate file size
      if (file.size > 5 * 1024 * 1024) {
        toast.error('Image size must be less than 5MB');
        setErrors({ ...errors, image: 'Image size must be less than 5MB' });
        return;
      }

      // Validate file type
      if (!file.type.startsWith('image/')) {
        toast.error('Only image files are allowed');
        setErrors({ ...errors, image: 'Only image files are allowed' });
        return;
      }

      setPrimaryImage(file);
      setErrors({ ...errors, image: '' });

      // Create preview
      const reader = new FileReader();
      reader.readAsDataURL(file);
    }
  };

  /**
   * Clearing the chosen image.
   *
   * Inline in the page this was `setPrimaryImage(null)` plus a toast, written directly into
   * `ImageUpload`'s callback — the one place the markup reached into the page's state rather than
   * calling a handler. Extracting the step surfaced it; it is the counterpart to
   * `handleImageChange` and belongs beside it.
   */
  const handleImageRemove = () => {
    setPrimaryImage(null);
    toast.info('Image removed');
  };

  const handleAddTag = (tag = null) => {
    const tagToAdd = tag || newTag.trim();
    if (tagToAdd && !formData.tags.includes(tagToAdd)) {
      if (formData.tags.length >= 10) {
        toast.error('Maximum 10 tags allowed');
        return;
      }
      setFormData({ ...formData, tags: [...formData.tags, tagToAdd] });
      setNewTag('');
      setShowTagSuggestions(false);
    } else if (!tagToAdd) {
      toast.error('Tag cannot be empty');
    } else {
      toast.error('Tag already exists');
    }
  };

  const handleRemoveTag = (tagToRemove) => {
    setFormData({
      ...formData,
      tags: formData.tags.filter((tag) => tag !== tagToRemove)
    });
    toast.info(`Tag "${tagToRemove}" removed`);
  };

  const handleAddCustomKey = () => {
    const key = newKeyName.trim();
    const value = newKeyValue.trim();

    if (key && value) {
      if (formData.custom_keys[key]) {
        toast.error('This detail key already exists');
        return;
      }

      if (Object.keys(formData.custom_keys).length >= 10) {
        toast.error('Maximum 10 custom details allowed');
        return;
      }

      setFormData({
        ...formData,
        custom_keys: {
          ...formData.custom_keys,
          [key]: value
        }
      });
      setNewKeyName('');
      setNewKeyValue('');
    } else {
      toast.error('Both key and value are required');
    }
  };

  const handleRemoveCustomKey = (keyToRemove) => {
    const updatedCustomKeys = { ...formData.custom_keys };
    delete updatedCustomKeys[keyToRemove];
    setFormData({ ...formData, custom_keys: updatedCustomKeys });
    toast.info(`Detail "${keyToRemove}" removed`);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      toast.error('Please fix the errors before submitting');
      return;
    }

    setIsSubmitting(true);
    setErrors({});

    try {
      const token = await getIdToken();
      if (!token) {
        throw new Error('Your session has expired. Please sign in again.');
      }

      // Prepare data object for the service
      const placeData = {
        ...formData,
        // Add the image file directly
        image: primaryImage
      };

      // Submit the form - let the service handle FormData creation
      const response = await createPlace(placeData, token);

      setIsSubmitting(false);
      toast.success('Place created successfully!');
      onCreated(response);
    } catch (error) {
      setIsSubmitting(false);
      console.error('Error creating place:', error);
      toast.error(error.message || 'Failed to create place. Please try again.');
    }
  };

  /**
   * Fill the coordinates from the address (`IMP-116`).
   *
   * Replaces a `toast.info('🔍 Location lookup feature coming soon!')` next to a
   * `// TODO: Implement geocoding API integration` — a button that existed, did nothing, and
   * admitted it.
   *
   * **A single result fills the form. Several do not.** Auto-filling the first of an ambiguous set
   * is how the wrong coordinates get saved: the admin sees a pin appear, assumes it is right, and
   * the mistake surfaces later on a public map. Candidates are surfaced for a choice instead, and
   * `applyGeocodeResult` is what commits one.
   *
   * The query is built from the whole address the admin has typed, not `location` alone — "Hampi"
   * is ambiguous where "Hampi, Ballari, Karnataka" is not, and the extra fields are already on the
   * form.
   */
  const handleLocationLookup = async () => {
    if (!formData.location.trim()) {
      toast.error('Please enter a location first');
      return;
    }

    const query = [formData.location, formData.district, formData.state]
      .map((part) => (part || '').trim())
      .filter(Boolean)
      .join(', ');

    setIsLookingUp(true);
    setGeocodeResults([]);
    try {
      const token = await getIdToken();
      if (!token) {
        toast.error('Your session has expired. Please sign in again.');
        return;
      }

      const { results, status } = await geocode(token, query);

      if (status === 'no_match') {
        // Stated, not silent. A lookup that quietly does nothing is indistinguishable from the
        // "coming soon" stub this replaces.
        toast.error(`No coordinates found for "${query}". Try a more specific address.`);
        return;
      }

      if (status === 'exact') {
        applyGeocodeResult(results[0]);
        return;
      }

      setGeocodeResults(results);
      toast.info(`${results.length} matches — choose the right one.`);
    } catch (error) {
      console.error('Geocoding lookup failed:', error);
      toast.error('Could not look up coordinates. Please try again.');
    } finally {
      setIsLookingUp(false);
    }
  };

  /**
   * Commit one candidate to the form.
   *
   * Coordinates are written as strings because every other field in this form is a string and the
   * validator (`placeFormValidation`) parses them; handing it a number here would make this the one
   * field with a different type flowing through the same checks.
   *
   * The address fields are filled **only where the admin left a blank.** Overwriting what somebody
   * typed with a geocoder's phrasing is the kind of helpfulness that loses work.
   */
  const applyGeocodeResult = (result) => {
    if (!result) return;

    setFormData((previous) => ({
      ...previous,
      latitude: String(result.latitude),
      longitude: String(result.longitude),
      // The one place this is ever set. It travels with the create request so the place page can
      // credit OpenStreetMap for exactly the coordinates that came from it (IMP-127) — ODbL 4.3
      // obliges attribution for geocoding output, and a blanket notice would credit OSM for pins
      // an admin typed by hand.
      coordinates_source: 'nominatim',
      district: previous.district?.trim() ? previous.district : result.district || '',
      state: previous.state?.trim() ? previous.state : result.state || '',
      pin_code: previous.pin_code?.trim() ? previous.pin_code : result.postcode || ''
    }));

    setGeocodeResults([]);
    toast.success(`Coordinates set from ${result.label || 'the lookup'}.`);
  };

  const clearGeocodeResults = () => setGeocodeResults([]);

  return {
    formData,
    errors,
    step,
    primaryImage,
    newTag,
    newKeyName,
    newKeyValue,
    isSubmitting,
    showTagSuggestions,
    setNewTag,
    setNewKeyName,
    setNewKeyValue,
    setShowTagSuggestions,
    handleChange,
    handleThemeToggle,
    handleImageChange,
    handleImageRemove,
    handleAddTag,
    handleRemoveTag,
    handleAddCustomKey,
    handleRemoveCustomKey,
    handleLocationLookup,
    isLookingUp,
    geocodeResults,
    applyGeocodeResult,
    clearGeocodeResults,
    handleSubmit,
    goToStep
  };
}
