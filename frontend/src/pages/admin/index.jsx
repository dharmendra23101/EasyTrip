import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useAuth } from '../../context/AuthContext';
import { formatDateTime } from '../../utils/dateFormat';
import { FiPlus, FiList, FiUsers, FiFlag, FiShield, FiBarChart2 } from 'react-icons/fi';
import { adminService } from '../../services/adminService';
import { AdminStats } from '../../components/admin/AdminStats';
import { requireAdminPage } from '../../services/adminGate';

export default function AdminDashboard() {
  const { currentUser, loading, isAdmin, getIdToken } = useAuth();
  const router = useRouter();
  const [loadingPage, setLoadingPage] = useState(true);

  // Real figures (IMP-111, ADR-037). Fetched here rather than in `AdminStats` so the component
  // stays a pure renderer and can be asserted against a fixture without a network.
  const [analytics, setAnalytics] = useState(null);
  const [analyticsError, setAnalyticsError] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);

  useEffect(() => {
    if (loading || !currentUser || !isAdmin) return undefined;

    let cancelled = false;
    (async () => {
      try {
        const token = await getIdToken();
        if (!token) throw new Error('Your session has expired. Please sign in again.');
        const payload = await adminService.getAnalytics(token);
        if (!cancelled) setAnalytics(payload);
      } catch (err) {
        // Surfaced, not swallowed. A dashboard that renders nothing where numbers should be reads
        // as "everything is zero" — a wrong answer rather than a missing one.
        if (!cancelled) setAnalyticsError(err?.message || 'Could not load the figures.');
      } finally {
        if (!cancelled) setAnalyticsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, currentUser, isAdmin, getIdToken]);

  // Check if user is admin
  useEffect(() => {
    if (!loading) {
      if (!currentUser) {
        router.push('/login');
      } else if (!isAdmin) {
        router.push('/');
      } else {
        setLoadingPage(false);
      }
    }
  }, [currentUser, loading, isAdmin, router]);

  if (loading || loadingPage) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="relative w-24 h-24">
          <div className="absolute top-0 left-0 w-full h-full border-4 border-t-primary-600 border-b-primary-300 border-l-primary-600 border-r-primary-300 rounded-full animate-spin"></div>
          <div className="absolute top-2 left-2 w-20 h-20 border-4 border-t-primary-400 border-b-primary-100 border-l-primary-400 border-r-primary-100 rounded-full animate-spin-slow"></div>
        </div>
      </div>
    );
  }

  const adminFeatures = [
    {
      title: 'Add New Place',
      description: 'Create a new destination with details and images',
      icon: <FiPlus className="h-8 w-8" />,
      href: '/admin/addPlace',
      color: 'bg-green-100 text-green-600'
    },
    {
      title: 'Manage Places',
      description: 'Edit or delete existing destination listings',
      icon: <FiList className="h-8 w-8" />,
      href: '/admin/managePlaces',
      color: 'bg-primary-100 text-primary-600'
    },
    {
      title: 'User Management',
      description: 'Grant or revoke admin access',
      icon: <FiUsers className="h-8 w-8" />,
      href: '/admin/users',
      color: 'bg-purple-100 text-purple-600'
    },
    {
      // IMP-111. Without this tile the page is reachable only by typing the URL — which is how
      // `/admin/users` ended up with a working API, a written service and no caller at all until
      // IMP-018 noticed (see that page's header).
      title: 'Review Moderation',
      description: 'Reviews the community has reported',
      icon: <FiFlag className="h-8 w-8" />,
      href: '/admin/moderation',
      color: 'bg-red-100 text-red-600'
    },
    {
      // `PE-013`. Same lesson as the tile above: a page reachable only by typing its URL is a page
      // nobody reads, and an audit log nobody reads is the write amplification `ADR-022` refused to
      // build in the first place.
      title: 'Audit Log',
      description: 'Privilege changes and moderation decisions',
      icon: <FiShield className="h-8 w-8" />,
      href: '/admin/audit',
      color: 'bg-slate-100 text-slate-600'
    },
    {
      // `FV-022`. The tiles below answer "what needs doing"; this page answers "what has been
      // happening" — and it is where the activity series and the rating distribution are read,
      // both of which this page has been fetching and discarding since Sprint 7.11.
      title: 'Analytics',
      description: 'Activity over time and the rating distribution',
      icon: <FiBarChart2 className="h-8 w-8" />,
      href: '/admin/analytics',
      color: 'bg-blue-100 text-blue-600'
    }
    // The "Settings" tile that used to sit here linked to /admin/settings, which has never existed
    // and is not on the roadmap. Removing the tile is one of the two options IMP-025 lists for it;
    // building a settings page nobody has specified would have been the worse one.
  ];

  return (
    <>
      <Head>
        <title>Admin Dashboard | EasyTrip</title>
        <meta name="description" content="EasyTrip Admin Dashboard" />
      </Head>

      <div className="min-h-screen bg-gray-50 pt-20 pb-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h1 className="text-3xl font-extrabold text-gray-900 sm:text-4xl">Admin Dashboard</h1>
            <p className="mt-3 max-w-2xl mx-auto text-xl text-gray-500 sm:mt-4">
              Manage destinations and users
            </p>
          </div>

          <AdminStats analytics={analytics} loading={analyticsLoading} error={analyticsError} />

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {adminFeatures.map((feature, index) => (
              <Link key={index} href={feature.href}>
                <div className="relative group bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-all duration-300 h-full flex flex-col justify-between cursor-pointer">
                  <div>
                    <div className={`inline-flex p-3 rounded-md ${feature.color} mb-4`}>
                      {feature.icon}
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">{feature.title}</h3>
                    <p className="text-sm text-gray-500">{feature.description}</p>
                  </div>
                  <div className="mt-4 text-sm font-medium text-primary-600 group-hover:text-primary-800">
                    Access &rarr;
                  </div>
                </div>
              </Link>
            ))}
          </div>

          <div className="mt-12 bg-white shadow overflow-hidden sm:rounded-lg">
            <div className="px-4 py-5 sm:px-6">
              <h3 className="text-lg leading-6 font-medium text-gray-900">Admin Information</h3>
              <p className="mt-1 max-w-2xl text-sm text-gray-500">Your admin account details</p>
            </div>
            <div className="border-t border-gray-200 px-4 py-5 sm:px-6">
              <dl className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2">
                <div className="sm:col-span-1">
                  <dt className="text-sm font-medium text-gray-500">Full name</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    {currentUser?.name || 'Not available'}
                  </dd>
                </div>
                <div className="sm:col-span-1">
                  <dt className="text-sm font-medium text-gray-500">Email address</dt>
                  <dd className="mt-1 text-sm text-gray-900">{currentUser?.email}</dd>
                </div>
                <div className="sm:col-span-1">
                  <dt className="text-sm font-medium text-gray-500">Admin status</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                      Active
                    </span>
                  </dd>
                </div>
                <div className="sm:col-span-1">
                  <dt className="text-sm font-medium text-gray-500">Last login</dt>
                  {/*
                    This read `new Date().toLocaleString()` — the *current* time, formatted with
                    whatever locale and zone the runtime happened to have. So the field labelled
                    "Last login" always said "just now", for everyone, forever. It was not a stale
                    value or a rounding problem; it was invented data sitting in an admin dashboard
                    next to two fields that are real.

                    Firebase already tracks the real thing. `metadata.lastSignInTime` is the
                    session's actual sign-in, and `formatDateTime` renders it in the same pinned
                    zone as every other timestamp — and returns 'N/A' on its own when the metadata
                    is not there, which is the honest answer.
                  */}
                  <dd className="mt-1 text-sm text-gray-900">
                    {formatDateTime(currentUser?.metadata?.lastSignInTime)}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// Server-side admin gate. A Firebase ID token lives in browser JS memory and is not sent with
// a document request, so it only reaches this function when the auth layer mirrors it into the
// `et_id_token` cookie. Without a verifiable admin token the page HTML is never served; the
// useEffect guard above stays as defence in depth for client-side navigations.
export const getServerSideProps = requireAdminPage;
