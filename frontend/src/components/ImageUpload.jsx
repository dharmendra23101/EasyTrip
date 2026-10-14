import { useState, useRef, useCallback, useEffect } from 'react';
import { FiUpload, FiX, FiAlertCircle, FiCheck } from 'react-icons/fi';
import { motion, AnimatePresence } from 'framer-motion';

const ACCEPTED_FILE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export default function ImageUpload({
  onImageSelect,
  onImageChange, // For backward compatibility
  currentImage, // Optional URL of current image
  maxSize = MAX_FILE_SIZE,
  acceptedTypes = ACCEPTED_FILE_TYPES,
  multiple = false,
  className = '',
  preview = true,
  disabled = false
}) {
  const [dragActive, setDragActive] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [selectedImages, setSelectedImages] = useState([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  // For backward compatibility, use onImageChange if onImageSelect is not provided
  const handleImageSelection = useCallback(
    (files) => {
      if (typeof onImageSelect === 'function') {
        onImageSelect(files);
      } else if (typeof onImageChange === 'function') {
        onImageChange(files);
      } else {
        console.warn('ImageUpload: Neither onImageSelect nor onImageChange prop was provided');
      }
    },
    [onImageSelect, onImageChange]
  );

  // Validate file type and size
  const validateFile = useCallback(
    (file) => {
      if (!acceptedTypes.includes(file.type)) {
        return `Invalid file type. Please upload ${acceptedTypes.map((type) => type.split('/')[1].toUpperCase()).join(', ')} files only.`;
      }

      if (file.size > maxSize) {
        return `File size too large. Maximum size is ${(maxSize / (1024 * 1024)).toFixed(1)}MB.`;
      }

      return null;
    },
    [acceptedTypes, maxSize]
  );

  // Handle file selection
  const handleFiles = useCallback(
    (files) => {
      const fileArray = Array.from(files);
      const validFiles = [];
      let hasError = false;

      for (const file of fileArray) {
        const error = validateFile(file);
        if (error) {
          setUploadError(error);
          hasError = true;
          break;
        }
        validFiles.push(file);
      }

      if (!hasError && validFiles.length > 0) {
        setUploadError('');
        setUploading(true);

        // Create preview URLs
        const imagePromises = validFiles.map((file) => {
          return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
              resolve({
                file,
                preview: e.target.result,
                name: file.name,
                size: file.size
              });
            };
            reader.readAsDataURL(file);
          });
        });

        Promise.all(imagePromises).then((images) => {
          if (multiple) {
            setSelectedImages((prev) => [...prev, ...images]);
            handleImageSelection([...selectedImages.map((img) => img.file), ...validFiles]);
          } else {
            setSelectedImages(images);
            handleImageSelection(validFiles[0]);
          }
          setUploading(false);
        });
      }
    },
    [validateFile, multiple, handleImageSelection, selectedImages]
  );

  // Handle drag events
  const handleDrag = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  // Handle drop
  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      if (disabled) return;

      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleFiles(e.dataTransfer.files);
      }
    },
    [handleFiles, disabled]
  );

  // Handle input change
  const handleChange = useCallback(
    (e) => {
      e.preventDefault();
      if (disabled) return;

      if (e.target.files && e.target.files[0]) {
        handleFiles(e.target.files);
      }
    },
    [handleFiles, disabled]
  );

  // Remove selected image
  const removeImage = useCallback(
    (index) => {
      const newImages = selectedImages.filter((_, i) => i !== index);
      setSelectedImages(newImages);

      if (multiple) {
        handleImageSelection(newImages.map((img) => img.file));
      } else {
        handleImageSelection(null);
      }
    },
    [selectedImages, multiple, handleImageSelection]
  );

  // Clear all images
  const clearAll = useCallback(() => {
    setSelectedImages([]);
    setUploadError('');
    handleImageSelection(multiple ? [] : null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [multiple, handleImageSelection]);

  // Initialize with current image if provided
  useEffect(() => {
    if (currentImage && selectedImages.length === 0) {
      setSelectedImages([
        {
          preview: currentImage,
          name: 'Current Image',
          size: 0,
          file: null
        }
      ]);
    }
  }, [currentImage, selectedImages.length]);

  return (
    <div className={`w-full ${className}`}>
      {/* Upload Area */}
      <div
        className={`relative border-2 border-dashed rounded-xl transition-all duration-200 ${
          dragActive
            ? 'border-blue-500 bg-blue-50'
            : uploadError
              ? 'border-red-300 bg-red-50'
              : selectedImages.length > 0
                ? 'border-green-300 bg-green-50'
                : 'border-gray-300 hover:border-gray-400'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => !disabled && fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple={multiple}
          accept={acceptedTypes.join(',')}
          onChange={handleChange}
          className="hidden"
          disabled={disabled}
        />

        <div className="p-6 text-center">
          {uploading ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center"
            >
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-3"></div>
              <p className="text-blue-600 font-medium">Processing images...</p>
            </motion.div>
          ) : selectedImages.length > 0 && !multiple ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center"
            >
              <FiCheck className="w-12 h-12 text-green-500 mb-3" />
              <p className="text-green-600 font-medium">Image uploaded successfully!</p>
              <p className="text-sm text-gray-500 mt-1">Click to change or drag a new image</p>
            </motion.div>
          ) : (
            <div className="flex flex-col items-center">
              <FiUpload
                className={`w-12 h-12 mb-4 ${dragActive ? 'text-blue-500' : 'text-gray-500'}`}
              />
              <div className="text-lg font-medium text-gray-700 mb-2">
                {dragActive ? 'Drop your images here' : 'Upload images'}
              </div>
              <div className="text-sm text-gray-500 mb-2">
                Drag and drop {multiple ? 'images' : 'an image'} here, or click to select
              </div>
              <div className="text-xs text-gray-500">
                {acceptedTypes.map((type) => type.split('/')[1].toUpperCase()).join(', ')} • Max{' '}
                {(maxSize / (1024 * 1024)).toFixed(1)}MB
                {multiple && ' each'}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Error Message */}
      <AnimatePresence>
        {uploadError && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center"
          >
            <FiAlertCircle className="w-5 h-5 text-red-500 mr-2 flex-shrink-0" />
            <span className="text-sm text-red-700">{uploadError}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Image Previews */}
      {preview && selectedImages.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mt-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-gray-700">
              Selected {multiple ? 'Images' : 'Image'} ({selectedImages.length})
            </h4>
            {multiple && selectedImages.length > 1 && (
              <button
                onClick={clearAll}
                className="text-xs text-red-600 hover:text-red-800 transition-colors"
              >
                Clear All
              </button>
            )}
          </div>

          <div
            className={`grid gap-3 ${
              multiple ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4' : 'grid-cols-1 max-w-xs'
            }`}
          >
            {selectedImages.map((image, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="relative group bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm"
              >
                <div className="aspect-square">
                  <img
                    src={image.preview}
                    alt={image.name}
                    className="w-full h-full object-cover"
                  />
                </div>

                {/* Image Info Overlay */}
                <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-40 transition-all duration-200 flex items-center justify-center">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeImage(index);
                    }}
                    className="opacity-0 group-hover:opacity-100 bg-red-500 text-white rounded-full p-2 transition-opacity hover:bg-red-600"
                  >
                    <FiX className="w-4 h-4" />
                  </button>
                </div>

                {/* File Info */}
                <div className="p-2 bg-gray-50">
                  <p className="text-xs text-gray-600 truncate" title={image.name}>
                    {image.name}
                  </p>
                  <p className="text-xs text-gray-500">{(image.size / 1024).toFixed(1)} KB</p>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Usage Instructions */}
      {selectedImages.length === 0 && !uploadError && (
        <div className="mt-3 text-xs text-gray-500 space-y-1">
          <p>
            • Supported formats:{' '}
            {acceptedTypes.map((type) => type.split('/')[1].toUpperCase()).join(', ')}
          </p>
          <p>
            • Maximum file size: {(maxSize / (1024 * 1024)).toFixed(1)}MB
            {multiple ? ' per image' : ''}
          </p>
          {multiple && <p>• You can upload multiple images at once</p>}
        </div>
      )}
    </div>
  );
}
