import { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-toastify';
import { getPlaceImages, addPlaceImage, deletePlaceImage } from '../services/placeService';

/**
 * The place's gallery, for the admin edit form (IMP-014, extracted in IMP-070/126).
 *
 * Kept apart from the edit form's own state on purpose: these operations hit the server
 * immediately rather than travelling with the form submit, so a failed upload must not block
 * saving the rest of the place, and a successful one must not need a save to persist.
 *
 * @param {String|undefined} placeId
 * @param {Function} getIdToken
 */
export function usePlaceGallery(placeId, getIdToken) {
  const [gallery, setGallery] = useState([]);
  const [galleryLoading, setGalleryLoading] = useState(true);
  const [galleryError, setGalleryError] = useState(null);
  const [galleryCaption, setGalleryCaption] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [deletingImageId, setDeletingImageId] = useState(null);

  const refreshGallery = useCallback(async () => {
    if (!placeId) return;
    setGalleryLoading(true);
    try {
      const images = await getPlaceImages(placeId);
      setGallery(images || []);
      setGalleryError(null);
    } catch {
      // Non-fatal: the rest of the edit form still works without the gallery list.
      setGalleryError('Could not load the gallery.');
    } finally {
      setGalleryLoading(false);
    }
  }, [placeId]);

  useEffect(() => {
    refreshGallery();
  }, [refreshGallery]);

  const handleAddGalleryImage = async (e) => {
    const file = e.target.files?.[0];
    // Reset the input immediately so re-selecting the same file still fires a change event.
    e.target.value = '';
    if (!file) return;

    setUploadingImage(true);
    setGalleryError(null);

    try {
      const token = await getIdToken();
      const created = await addPlaceImage(placeId, file, galleryCaption.trim() || undefined, token);
      // Append the server's row rather than refetching: it already carries the assigned
      // display_order and id, so a round-trip would tell us nothing new.
      setGallery((current) => [...current, created]);
      setGalleryCaption('');
      toast.success('Gallery image added');
    } catch (err) {
      setGalleryError(err?.message || 'Could not add the image.');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleDeleteGalleryImage = async (imageId) => {
    if (!window.confirm('Remove this image from the gallery? This also deletes the stored file.')) {
      return;
    }

    setDeletingImageId(imageId);
    setGalleryError(null);

    try {
      const token = await getIdToken();
      await deletePlaceImage(placeId, imageId, token);
      setGallery((current) => current.filter((image) => image.id !== imageId));
      toast.success('Gallery image removed');
    } catch (err) {
      setGalleryError(err?.message || 'Could not remove the image.');
    } finally {
      setDeletingImageId(null);
    }
  };

  return {
    gallery,
    galleryLoading,
    galleryError,
    galleryCaption,
    uploadingImage,
    deletingImageId,
    setGalleryCaption,
    refreshGallery,
    handleAddGalleryImage,
    handleDeleteGalleryImage
  };
}
