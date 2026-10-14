import { FiPlus, FiX } from 'react-icons/fi';

export const TagEditor = ({ form }) => {
  const { formData, newTag, setNewTag, handleAddTag, handleRemoveTag } = form;

  return (
    <div className="mb-8">
      <h2 className="text-xl font-semibold text-gray-800 mb-4">Tags</h2>

      <div className="flex flex-wrap gap-2 mb-3">
        {formData.tags.map((tag, index) => (
          <div
            key={index}
            className="flex items-center bg-primary-50 text-primary-700 px-3 py-1 rounded-full"
          >
            <span>{tag}</span>
            <button
              type="button"
              onClick={() => handleRemoveTag(tag)}
              className="ml-2 text-primary-500 hover:text-primary-700"
            >
              <FiX className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex">
        <input
          type="text"
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          className="block w-full border-gray-300 rounded-l-md shadow-sm focus:ring-primary-500 focus:border-primary-500"
          placeholder="Add a tag (e.g., beach, mountain, temple)"
          onKeyPress={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAddTag();
            }
          }}
        />
        <button
          type="button"
          onClick={handleAddTag}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-r-md shadow-sm text-white bg-primary-600 hover:bg-primary-700"
        >
          <FiPlus className="mr-1" />
          Add
        </button>
      </div>
    </div>
  );
};
