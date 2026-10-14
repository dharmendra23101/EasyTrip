import {
  FiEye,
  FiFeather,
  FiGlobe,
  FiLoader,
  FiMap,
  FiMapPin,
  FiNavigation,
  FiStar,
  FiTag
} from 'react-icons/fi';
import { motion } from 'framer-motion';
import PlaceWeather from './PlaceWeather';

// Magazine-style Sidebar with progressive loading
export const MagazineSidebar = ({ place, reviews = [], isLoading = false }) => (
  <aside className="lg:sticky lg:top-24 space-y-8">
    {/*
      Real weather (`IMP-110`), first in the sidebar because it is the only thing here that changes
      between two visits — and because it is the slot the fabricated widget used to occupy. It
      fetches on the client: the page is ISR-cached, so a build-time forecast would be stale on
      arrival and then served from cache to everyone.
    */}
    {place?.id && <PlaceWeather placeId={place.id} />}

    {/* Editor's Note */}
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
      className="bg-gradient-to-br from-gray-900 to-gray-800 text-white rounded-2xl shadow-xl p-6 border border-gray-700"
    >
      <h3 className="text-xl font-serif font-bold mb-4 flex items-center">
        <div className="p-2 bg-yellow-500/20 rounded-lg mr-3">
          <FiFeather className="text-yellow-500 h-5 w-5" />
        </div>
        Editor&apos;s Note
      </h3>

      <p className="text-gray-300 italic font-serif mb-4 leading-relaxed">
        {place.description
          ? `"${place.description.substring(0, 150)}${place.description.length > 150 ? '...' : ''}"`
          : `"${place.name} represents one of those rare finds that manages to capture the imagination and transport visitors to another world. Our editorial team was particularly impressed with the authentic cultural experiences available here."`}
      </p>

      <div className="flex items-center mt-4 pt-4 border-t border-gray-700/50">
        <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center text-white font-medium mr-3">
          ET
        </div>
        <div>
          <p className="font-medium">Editorial Team</p>
          <p className="text-gray-400 text-sm">EasyTrip Magazine</p>
        </div>
      </div>
    </motion.div>

    {/* Location Details Card */}
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.1 }}
      className="bg-white rounded-2xl shadow-xl p-6 border border-gray-100"
    >
      <h3 className="text-xl font-serif font-bold text-gray-900 mb-5 flex items-center">
        <div className="p-2 bg-primary-100 rounded-lg mr-3">
          <FiMapPin className="text-primary-600 h-5 w-5" />
        </div>
        Location Details
      </h3>

      {isLoading ? (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex justify-between py-2">
              <div className="h-4 bg-gray-200 rounded w-20 animate-pulse" />
              <div className="h-4 bg-gray-200 rounded w-32 animate-pulse" />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {[
            { label: 'Location', value: place.location, icon: FiMapPin },
            { label: 'District', value: place.district, icon: FiMap },
            { label: 'State', value: place.state, icon: FiGlobe },
            { label: 'Locality', value: place.locality, icon: FiNavigation },
            { label: 'PIN Code', value: place.pin_code, icon: FiTag }
          ]
            .filter((item) => item.value)
            .map((item, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
                className="flex items-center justify-between py-2 border-b border-gray-100 last:border-b-0"
              >
                <div className="flex items-center">
                  <item.icon className="h-4 w-4 text-gray-500 mr-2" />
                  <span className="font-medium text-gray-700">{item.label}:</span>
                </div>
                <span className="text-gray-900 font-semibold">{item.value}</span>
              </motion.div>
            ))}
        </div>
      )}

      {/* Ratings Breakdown */}
      {reviews.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="mt-6 pt-6 border-t border-gray-100"
        >
          <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center">
            <FiStar className="mr-2 h-4 w-4 text-yellow-500" />
            Ratings Breakdown
          </h4>

          {/* Was four invented sub-scores (4.7 Overall / 4.2 Value / 3.9 Accessibility / 4.5
              Facilities) with a comment admitting it was a mockup. Those dimensions do not exist in
              the data model — a review carries one 1-5 rating — so they could never be computed.
              This is the distribution that CAN be computed, from the reviews actually loaded. */}
          <div className="space-y-2">
            {[5, 4, 3, 2, 1].map((star) => {
              const count = reviews.filter((review) => review.rating === star).length;
              const share = reviews.length > 0 ? (count / reviews.length) * 100 : 0;
              return (
                <div key={star} className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">
                    {star} star{star === 1 ? '' : 's'}
                  </span>
                  <div className="flex items-center">
                    <div className="w-24 h-2 bg-gray-200 rounded-full mr-2 overflow-hidden">
                      <div
                        className="h-full bg-yellow-500 rounded-full"
                        style={{ width: `${share}%` }}
                      ></div>
                    </div>
                    <span className="text-sm font-medium w-6 text-right">{count}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}
    </motion.div>

    {/* Map Card with Magazine Styling */}
    {place.latitude && place.longitude ? (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.2 }}
        className="bg-white rounded-2xl shadow-xl p-6 border border-gray-100"
      >
        <h3 className="text-xl font-serif font-bold text-gray-900 mb-5 flex items-center">
          <div className="p-2 bg-green-100 rounded-lg mr-3">
            <FiMap className="text-green-600 h-5 w-5" />
          </div>
          On The Map
        </h3>

        <div className="relative rounded-xl overflow-hidden border-2 border-gray-200 mb-4">
          {isLoading ? (
            <div className="w-full h-64 bg-gray-200 animate-pulse flex items-center justify-center">
              <FiLoader className="h-8 w-8 text-gray-400 animate-spin" />
            </div>
          ) : (
            <div className="w-full h-64 bg-gray-100 relative">
              <iframe
                title={`Map of ${place.name}`}
                src={`https://maps.google.com/maps?q=${place.latitude},${place.longitude}&z=15&output=embed`}
                className="w-full h-full border-0"
                allowFullScreen
                loading="lazy"
              />
              {/* Decorative compass */}
              <div className="absolute top-3 right-3 bg-white/80 backdrop-blur-sm rounded-full p-2 shadow">
                <FiNavigation className="h-5 w-5 text-primary-600" />
              </div>
            </div>
          )}
        </div>

        {/* ODbL 4.3 attribution for the geocoding output (IMP-127).
            The embed above is Google's, and it credits Google — for the *map*. The coordinates it
            is centred on are a different piece of data with a different licence: when they came
            from Nominatim, OpenStreetMap is owed a credit here and nowhere else on this page.

            Conditional on purpose. Rendering this for every place would credit OpenStreetMap for
            pins an admin typed by hand, which is a fabricated provenance — the same class of
            untruth IMP-027 removed, arrived at while trying to be scrupulous. `coordinates_source`
            exists so this notice can be exactly as broad as the obligation. */}
        {place.coordinates_source === 'nominatim' && (
          <p className="mb-4 text-xs text-gray-500">
            Coordinates ©{' '}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-gray-700"
            >
              OpenStreetMap
            </a>{' '}
            contributors, ODbL.
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <motion.a
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            href={`https://www.google.com/maps/search/?api=1&query=${place.latitude},${place.longitude}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center bg-primary-600 text-white px-4 py-3 rounded-lg text-sm font-semibold hover:bg-primary-700 transition-colors"
          >
            <FiNavigation className="mr-2 h-4 w-4" />
            Directions
          </motion.a>
          <motion.a
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            href={`https://www.google.com/maps/@${place.latitude},${place.longitude},15z`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center bg-gray-100 text-gray-700 px-4 py-3 rounded-lg text-sm font-semibold hover:bg-gray-200 transition-colors"
          >
            <FiEye className="mr-2 h-4 w-4" />
            Explore Area
          </motion.a>
        </div>
      </motion.div>
    ) : null}
  </aside>
);
