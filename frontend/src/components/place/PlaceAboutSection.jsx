import { FiCalendar, FiEdit3, FiTag } from 'react-icons/fi';
import { motion } from 'framer-motion';
import { FactBox } from './FactBox';
import { buildEditorialExcerpt, buildPlaceFacts } from '../../utils/placeDetail';
import { formatDate } from '../../utils/dateFormat';

/** The article's opening section: the editorial excerpt, the facts box, keywords and bylines. */
export const PlaceAboutSection = ({ place }) => {
  const editorialExcerpt = buildEditorialExcerpt(place);
  const facts = buildPlaceFacts(place);
  const createdDate = formatDate(place.created_at);
  const updatedDate = formatDate(place.updated_at);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
      className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100"
    >
      <h2 className="text-4xl font-serif font-bold text-gray-900 mb-8 leading-tight">
        About {place.name}
      </h2>

      {/* Magazine-style intro paragraph */}
      <p className="text-xl font-serif leading-relaxed text-gray-800 mb-6 first-letter:text-5xl first-letter:font-bold first-letter:mr-1 first-letter:float-left first-letter:leading-tight">
        {editorialExcerpt}
      </p>

      {/* Three paragraphs of templated prose lived here, generated from the
          place's own fields and rendered as editorial copy — including a pull quote
          attributed to an "EasyTrip Editorial Team" that does not exist. Removed in
          Sprint 3.1 (IMP-027): the admin-written description above is the real
          content, and padding it with generated sentences made a short entry look
          researched rather than short. */}

      {/* Quick Facts Box */}
      <FactBox title={`Essential Facts: ${place.name}`} facts={facts} />

      {/* Tags displayed as magazine-style keywords */}
      {place.tags && place.tags.length > 0 && (
        <div className="mt-8 pt-6 border-t border-gray-100">
          <h3 className="text-lg font-serif font-semibold text-gray-800 mb-3 flex items-center">
            <FiTag className="mr-2 h-5 w-5 text-gray-500" />
            Keywords
          </h3>
          <div className="flex flex-wrap gap-2">
            {place.tags.map((tag, index) => (
              <span
                key={index}
                className="bg-gray-100 text-gray-700 text-sm px-3 py-1 rounded-full hover:bg-gray-200 transition-colors cursor-default"
              >
                {tag.charAt(0).toUpperCase() + tag.slice(1)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Editorial Information */}
      <div className="mt-8 pt-6 border-t border-gray-100 text-sm text-gray-500 flex flex-wrap justify-between">
        {createdDate && (
          <p className="flex items-center mr-4 mb-2">
            <FiCalendar className="mr-2 h-4 w-4 text-gray-400" />
            Published: {createdDate}
          </p>
        )}
        {updatedDate && (
          <p className="flex items-center mr-4 mb-2">
            <FiEdit3 className="mr-2 h-4 w-4 text-gray-400" />
            Updated: {updatedDate}
          </p>
        )}
      </div>
    </motion.div>
  );
};
