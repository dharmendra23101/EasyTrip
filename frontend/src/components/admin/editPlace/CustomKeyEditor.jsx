import { FiMinus, FiPlus } from 'react-icons/fi';

export const CustomKeyEditor = ({ form }) => {
  const {
    formData,
    newKeyName,
    newKeyValue,
    setNewKeyName,
    setNewKeyValue,
    handleAddCustomKey,
    handleRemoveCustomKey
  } = form;

  return (
    <div className="mb-8">
      <h2 className="text-xl font-semibold text-gray-800 mb-4">Additional Details</h2>

      <div className="space-y-3 mb-4">
        {Object.entries(formData.custom_keys).map(([key, value], index) => (
          <div key={index} className="flex items-center bg-gray-50 p-3 rounded-md">
            <div className="flex-1">
              <div className="font-medium">{key}</div>
              <div className="text-gray-600">{value}</div>
            </div>
            <button
              type="button"
              onClick={() => handleRemoveCustomKey(key)}
              className="text-red-500 hover:text-red-700"
            >
              <FiMinus className="w-5 h-5" />
            </button>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <input
          type="text"
          value={newKeyName}
          onChange={(e) => setNewKeyName(e.target.value)}
          className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500"
          placeholder="Key (e.g., Best Time to Visit)"
        />
        <input
          type="text"
          value={newKeyValue}
          onChange={(e) => setNewKeyValue(e.target.value)}
          className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500"
          placeholder="Value (e.g., October to March)"
        />
      </div>
      <button
        type="button"
        onClick={handleAddCustomKey}
        className="mt-3 inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md shadow-sm text-gray-700 bg-white hover:bg-gray-50"
      >
        <FiPlus className="mr-1" />
        Add Detail
      </button>
    </div>
  );
};
