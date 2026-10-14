import { useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import { useAuth } from '../../context/AuthContext';
import { requireAdminPage } from '../../services/adminGate';
import { useManagePlaces } from '../../hooks/useManagePlaces';
import { ManagePlacesHeader } from '../../components/admin/managePlaces/ManagePlacesHeader';
import { ManagePlacesFilters } from '../../components/admin/managePlaces/ManagePlacesFilters';
import { PlaceListMobile } from '../../components/admin/managePlaces/PlaceListMobile';
import { PlaceGridDesktop } from '../../components/admin/managePlaces/PlaceGridDesktop';
import { PlaceTableDesktop } from '../../components/admin/managePlaces/PlaceTableDesktop';
import {
  PlaceListError,
  PlaceListEmpty
} from '../../components/admin/managePlaces/PlaceListStates';
import { DeletePlaceModal } from '../../components/admin/managePlaces/DeletePlaceModal';

/**
 * The admin place list.
 *
 * Loading, filtering and deletion live in `useManagePlaces`; each band of the page is its own
 * component under `components/admin/managePlaces/`.
 *
 * Mobile and desktop render different components rather than one responsive grid — the mobile
 * list is always cards, while desktop offers a card/table toggle — and that was already true
 * before the extraction.
 */
export default function ManagePlaces() {
  const router = useRouter();
  const { currentUser, loading, isAdmin, getIdToken } = useAuth();
  const manage = useManagePlaces({ currentUser, isAdmin, loading, getIdToken });

  // Redirect if not admin
  useEffect(() => {
    if (!loading && (!currentUser || !isAdmin)) {
      toast.error('Access denied: Admin privileges required');
      router.push('/');
    }
  }, [currentUser, loading, isAdmin, router]);

  if (loading || (manage.loadingPlaces && isAdmin)) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-gray-50">
        <div className="relative w-16 h-16 sm:w-24 sm:h-24">
          <div className="absolute top-0 left-0 w-full h-full border-4 border-t-primary-600 border-b-primary-300 border-l-primary-600 border-r-primary-300 rounded-full animate-spin"></div>
          <div className="absolute top-1 left-1 sm:top-2 sm:left-2 w-14 h-14 sm:w-20 sm:h-20 border-4 border-t-primary-400 border-b-primary-100 border-l-primary-400 border-r-primary-100 rounded-full animate-spin-slow"></div>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Manage Places - EasyTrip Admin</title>
      </Head>

      <div className="min-h-screen bg-gray-50 pt-20 sm:pt-24 pb-8 sm:pb-12">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <ManagePlacesHeader manage={manage} />
          <ManagePlacesFilters manage={manage} />

          {/* Places List */}
          {manage.loadError ? (
            <PlaceListError loadError={manage.loadError} onRetry={() => router.reload()} />
          ) : manage.filteredPlaces.length === 0 ? (
            <PlaceListEmpty places={manage.places} />
          ) : (
            <>
              {/* Mobile Card View (default for mobile) */}
              <PlaceListMobile manage={manage} />

              {/* Desktop View - Card or Table based on viewMode */}
              <div className="hidden sm:block">
                {manage.viewMode === 'card' ? (
                  <PlaceGridDesktop manage={manage} />
                ) : (
                  <PlaceTableDesktop manage={manage} />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <DeletePlaceModal manage={manage} />
    </>
  );
}

// Server-side admin gate. A Firebase ID token lives in browser JS memory and is not sent with
// a document request, so it only reaches this function when the auth layer mirrors it into the
// `et_id_token` cookie. Without a verifiable admin token the page HTML is never served; the
// useEffect guard above stays as defence in depth for client-side navigations.
export const getServerSideProps = requireAdminPage;
