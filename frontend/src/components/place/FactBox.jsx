import { FiInfo } from 'react-icons/fi';

// Fact Box component
export const FactBox = ({ title, facts }) => {
  return (
    <div className="my-8 bg-gray-50 border border-gray-200 rounded-2xl overflow-hidden">
      <div className="bg-gradient-to-r from-gray-800 to-gray-900 text-white py-3 px-6">
        <h3 className="font-medium flex items-center">
          <FiInfo className="mr-2" />
          {title || 'Quick Facts'}
        </h3>
      </div>
      <div className="p-5">
        <ul className="space-y-3">
          {facts.map((fact, index) => (
            <li key={index} className="flex">
              <span className="font-serif font-bold text-2xl text-primary-500 mr-3">•</span>
              <span className="text-gray-700">{fact}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
