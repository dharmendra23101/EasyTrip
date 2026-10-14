// frontend/src/utils/cloudinaryHelper.js
export const getCloudinaryThumbnail = (url, width = 400, height = 300) => {
  if (!url || typeof url !== 'string' || !url.includes('cloudinary.com')) {
    return url;
  }

  try {
    // Example URL: https://res.cloudinary.com/yourcloud/image/upload/v1234567890/folder/image.jpg
    const parts = url.split('/upload/');
    if (parts.length !== 2) return url;

    return `${parts[0]}/upload/f_auto,q_auto,c_fill,w_${width},h_${height}/${parts[1]}`;
  } catch (error) {
    console.error('Error generating thumbnail URL:', error);
    return url;
  }
};

export const getCloudinaryLargeImage = (url, width = 1600) => {
  if (!url || typeof url !== 'string' || !url.includes('cloudinary.com')) {
    return url;
  }

  try {
    const parts = url.split('/upload/');
    if (parts.length !== 2) return url;

    return `${parts[0]}/upload/f_auto,q_auto,c_limit,w_${width}/${parts[1]}`;
  } catch (error) {
    console.error('Error generating large image URL:', error);
    return url;
  }
};
