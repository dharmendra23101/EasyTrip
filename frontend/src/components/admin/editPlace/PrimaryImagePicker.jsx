import ImageUpload from '../../ImageUpload';

export const PrimaryImagePicker = ({ form }) => {
  const { currentImageUrl, handleImageChange } = form;

  return (
    <div className="mb-8">
      <h2 className="text-xl font-semibold text-gray-800 mb-4">Place Image</h2>
      <ImageUpload
        onImageSelect={handleImageChange}
        currentImage={currentImageUrl}
        maxSize={5 * 1024 * 1024} // 5MB
        multiple={false}
        preview={true}
      />
    </div>
  );
};
