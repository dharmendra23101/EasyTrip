import { useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { toast } from 'react-toastify';
import { FiArrowLeft } from 'react-icons/fi';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../context/AuthContext';
import { createPlace } from '../../services/placeService';
import { requireAdminPage } from '../../services/adminGate';
import { adminService } from '../../services/adminService';
import { usePlaceForm } from '../../hooks/usePlaceForm';
import { FormProgress } from '../../components/admin/placeForm/FormProgress';
import { SubmittingSummary } from '../../components/admin/placeForm/SubmittingSummary';
import { StepBasicInfo } from '../../components/admin/placeForm/StepBasicInfo';
import { StepLocation } from '../../components/admin/placeForm/StepLocation';
import { StepMediaThemes } from '../../components/admin/placeForm/StepMediaThemes';
import { StepTagsDetails } from '../../components/admin/placeForm/StepTagsDetails';

/**
 * The admin add-place wizard.
 *
 * The page owns the route, the admin guard and the four-step layout; everything else lives in
 * `usePlaceForm` (state and operations), `utils/placeFormValidation` (the rules, as pure
 * functions) and `components/admin/placeForm/` (IMP-070).
 *
 * `{step === n && ...}` stays here rather than inside each step component. Which step renders is
 * the wizard's business — a step that decides for itself whether it is visible leaves nothing
 * able to state the sequence.
 */
export default function AddPlace() {
  const router = useRouter();
  const { currentUser, loading, isAdmin, getIdToken } = useAuth();

  const form = usePlaceForm({
    getIdToken,
    createPlace,
    geocode: adminService.geocode,
    onCreated: (response) => router.push(`/places/${response.id}`)
  });

  // Redirect if not admin
  useEffect(() => {
    if (!loading && (!currentUser || !isAdmin)) {
      toast.error('Unauthorized access - Admin privileges required');
      router.push('/login');
    }
  }, [currentUser, loading, isAdmin, router]);

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-gray-50">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center"
        >
          <div className="w-16 h-16 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600 font-medium">Loading admin panel...</p>
        </motion.div>
      </div>
    );
  }

  const { step } = form;

  return (
    <>
      <Head>
        <title>Add New Place - EasyTrip Admin</title>
        <meta name="description" content="Add a new place to EasyTrip - Admin Panel" />
        <meta name="robots" content="noindex, nofollow" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </Head>

      <div className="bg-gradient-to-br from-gray-50 to-blue-50 min-h-screen pt-20 sm:pt-24 pb-12 px-3 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 sm:mb-8"
          >
            <button
              onClick={() => router.push('/admin')}
              className="flex items-center text-gray-600 hover:text-gray-900 transition-colors mb-3 sm:mb-4 group"
            >
              <FiArrowLeft className="mr-2 group-hover:-translate-x-1 transition-transform" />
              <span className="text-sm sm:text-base">Back to Admin Dashboard</span>
            </button>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 mb-2">
              Add New Place
            </h1>
            <p className="text-gray-600 text-sm sm:text-base lg:text-lg">
              Create a new destination with detailed information
            </p>
          </motion.div>

          <FormProgress step={step} />

          {/* Main Form */}
          <motion.form
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            onSubmit={form.handleSubmit}
            className="bg-white shadow-xl rounded-xl sm:rounded-2xl overflow-hidden"
          >
            <AnimatePresence mode="wait">
              {step === 1 && <StepBasicInfo form={form} />}
              {step === 2 && <StepLocation form={form} />}
              {step === 3 && <StepMediaThemes form={form} />}
              {step === 4 && <StepTagsDetails form={form} router={router} />}
            </AnimatePresence>
          </motion.form>

          <SubmittingSummary isSubmitting={form.isSubmitting} primaryImage={form.primaryImage} />
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
