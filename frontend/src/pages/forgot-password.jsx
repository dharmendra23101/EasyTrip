import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { toast } from 'react-toastify';
import { FiMail, FiArrowLeft, FiCheckCircle } from 'react-icons/fi';
import { useAuth } from '../context/AuthContext';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const { resetPassword } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!email) {
      toast.error('Please enter your email address');
      return;
    }

    try {
      setLoading(true);
      const result = await resetPassword(email);

      if (result.success) {
        // Deliberately the same outcome whether or not an account exists — resetPassword
        // collapses the unknown-address case into success so this page cannot be used to
        // discover which emails are registered.
        setSent(true);
      } else {
        toast.error(result.error || 'Could not send the reset email');
      }
    } catch (error) {
      toast.error(error.message || 'An error occurred while sending the reset email');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Reset password - EasyTrip</title>
        <meta name="description" content="Reset your EasyTrip account password" />
      </Head>

      <div className="bg-gray-50 min-h-screen flex flex-col justify-center pt-24 pb-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Reset your password
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            We&apos;ll email you a link to choose a new one.
          </p>
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
            {sent ? (
              <div className="text-center">
                <FiCheckCircle className="mx-auto h-12 w-12 text-green-500" aria-hidden="true" />
                <h3 className="mt-4 text-lg font-medium text-gray-900">Check your inbox</h3>
                <p className="mt-2 text-sm text-gray-600">
                  If an account exists for <span className="font-medium">{email}</span>, a password
                  reset link is on its way. The link expires after a short time, so use it soon.
                </p>
                <p className="mt-4 text-sm text-gray-500">
                  Nothing arrived? Check your spam folder, or{' '}
                  <button
                    type="button"
                    onClick={() => setSent(false)}
                    className="font-medium text-primary-600 hover:text-primary-500"
                  >
                    try a different address
                  </button>
                  .
                </p>
              </div>
            ) : (
              <form className="space-y-6" onSubmit={handleSubmit}>
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                    Email address
                  </label>
                  <div className="mt-1 relative rounded-md shadow-sm">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <FiMail className="h-5 w-5 text-gray-400" aria-hidden="true" />
                    </div>
                    <input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="appearance-none block w-full pl-10 px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                      placeholder="you@example.com"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Sending...' : 'Send reset link'}
                </button>
              </form>
            )}

            <div className="mt-6 text-center">
              <Link
                href="/login"
                className="inline-flex items-center text-sm font-medium text-primary-600 hover:text-primary-500"
              >
                <FiArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
                Back to sign in
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
