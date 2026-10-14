import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import { FiArrowLeft, FiUserPlus, FiTrash2, FiShield, FiMail } from 'react-icons/fi';
import { useAuth } from '../../context/AuthContext';
import { adminService } from '../../services/adminService';
import { requireAdminPage } from '../../services/adminGate';
// The last of the five copies IMP-122 set out to consolidate. This one was already
// character-for-character `formatDateShort` — same locale, same widths, `'N/A'` for empty and
// `'Invalid Date'` for junk — apart from the one thing that mattered: it never pinned
// `timeZone`, so "Admin since" moved a day for anyone behind UTC (BUG-046).
import { formatDateShort as formatDate } from '../../utils/dateFormat';

/**
 * Admin user management (IMP-018).
 *
 * The backend for this — `GET/POST/DELETE /api/admin/admins` — has always worked, and
 * `adminService.js` was already written against it with correct Bearer auth. Neither had a single
 * caller: the dashboard tile pointed at this URL and got a 404, so the service was dead code
 * guarding a working API. This page is the missing client, not new capability.
 */
export default function AdminUsers() {
  const { currentUser, loading, isAdmin, getIdToken } = useAuth();
  const router = useRouter();

  const [admins, setAdmins] = useState([]);
  const [loadingAdmins, setLoadingAdmins] = useState(true);
  const [error, setError] = useState(null);
  const [newEmail, setNewEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const [removingEmail, setRemovingEmail] = useState(null);

  useEffect(() => {
    if (!loading && (!currentUser || !isAdmin)) {
      toast.error('Access denied: Admin privileges required');
      router.push('/');
    }
  }, [currentUser, loading, isAdmin, router]);

  const fetchAdmins = useCallback(async () => {
    try {
      setLoadingAdmins(true);
      const token = await getIdToken();
      if (!token) throw new Error('Your session has expired. Please sign in again.');

      const result = await adminService.getAllAdmins(token);
      setAdmins(Array.isArray(result) ? result : []);
      setError(null);
    } catch (err) {
      setError(err?.message || 'Could not load the admin list.');
    } finally {
      setLoadingAdmins(false);
    }
  }, [getIdToken]);

  useEffect(() => {
    if (currentUser && isAdmin) fetchAdmins();
  }, [currentUser, isAdmin, fetchAdmins]);

  const handleAddAdmin = async (e) => {
    e.preventDefault();
    const email = newEmail.trim();
    if (!email || adding) return;

    setAdding(true);
    setError(null);

    try {
      const token = await getIdToken();
      if (!token) throw new Error('Your session has expired. Please sign in again.');

      await adminService.addAdmin(token, email);
      setNewEmail('');
      toast.success(`${email} is now an admin`);
      // Refetch rather than appending: the server resolves the address to a Firebase user and
      // returns the stored row, so guessing the shape locally would drift from what it saved.
      await fetchAdmins();
    } catch (err) {
      const message = err?.message || 'Could not grant admin access.';
      setError(message);
      toast.error(message);
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveAdmin = async (email) => {
    // Losing your own admin rights logs you out of every admin page on the next check, and you
    // cannot grant them back from the UI — so this one is worth spelling out explicitly.
    const isSelf = email?.toLowerCase() === currentUser?.email?.toLowerCase();
    const message = isSelf
      ? 'Remove your OWN admin access? You will lose access to every admin page immediately and cannot restore it yourself.'
      : `Remove admin access for ${email}?`;

    if (!window.confirm(message)) return;

    setRemovingEmail(email);
    setError(null);

    try {
      const token = await getIdToken();
      if (!token) throw new Error('Your session has expired. Please sign in again.');

      await adminService.removeAdmin(token, email);
      setAdmins((current) => current.filter((admin) => admin.email !== email));
      toast.success(`Admin access removed for ${email}`);

      if (isSelf) router.push('/');
    } catch (err) {
      const errorMessage = err?.message || 'Could not remove admin access.';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setRemovingEmail(null);
    }
  };

  if (loading || !currentUser || !isAdmin) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-700"></div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>User Management | EasyTrip Admin</title>
      </Head>

      <div className="min-h-screen bg-gray-50 pt-24 pb-8">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <Link
            href="/admin"
            className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 mb-6"
          >
            <FiArrowLeft className="mr-2" />
            Back to dashboard
          </Link>

          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 flex items-center">
              <FiShield className="mr-3 text-primary-600" />
              User Management
            </h1>
            <p className="text-gray-600 mt-2">
              Grant or revoke admin access. Admin is a single role — there are no finer-grained
              permissions yet.
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm"
            >
              {error}
            </div>
          )}

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Grant admin access</h2>
            <p className="text-sm text-gray-500 mb-4">
              The person must already have an EasyTrip account — this promotes an existing user
              rather than creating one.
            </p>

            <form onSubmit={handleAddAdmin} className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <FiMail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="person@example.com"
                  aria-label="Email address to grant admin access"
                  disabled={adding}
                  required
                  className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-primary-500 focus:border-primary-500 disabled:opacity-60"
                />
              </div>
              <button
                type="submit"
                disabled={adding}
                className="inline-flex items-center justify-center px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-60"
              >
                <FiUserPlus className="mr-2" />
                {adding ? 'Granting…' : 'Grant admin'}
              </button>
            </form>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">
                Current admins {!loadingAdmins && `(${admins.length})`}
              </h2>
            </div>

            {loadingAdmins ? (
              <div className="p-6 text-center text-gray-500">Loading admins…</div>
            ) : admins.length === 0 ? (
              <div className="p-6 text-center text-gray-500">
                No admins found. If that looks wrong, the list failed to load rather than being
                empty.
              </div>
            ) : (
              <ul className="divide-y divide-gray-200">
                {admins.map((admin) => {
                  const isSelf = admin.email?.toLowerCase() === currentUser?.email?.toLowerCase();
                  return (
                    <li
                      key={admin.id || admin.email}
                      className="px-6 py-4 flex flex-wrap items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate">
                          {admin.name || 'Unnamed user'}
                          {isSelf && (
                            <span className="ml-2 text-xs font-normal text-primary-700 bg-primary-50 px-2 py-0.5 rounded-full">
                              you
                            </span>
                          )}
                        </p>
                        <p className="text-sm text-gray-500 truncate">{admin.email}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          Admin since {formatDate(admin.created_at)}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveAdmin(admin.email)}
                        disabled={removingEmail === admin.email}
                        className="inline-flex items-center px-3 py-1.5 text-sm text-red-600 hover:text-red-800 hover:bg-red-50 rounded-lg disabled:opacity-50"
                      >
                        <FiTrash2 className="mr-1.5 w-4 h-4" />
                        {removingEmail === admin.email ? 'Removing…' : 'Remove'}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// Server-side admin gate (`IMP-054`) — added Sprint 7.10.
//
// This page was the ONE of five under `pages/admin/` that never had it: `index`, `addPlace`,
// `managePlaces` and `editPlace/[id]` all export `requireAdminPage`, and this one relied solely on
// the client-side `useEffect` redirect above. Not a data leak — every request it makes is
// admin-gated server-side and 403s — but it served the admin shell to anyone who asked for the
// URL, and it made the projects stated posture untrue of one page.
//
// Found while adding a sixth admin page (`moderation`), which is exactly when a gap like this is
// most likely to be copied rather than noticed. `adminPageGate.test.js` now asserts the rule for
// every page in the directory, so the seventh cannot forget.
export const getServerSideProps = requireAdminPage;
