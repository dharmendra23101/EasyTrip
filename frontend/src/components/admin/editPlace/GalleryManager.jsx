import { FiPlus, FiX } from 'react-icons/fi';

export const GalleryManager = ({ gallery: g }) => {
  const {
    gallery,
    galleryLoading,
    galleryError,
    galleryCaption,
    uploadingImage,
    deletingImageId,
    setGalleryCaption,
    handleAddGalleryImage,
    handleDeleteGalleryImage
  } = g;

  return (
    <div className="mb-8">
      <h2 className="text-xl font-semibold text-gray-800 mb-1">Gallery</h2>
      <p className="text-sm text-gray-500 mb-4">
        Additional photos shown in the lightbox on the place page. Changes here save immediately —
        they are not part of the form below.
      </p>

      {galleryError && (
        <p role="alert" className="mb-3 text-sm text-red-600">
          {galleryError}
        </p>
      )}

      {galleryLoading ? (
        <p className="text-sm text-gray-500">Loading gallery…</p>
      ) : gallery.length === 0 ? (
        <p className="text-sm text-gray-500 mb-4">No gallery images yet.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
          {gallery.map((image) => (
            <div
              key={image.id}
              className="relative group border border-gray-200 rounded-lg overflow-hidden"
            >
              <img
                src={image.image_url}
                alt={image.caption || 'Gallery image'}
                className="w-full h-28 object-cover"
              />
              <button
                type="button"
                onClick={() => handleDeleteGalleryImage(image.id)}
                disabled={deletingImageId === image.id}
                aria-label={`Remove gallery image${image.caption ? `: ${image.caption}` : ''}`}
                className="absolute top-1 right-1 bg-white/90 text-red-600 hover:text-red-800 rounded-full p-1 disabled:opacity-50"
              >
                <FiX className="w-4 h-4" />
              </button>
              {image.caption && (
                <p className="px-2 py-1 text-xs text-gray-600 truncate">{image.caption}</p>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={galleryCaption}
          onChange={(e) => setGalleryCaption(e.target.value)}
          maxLength={255}
          placeholder="Caption (optional)"
          aria-label="Caption for the next gallery image"
          className="flex-1 border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500"
        />
        <label className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-primary-600 hover:bg-primary-700 cursor-pointer disabled:opacity-50">
          <FiPlus className="mr-1" />
          {uploadingImage ? 'Uploading…' : 'Add image'}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={uploadingImage}
            onChange={handleAddGalleryImage}
          />
        </label>
      </div>
    </div>
  );
};
