import { useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { toast } from 'react-toastify';
import { FiArrowLeft } from 'react-icons/fi';
import { useAuth } from '../../../context/AuthContext';
import { requireAdminPage } from '../../../services/adminGate';
import { useEditPlace } from '../../../hooks/useEditPlace';
import { usePlaceGallery } from '../../../hooks/usePlaceGallery';
import { formatDateTime } from '../../../utils/dateFormat';
import { EditPlaceFields } from '../../../components/admin/editPlace/EditPlaceFields';
import { PrimaryImagePicker } from '../../../components/admin/editPlace/PrimaryImagePicker';
import { GalleryManager } from '../../../components/admin/editPlace/GalleryManager';
import { ThemeSelector } from '../../../components/admin/editPlace/ThemeSelector';
import { TagEditor } from '../../../components/admin/editPlace/TagEditor';
import { CustomKeyEditor } from '../../../components/admin/editPlace/CustomKeyEditor';
import { SubmitBar } from '../../../components/admin/editPlace/SubmitBar';

/**
 * The admin edit-place form.
 *
 * Unlike `addPlace` this is a flat form rather than a wizard, and it owns a gallery the create
 * form has no equivalent of — so the two share their *rules* (`utils/placeFormValidation`) and
 * their helpers, not their layout (IMP-070 / IMP-126).
 *
 * The gallery is a separate hook because its operations hit the server immediately rather than
 * travelling with the form submit: a failed upload must not block saving the place, and a
 * successful one must not need a save to persist.
 */
export default function EditPlace() {
  const router = useRouter();
  const { id } = router.query;
  const auth = useAuth();
  const { currentUser, loading, isAdmin, getIdToken } = auth;

  const form = useEditPlace(id, { currentUser, isAdmin, getIdToken }, () =>
    router.push('/admin/managePlaces')
  );
  const gallery = usePlaceGallery(id, getIdToken);

  // Redirect if not admin
  useEffect(() => {
    if (!loading && (!currentUser || !isAdmin)) {
      toast.error('Access denied: Admin privileges required');
      router.push('/');
    }
  }, [currentUser, loading, isAdmin, router]);

  if (loading || form.loadingPlace) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="relative w-24 h-24">
          <div className="absolute top-0 left-0 w-full h-full border-4 border-t-primary-600 border-b-primary-300 border-l-primary-600 border-r-primary-300 rounded-full animate-spin"></div>
          <div className="absolute top-2 left-2 w-20 h-20 border-4 border-t-primary-400 border-b-primary-100 border-l-primary-400 border-r-primary-100 rounded-full animate-spin-slow"></div>
        </div>
      </div>
    );
  }

  if (form.error) {
    return (
      <div className="flex flex-col justify-center items-center min-h-screen px-4">
        <h1 className="text-3xl font-bold text-red-600 mb-4">Error</h1>
        <p className="text-lg text-gray-700 mb-6">{form.error}</p>
        <button
          onClick={() => router.push('/admin/managePlaces')}
          className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none"
        >
          <FiArrowLeft className="mr-2" />
          Return to Manage Places
        </button>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Edit Place - EasyTrip Admin</title>
      </Head>

      <div className="bg-gray-50 min-h-screen pt-24 pb-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto">
          <div className="mb-8">
            <button
              onClick={() => router.back()}
              className="flex items-center text-gray-600 hover:text-gray-900"
            >
              <FiArrowLeft className="mr-2" />
              Back
            </button>
            <h1 className="mt-4 text-3xl font-bold text-gray-900">
              Edit Place: {form.formData.name}
            </h1>
            <div className="mt-2 text-sm text-gray-600">
              <p>Created: {formatDateTime(form.createdAt)}</p>
              <p>Created By: {form.formData.created_by_name}</p>
              <p>Last Updated: {formatDateTime(form.updatedAt)}</p>
              <p>Updated By: {form.formData.updated_by_name}</p>
              <p>Previous Update: {formatDateTime(form.previousUpdate)}</p>
            </div>
          </div>

          <form onSubmit={form.handleSubmit} className="bg-white shadow-md rounded-lg p-6">
            <EditPlaceFields form={form} />
            <PrimaryImagePicker form={form} />
            <GalleryManager gallery={gallery} />
            <ThemeSelector form={form} />
            <TagEditor form={form} />
            <CustomKeyEditor form={form} />
            <SubmitBar form={form} />
          </form>
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
