import { useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { FiArrowRight } from 'react-icons/fi';
import { subscribeToNewsletter } from '../services/newsletterService';
import { useTranslation } from '../i18n';

const Footer = () => {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [subscribed, setSubscribed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // This form used to set `subscribed` and drop the address on the floor (IMP-023). It now posts
  // to a real endpoint, and the confirmation only appears once the server has stored the address.
  const handleSubscribe = async (e) => {
    e.preventDefault();
    if (!email || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      await subscribeToNewsletter(email, 'footer');
      setSubscribed(true);
      setEmail('');
      // The form returns after a few seconds so the same visitor can subscribe another address.
      setTimeout(() => setSubscribed(false), 5000);
    } catch (err) {
      setError(err?.message || 'Could not complete your subscription. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Social icons used to be five `href="#"` placeholders. EasyTrip has no social accounts, so the
  // whole row is gone rather than linking nowhere (IMP-025). Restore it when accounts exist.

  // Labels are keys, resolved at render. The destinations below are deliberately NOT keyed:
  // they carry `?location=Agra`, which matches an English value in the database, so a translated
  // label would sit on a link that searches for something else (IMP-114).
  const quickLinks = [
    { key: 'footer.home', href: '/' },
    { key: 'footer.destinations', href: '/browse' },
    { key: 'footer.aboutUs', href: '/about' }
  ];

  // These were `href="#"`. Browse reads a `location` query param, so they now run a real search
  // instead of doing nothing.
  const popularDestinations = [
    { name: 'Agra', href: '/browse?location=Agra' },
    { name: 'Jaipur', href: '/browse?location=Jaipur' },
    { name: 'Goa', href: '/browse?location=Goa' },
    { name: 'Mumbai', href: '/browse?location=Mumbai' },
    { name: 'Delhi', href: '/browse?location=Delhi' }
  ];

  return (
    <footer className="relative bg-gray-900 text-white overflow-hidden">
      {/* Decorative Elements */}
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary-500 via-yellow-400 to-primary-600"></div>

      <div className="absolute top-20 right-20 w-72 h-72 bg-primary-600 rounded-full opacity-10 blur-3xl"></div>
      <div className="absolute -bottom-20 -left-20 w-80 h-80 bg-blue-600 rounded-full opacity-10 blur-3xl"></div>

      {/* Footer Content */}
      <div className="max-w-7xl mx-auto py-16 px-4 sm:px-6 lg:px-8 relative z-10">
        {/* Footer Top */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-12">
          {/* Company Info */}
          <div className="lg:col-span-2">
            <div className="flex items-center mb-6">
              <div className="bg-white rounded-lg p-2 mr-3">
                <img src="/images/logo.png" alt="EasyTrip Logo" className="h-8 w-auto" />
              </div>
              <h2 className="text-2xl font-bold text-white">EasyTrip</h2>
            </div>
            <p className="text-gray-300 mb-6 max-w-md">
              Discover destinations across India with EasyTrip — curated places to visit, with real
              traveller ratings and detailed information.
            </p>
          </div>

          {/* Quick Links */}
          <div className="lg:col-span-1">
            <h3 className="text-lg font-semibold mb-6 border-b border-gray-700 pb-2">
              {t('footer.quickLinks')}
            </h3>
            <ul className="space-y-3">
              {quickLinks.map((link, index) => (
                <motion.li key={index} whileHover={{ x: 5 }}>
                  <Link
                    href={link.href}
                    className="text-gray-300 hover:text-primary-400 transition-colors flex items-center"
                  >
                    <span className="text-xs mr-2">›</span>
                    {t(link.key)}
                  </Link>
                </motion.li>
              ))}
            </ul>
          </div>

          {/* Popular Destinations */}
          <div className="lg:col-span-1">
            <h3 className="text-lg font-semibold mb-6 border-b border-gray-700 pb-2">
              {t('footer.popularDestinations')}
            </h3>
            <ul className="space-y-3">
              {popularDestinations.map((destination, index) => (
                <motion.li key={index} whileHover={{ x: 5 }}>
                  <Link
                    href={destination.href}
                    className="text-gray-300 hover:text-primary-400 transition-colors flex items-center"
                  >
                    <span className="text-xs mr-2">›</span>
                    {destination.name}
                  </Link>
                </motion.li>
              ))}
            </ul>
          </div>

          {/* Newsletter */}
          <div className="lg:col-span-1">
            <h3 className="text-lg font-semibold mb-6 border-b border-gray-700 pb-2">Newsletter</h3>
            <p className="text-gray-300 mb-4 text-sm">
              Subscribe to our newsletter for the latest updates and travel inspiration.
            </p>

            {subscribed ? (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-green-900/30 border border-green-700 rounded-lg p-3 text-green-400 text-sm"
              >
                Thanks for subscribing!
              </motion.div>
            ) : (
              <form onSubmit={handleSubscribe} className="space-y-3">
                <div className="flex">
                  <input
                    type="email"
                    placeholder="Your email"
                    aria-label="Email address for newsletter"
                    className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-l-lg text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:opacity-60"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={submitting}
                    required
                  />
                  <motion.button
                    type="submit"
                    disabled={submitting}
                    aria-label="Subscribe to newsletter"
                    className="px-3 py-2 bg-primary-600 text-white rounded-r-lg disabled:opacity-60"
                    whileHover={{ backgroundColor: '#0284C7' }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <FiArrowRight />
                  </motion.button>
                </div>
                {error && (
                  <p role="alert" className="text-red-400 text-sm">
                    {error}
                  </p>
                )}
              </form>
            )}
          </div>
        </div>

        {/* Footer Bottom */}
        <div className="mt-12 pt-8 border-t border-gray-800">
          <div className="flex flex-col md:flex-row justify-between items-center">
            {/* Privacy / Terms / Cookie links lived here and all three 404'd. They are removed
                rather than written, because a fabricated privacy policy is a worse problem than a
                missing one — and this same sprint is deleting invented content elsewhere (IMP-027).
                They return when there are real documents to link to. */}
            <p className="text-gray-400 text-sm">
              &copy; {new Date().getFullYear()} EasyTrip. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
