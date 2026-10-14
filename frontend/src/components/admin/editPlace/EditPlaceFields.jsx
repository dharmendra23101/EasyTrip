import { SettingSelector } from '../SettingSelector';
import { AccessibilitySurvey } from '../AccessibilitySurvey';

export const EditPlaceFields = ({ form }) => {
  const { formData, handleChange } = form;

  return (
    <div className="mb-8">
      <h2 className="text-xl font-semibold text-gray-800 mb-4">Basic Information</h2>

      <div className="grid grid-cols-1 gap-6">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
            Place Name *
          </label>
          <input
            type="text"
            id="name"
            name="name"
            value={formData.name}
            onChange={handleChange}
            className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500"
            required
          />
        </div>

        <div>
          <label htmlFor="location" className="block text-sm font-medium text-gray-700 mb-1">
            Location *
          </label>
          <input
            type="text"
            id="location"
            name="location"
            value={formData.location}
            onChange={handleChange}
            className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500"
            required
          />
        </div>

        <div>
          <label htmlFor="district" className="block text-sm font-medium text-gray-700 mb-1">
            District
          </label>
          <input
            type="text"
            id="district"
            name="district"
            value={formData.district}
            onChange={handleChange}
            className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500"
          />
        </div>

        <div>
          <label htmlFor="state" className="block text-sm font-medium text-gray-700 mb-1">
            State
          </label>
          <input
            type="text"
            id="state"
            name="state"
            value={formData.state}
            onChange={handleChange}
            className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500"
          />
        </div>

        <div>
          <label htmlFor="locality" className="block text-sm font-medium text-gray-700 mb-1">
            Locality
          </label>
          <input
            type="text"
            id="locality"
            name="locality"
            value={formData.locality}
            onChange={handleChange}
            className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500"
          />
        </div>

        <div>
          <label htmlFor="pin_code" className="block text-sm font-medium text-gray-700 mb-1">
            PIN Code
          </label>
          <input
            type="text"
            id="pin_code"
            name="pin_code"
            value={formData.pin_code}
            onChange={handleChange}
            className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500"
          />
        </div>

        <div>
          <label htmlFor="latitude" className="block text-sm font-medium text-gray-700 mb-1">
            Latitude
          </label>
          <input
            type="number"
            id="latitude"
            name="latitude"
            value={formData.latitude}
            onChange={handleChange}
            className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500"
            step="any"
          />
        </div>

        <div>
          <label htmlFor="longitude" className="block text-sm font-medium text-gray-700 mb-1">
            Longitude
          </label>
          <input
            type="number"
            id="longitude"
            name="longitude"
            value={formData.longitude}
            onChange={handleChange}
            className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500"
            step="any"
          />
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
            Description
          </label>
          <textarea
            id="description"
            name="description"
            value={formData.description}
            onChange={handleChange}
            rows="4"
            className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500"
          ></textarea>
        </div>
      </div>

      {/* TD-023 — the reason `places.setting` stopped being a column nothing could write to. */}
      <div className="mt-8">
        <SettingSelector value={formData.setting} onChange={handleChange} />

        {/* Below the classification, because both are about what a place *is* rather than what it
            is called — and this one is the longer conversation. */}
        <AccessibilitySurvey formData={formData} onChange={handleChange} />
      </div>
    </div>
  );
};
