import { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import apiClient from '../services/apiClient';
import { toast } from 'react-toastify';
import { FiUser, FiMapPin, FiCalendar, FiSave } from 'react-icons/fi';
import { useAuth } from '../context/AuthContext';
import MyReviews from '../components/profile/MyReviews';
import AccessNeeds from '../components/AccessNeeds';
import TravelPreferences from '../components/TravelPreferences';

export default function Profile() {
  const { currentUser, loading: authLoading, updateProfile, getIdToken } = useAuth();
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [dob, setDob] = useState('');
  // `FV-029` stage (c). One object rather than two booleans: they are submitted together, loaded
  // together, and the profile form sends itself whole — so they behave as one field.
  // `FV-020`. `null` for the scalars rather than `''`, so "not set" is the initial state and stays
  // distinguishable from a chosen value all the way to the API.
  const [preferences, setPreferences] = useState({
    interests: [],
    budget_band: null,
    travel_pace: null,
    party_type: null,
    dietary_needs: []
  });
  const [accessNeeds, setAccessNeeds] = useState({
    requires_step_free: false,
    requires_accessible_restroom: false
  });
  const [loading, setLoading] = useState(false);
  /**
   * Whether `GET /auth/profile` actually answered (`BUG-062`).
   *
   * The two state objects above initialise to "nothing set", and both are submitted as **explicit**
   * values: `[]` and `null` clear a preference, `false` clears an access need. That is deliberate
   * and it is what makes a preference erasable through the form at all.
   *
   * It also means the initial state is indistinguishable from a deliberate wipe. So if the load
   * below fails — a dropped request, an expired token, a 500 — the form renders "nothing set", and
   * the next save of an unrelated field sends that as fact and **destroys the stored profile**.
   *
   * `authController.js` names this exact hazard and defends against a client that *omits* the
   * fields; it cannot defend against one that sends stale defaults. So until the load has
   * succeeded, the payload omits both groups entirely and `COALESCE` leaves the columns alone.
   */
  const [storedProfileLoaded, setStoredProfileLoaded] = useState(false);
  const router = useRouter();

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !currentUser) {
      router.push('/login');
    }
  }, [authLoading, currentUser, router]);

  // Set initial form values.
  // AuthContext supplies `displayName`, never `name`; seeding from `name` alone left the
  // field blank, and PUT /auth/profile now rejects an empty name with a 400.
  useEffect(() => {
    if (currentUser) {
      setName(currentUser.displayName || currentUser.name || '');
      setLocation(currentUser.location || '');
      setDob(currentUser.dob ? new Date(currentUser.dob).toISOString().split('T')[0] : '');
    }
  }, [currentUser]);

  // currentUser is built from the Firebase user object, which knows nothing about location or
  // dob — those live only in our database. Without this the two fields came back blank on every
  // reload even after a successful save, which reads as "it didn't save" (IMP-008). Values
  // already typed are not overwritten, so a slow response cannot clobber the user mid-edit.
  useEffect(() => {
    let cancelled = false;

    const loadStoredProfile = async () => {
      if (!currentUser) return;
      try {
        const token = await getIdToken();
        if (!token) return;
        const { data } = await apiClient.get('/auth/profile', {
          authToken: token,
          requireAuth: true
        });
        if (cancelled || !data) return;
        setLocation((current) => current || data.location || '');
        setDob(
          (current) => current || (data.dob ? new Date(data.dob).toISOString().split('T')[0] : '')
        );
        // Assigned rather than `current ||`-ed like the two above. `false` is a real stored value,
        // and the "keep what the user has already typed" guard those use would make an unchecked
        // box impossible to distinguish from an unloaded one.
        setAccessNeeds({
          requires_step_free: Boolean(data.requires_step_free),
          requires_accessible_restroom: Boolean(data.requires_accessible_restroom)
        });
        // Assigned rather than `current ||`-ed, for the same reason as the block above: an empty
        // list and a cleared preference are real stored values, and a "keep what is there" guard
        // would make them indistinguishable from an unloaded form.
        setPreferences({
          interests: data.interests || [],
          budget_band: data.budget_band ?? null,
          travel_pace: data.travel_pace ?? null,
          party_type: data.party_type ?? null,
          dietary_needs: data.dietary_needs || []
        });
        // Last, and only on the success path: everything above is now a stored value rather than
        // an initial one, so it is safe to submit.
        setStoredProfileLoaded(true);
      } catch (error) {
        // Non-fatal: the form still works, it just starts empty. Failing loudly here would block
        // editing over a transient network error.
        console.error('Could not load stored profile fields:', error);
      }
    };

    loadStoredProfile();
    return () => {
      cancelled = true;
    };
  }, [currentUser, getIdToken]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      setLoading(true);

      // Omitted rather than sent-as-they-are when the load did not land. See `storedProfileLoaded`:
      // these fields clear on an explicit empty value, so sending the un-loaded defaults would
      // erase a stored profile as a side effect of renaming yourself.
      const result = await updateProfile({
        name,
        location,
        dob,
        ...(storedProfileLoaded ? { ...accessNeeds, ...preferences } : {})
      });

      if (result.success) {
        toast.success('Profile updated successfully');
      } else {
        toast.error(result.error || 'Failed to update profile');
      }
    } catch (error) {
      toast.error(error.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  if (authLoading || !currentUser) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-700"></div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>My Profile - EasyTrip</title>
        <meta name="description" content="Manage your EasyTrip profile" />
      </Head>

      <div className="bg-gray-100 min-h-screen pt-24 pb-12">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-white shadow-md rounded-lg overflow-hidden">
            <div className="px-4 py-5 sm:px-6 bg-primary-600">
              <h1 className="text-xl font-semibold text-white">My Profile</h1>
              {/* `primary-50`, not `primary-100`. On `primary-600` (#0277b4) the 100 step measures
                  4.26:1 — under the 4.5:1 AA needs for normal-size text — and 50 measures
                  4.58:1 while keeping the muted-subtitle look. Same reasoning and same
                  precedent as `IMP-084`, which darkened `primary-600` itself for AA; found by
                  the accessibility gate on `/profile` (`PE-022`). */}
              <p className="mt-1 max-w-2xl text-sm text-primary-50">
                Manage your personal information
              </p>
            </div>

            <div className="px-4 py-5 sm:p-6">
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Email (Read-only) */}
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                    Email address
                  </label>
                  <div className="mt-1 relative rounded-md shadow-sm">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <FiUser className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      type="email"
                      id="email"
                      name="email"
                      value={currentUser.email}
                      disabled
                      className="block w-full pl-10 pr-3 py-2 border border-gray-300 bg-gray-50 rounded-md leading-5 text-gray-500 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                    />
                  </div>
                  <p className="mt-1 text-xs text-gray-500">Email cannot be changed</p>
                </div>

                {/* Name */}
                <div>
                  <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                    Full name
                  </label>
                  <div className="mt-1 relative rounded-md shadow-sm">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <FiUser className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      type="text"
                      id="name"
                      name="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      maxLength={100}
                      className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                      placeholder="Your full name"
                    />
                  </div>
                </div>

                {/* Location */}
                <div>
                  <label htmlFor="location" className="block text-sm font-medium text-gray-700">
                    Location
                  </label>
                  <div className="mt-1 relative rounded-md shadow-sm">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <FiMapPin className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      type="text"
                      id="location"
                      name="location"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                      placeholder="Your location (e.g., City, Country)"
                    />
                  </div>
                </div>

                {/* Date of Birth */}
                <div>
                  <label htmlFor="dob" className="block text-sm font-medium text-gray-700">
                    Date of Birth
                  </label>
                  <div className="mt-1 relative rounded-md shadow-sm">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <FiCalendar className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      type="date"
                      id="dob"
                      name="dob"
                      value={dob}
                      onChange={(e) => setDob(e.target.value)}
                      className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                    />
                  </div>
                </div>

                {/*
                  Said out loud rather than left to be inferred (`BUG-062`). When the load fails
                  the two panels below render every field empty, which is a claim — "you have set
                  nothing" — and it may be false. Saving is still allowed and is still safe,
                  because the payload omits these groups until the load lands; what is not safe is
                  letting somebody read an empty form as their stored profile.
                */}
                {!storedProfileLoaded && (
                  <p
                    role="status"
                    className="mt-6 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                  >
                    Your saved preferences and access needs could not be loaded, so the two sections
                    below are showing empty rather than what you have stored. Saving will leave them
                    untouched. Reload the page to edit them.
                  </p>
                )}

                <TravelPreferences
                  values={preferences}
                  onChange={(field, value) =>
                    setPreferences((current) => ({ ...current, [field]: value }))
                  }
                />

                <AccessNeeds
                  values={accessNeeds}
                  onChange={(name, checked) =>
                    setAccessNeeds((current) => ({ ...current, [name]: checked }))
                  }
                />

                {/* Submit Button */}
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={loading}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <span className="flex items-center">
                        <svg
                          className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          ></circle>
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          ></path>
                        </svg>
                        Saving...
                      </span>
                    ) : (
                      <span className="flex items-center">
                        <FiSave className="mr-2 h-4 w-4" />
                        Save Changes
                      </span>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/*
            "Your reviews" (`IMP-117`). The README advertised profiles that let you *manage
            reviews*; until now this page was a three-field form and the claim was not true.

            Deliberately a sibling card rather than a tab: the review history is the reason most
            people would open this page at all, and hiding it behind a tab would leave the form —
            which you edit once — as the whole page.
          */}
          <section aria-labelledby="my-reviews-heading" className="mt-8">
            <div className="bg-white shadow-md rounded-lg overflow-hidden">
              <div className="px-4 py-5 sm:px-6 bg-primary-600">
                <h2 id="my-reviews-heading" className="text-xl font-semibold text-white">
                  Your Reviews
                </h2>
                <p className="mt-1 max-w-2xl text-sm text-primary-50">
                  Everything you have written, most recently updated first
                </p>
              </div>
              <div className="px-4 py-5 sm:p-6">
                <MyReviews />
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
