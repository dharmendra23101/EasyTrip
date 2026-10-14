import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../i18n';
import LocaleSwitcher from './LocaleSwitcher';
import { useDismissable } from '../hooks/useDismissable';
import {
  FiMenu,
  FiX,
  FiUser,
  FiLogOut,
  FiHome,
  FiLogIn,
  FiUserPlus,
  FiSettings,
  FiChevronDown,
  FiCompass,
  FiHeart,
  FiMap
} from 'react-icons/fi';

const Navbar = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  // The dropdown previously closed only by re-clicking the avatar or navigating away — clicking
  // elsewhere or pressing Escape left it open over the page (IMP-077).
  const profileRef = useDismissable(isProfileOpen, () => setIsProfileOpen(false));
  const [scrolled, setScrolled] = useState(false);
  const { currentUser: authUser, isAdmin, logout } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();

  // Only these three render a dark hero image underneath the navbar. Everywhere else the page
  // starts on a light background, so the navbar must be solid from the top — otherwise the scrim
  // below draws a dark band over nothing and the white nav text becomes unreadable (IMP-033).
  const hasDarkHero = ['/', '/browse', '/places/[id]'].includes(router.pathname);
  // `solid` is what every style below should branch on. `scrolled` alone was the bug: it conflated
  // "the user has scrolled" with "there is something dark behind me".
  const solid = scrolled || !hasDarkHero;

  // A signed-in user can still be missing displayName and/or email, so every
  // read has to tolerate it rather than dereferencing straight through.
  const displayName =
    authUser?.displayName || authUser?.name || authUser?.email?.split('@')[0] || 'Account';
  const displayEmail = authUser?.email || displayName;
  const avatarInitial = displayName.charAt(0).toUpperCase();

  // Close menu when route changes
  useEffect(() => {
    setIsOpen(false);
    setIsProfileOpen(false);
  }, [router.pathname]);

  // Change navbar style on scroll
  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 10) {
        setScrolled(true);
      } else {
        setScrolled(false);
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const handleLogout = async () => {
    await logout();
    router.push('/');
  };

  const menuVariants = {
    hidden: {
      opacity: 0,
      y: -20,
      transition: {
        duration: 0.2
      }
    },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.3,
        staggerChildren: 0.05
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: -10 },
    visible: { opacity: 1, y: 0 }
  };

  return (
    <motion.nav
      className={`fixed w-full top-0 z-50 transition-all duration-300 ${
        solid ? 'bg-white shadow-md py-2' : 'bg-transparent py-4'
      }`}
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center">
          {/* Logo */}
          <Link href="/" className="flex-shrink-0 flex items-center">
            <div className="relative h-10 w-10 mr-2">
              <Image
                src="/images/logo.png"
                alt="EasyTrip Logo"
                width={40}
                height={40}
                className="rounded-md"
              />
            </div>
            <motion.span
              className={`text-2xl font-bold ${solid ? 'text-primary-600' : 'text-white'}`}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2, duration: 0.5 }}
            >
              EasyTrip
            </motion.span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden sm:ml-6 sm:flex sm:items-center sm:space-x-8">
            <Link
              href="/"
              className={`px-3 py-2 text-sm font-medium ${
                router.pathname === '/'
                  ? 'text-primary-600 border-b-2 border-primary-600'
                  : solid
                    ? 'text-gray-700 hover:text-primary-600'
                    : 'text-white hover:text-primary-200'
              } transition-colors`}
            >
              <span className="flex items-center">
                <FiHome className="mr-2" />
                {t('nav.home')}
              </span>
            </Link>
            <Link
              href="/browse"
              className={`px-3 py-2 text-sm font-medium ${
                router.pathname === '/browse'
                  ? 'text-primary-600 border-b-2 border-primary-600'
                  : solid
                    ? 'text-gray-700 hover:text-primary-600'
                    : 'text-white hover:text-primary-200'
              } transition-colors`}
            >
              <span className="flex items-center">
                <FiCompass className="mr-2" />
                {t('nav.browse')}
              </span>
            </Link>

            {authUser ? (
              <div className="relative ml-3" ref={profileRef}>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setIsProfileOpen(!isProfileOpen)}
                  aria-haspopup="menu"
                  aria-expanded={isProfileOpen}
                  aria-label="Account menu"
                  className={`flex items-center space-x-2 ${
                    solid ? 'bg-gray-100 text-gray-800' : 'bg-white/20 text-white'
                  } backdrop-blur-sm px-4 py-2 rounded-full focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-colors`}
                >
                  {authUser.photoURL ? (
                    <img src={authUser.photoURL} alt="Profile" className="w-7 h-7 rounded-full" />
                  ) : (
                    <div className="relative w-7 h-7 rounded-full bg-primary-600 flex items-center justify-center text-white text-sm font-bold">
                      {avatarInitial}
                    </div>
                  )}
                  <span className="text-sm font-medium truncate max-w-[100px]">{displayName}</span>
                  <FiChevronDown
                    className={`h-4 w-4 ${isProfileOpen ? 'rotate-180' : 'rotate-0'} transition-transform duration-200`}
                  />
                </motion.button>

                <AnimatePresence>
                  {isProfileOpen && (
                    <motion.div
                      role="menu"
                      aria-label="Account"
                      className="absolute right-0 mt-2 w-60 rounded-xl shadow-lg py-1 bg-white ring-1 ring-black ring-opacity-5 z-10 overflow-hidden"
                      variants={menuVariants}
                      initial="hidden"
                      animate="visible"
                      exit="hidden"
                    >
                      <div className="px-4 py-3 border-b border-gray-100">
                        <p className="text-sm text-gray-500">{t('nav.signedInAs')}</p>
                        <p className="text-sm font-medium text-gray-900 truncate">{displayEmail}</p>
                      </div>
                      <div className="py-1">
                        <motion.div variants={itemVariants}>
                          <Link
                            href="/profile"
                            className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                          >
                            <FiUser className="mr-3 h-4 w-4 text-gray-500" />
                            {t('nav.profile')}
                          </Link>
                        </motion.div>

                        {/*
                          The only entry point to the wishlist (IMP-108). Without it the hearts
                          write to a list with no door — which is how a saved-places feature ends up
                          looking decorative.
                        */}
                        <motion.div variants={itemVariants}>
                          <Link
                            href="/saved"
                            className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                          >
                            <FiHeart className="mr-3 h-4 w-4 text-gray-500" />
                            {t('nav.saved')}
                          </Link>
                        </motion.div>

                        {/* The trip workspace (IMP-109). Saved places feed it, so it sits next to
                            them — discovery on the left, planning on the right. */}
                        <motion.div variants={itemVariants}>
                          <Link
                            href="/trips"
                            className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                          >
                            <FiMap className="mr-3 h-4 w-4 text-gray-500" />
                            {t('nav.trips')}
                          </Link>
                        </motion.div>

                        {isAdmin && (
                          <motion.div variants={itemVariants}>
                            <Link
                              href="/admin"
                              className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                            >
                              <FiSettings className="mr-3 h-4 w-4 text-gray-500" />
                              {t('nav.admin')}
                            </Link>
                          </motion.div>
                        )}

                        <div className="border-t border-gray-100 my-1"></div>

                        <motion.div variants={itemVariants}>
                          <button
                            onClick={handleLogout}
                            className="flex w-full items-center px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                          >
                            <FiLogOut className="mr-3 h-4 w-4" />
                            {t('nav.signOut')}
                          </button>
                        </motion.div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <div className="flex items-center space-x-2">
                <LocaleSwitcher className={solid ? 'text-gray-700' : 'text-white'} />
                <Link
                  href="/login"
                  className={`px-4 py-2 text-sm font-medium rounded-md ${
                    solid
                      ? 'text-primary-600 border border-primary-600 hover:bg-primary-50'
                      : 'text-white border border-white hover:bg-white/10'
                  } transition-colors`}
                >
                  {t('nav.login')}
                </Link>
                <Link
                  href="/signup"
                  className={`px-4 py-2 text-sm font-medium rounded-md ${
                    solid
                      ? 'bg-primary-600 text-white hover:bg-primary-700'
                      : 'bg-white text-primary-800 hover:bg-primary-50'
                  } shadow-sm transition-colors`}
                >
                  {t('nav.signUp')}
                </Link>
              </div>
            )}
          </div>

          {/* Mobile Navigation Button */}
          <div className="flex items-center sm:hidden">
            <button
              onClick={() => setIsOpen(!isOpen)}
              className={`inline-flex items-center justify-center p-2 rounded-md ${
                solid ? 'text-gray-700 hover:text-primary-600' : 'text-white hover:text-primary-200'
              } hover:bg-opacity-20 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500 transition-colors`}
            >
              <span className="sr-only">{isOpen ? 'Close menu' : 'Open menu'}</span>
              {isOpen ? <FiX className="block h-6 w-6" /> : <FiMenu className="block h-6 w-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Navigation Menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="sm:hidden bg-white shadow-lg absolute top-full left-0 right-0"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="px-2 pt-2 pb-3 space-y-1 divide-y divide-gray-200">
              <div className="py-2">
                <Link
                  href="/"
                  className={`block px-3 py-2 rounded-md text-base font-medium ${
                    router.pathname === '/'
                      ? 'bg-primary-50 text-primary-700'
                      : 'text-gray-700 hover:bg-gray-50 hover:text-primary-600'
                  }`}
                >
                  <div className="flex items-center">
                    <FiHome className="mr-3 h-5 w-5" />
                    {t('nav.home')}
                  </div>
                </Link>

                <Link
                  href="/browse"
                  className={`block px-3 py-2 rounded-md text-base font-medium ${
                    router.pathname === '/browse'
                      ? 'bg-primary-50 text-primary-700'
                      : 'text-gray-700 hover:bg-gray-50 hover:text-primary-600'
                  }`}
                >
                  <div className="flex items-center">
                    <FiCompass className="mr-3 h-5 w-5" />
                    {t('nav.browse')}
                  </div>
                </Link>
              </div>

              <div className="py-2">
                {authUser ? (
                  <>
                    <div className="px-3 py-2 border-b border-gray-200 mb-2">
                      <p className="text-sm text-gray-500">{t('nav.signedInAs')}</p>
                      <p className="text-base font-medium text-gray-900 truncate">{displayEmail}</p>
                    </div>

                    <Link
                      href="/profile"
                      className="block px-3 py-2 rounded-md text-base font-medium text-gray-700 hover:bg-gray-50 hover:text-primary-600"
                    >
                      <div className="flex items-center">
                        <FiUser className="mr-3 h-5 w-5" />
                        {t('nav.profile')}
                      </div>
                    </Link>

                    {isAdmin && (
                      <Link
                        href="/admin"
                        className="block px-3 py-2 rounded-md text-base font-medium text-gray-700 hover:bg-gray-50 hover:text-primary-600"
                      >
                        <div className="flex items-center">
                          <FiSettings className="mr-3 h-5 w-5" />
                          {t('nav.admin')}
                        </div>
                      </Link>
                    )}

                    <button
                      onClick={handleLogout}
                      className="w-full text-left block px-3 py-2 rounded-md text-base font-medium text-red-600 hover:bg-red-50"
                    >
                      <div className="flex items-center">
                        <FiLogOut className="mr-3 h-5 w-5" />
                        {t('nav.signOut')}
                      </div>
                    </button>
                  </>
                ) : (
                  <>
                    <Link
                      href="/login"
                      className="block px-3 py-2 rounded-md text-base font-medium text-gray-700 hover:bg-gray-50 hover:text-primary-600"
                    >
                      <div className="flex items-center">
                        <FiLogIn className="mr-3 h-5 w-5" />
                        {t('nav.login')}
                      </div>
                    </Link>
                    <Link
                      href="/signup"
                      className="block px-3 py-2 rounded-md text-base font-medium text-primary-600 hover:bg-primary-50"
                    >
                      <div className="flex items-center">
                        <FiUserPlus className="mr-3 h-5 w-5" />
                        {t('nav.signUp')}
                      </div>
                    </Link>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Scrim exists to keep white nav text legible over a photographic hero. It must therefore
          render only when the navbar is actually transparent over one. */}
      {!solid && (
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 to-transparent -z-10"></div>
      )}
    </motion.nav>
  );
};

export default Navbar;
