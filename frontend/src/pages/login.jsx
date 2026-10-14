import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import { FiMail, FiLock, FiArrowRight, FiEye, FiEyeOff } from 'react-icons/fi';
import { FcGoogle } from 'react-icons/fc';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  // Validation was toast-only, so the message appeared in the corner while the field that caused
  // it sat unmarked — and vanished after five seconds (IMP-030).
  const [fieldErrors, setFieldErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const { login, signInWithGoogle } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e) => {
    e.preventDefault();

    const errors = {};
    if (!email.trim()) errors.email = 'Enter your email address.';
    if (!password) errors.password = 'Enter your password.';

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    try {
      setLoading(true);
      const result = await login(email, password);

      if (result.success) {
        toast.success('Login successful!');
        router.push('/');
      } else {
        toast.error(result.error || 'Failed to login');
      }
    } catch (error) {
      toast.error(error.message || 'An error occurred during login');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      setLoading(true);
      const result = await signInWithGoogle();

      if (result.success) {
        toast.success('Login with Google successful!');
        router.push('/');
      } else {
        toast.error(result.error || 'Failed to login with Google');
      }
    } catch (error) {
      toast.error(error.message || 'An error occurred during Google login');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Login - EasyTrip</title>
        <meta name="description" content="Login to your EasyTrip account" />
      </Head>

      <div className="bg-gray-50 min-h-screen flex flex-col justify-center pt-24 pb-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          {/* `h1`: this is the page's title, and the page had no `h1` at all — axe
              `page-has-heading-one`, which is how a screen-reader user finds out what a
              page is for before reading it. Styling is unchanged (`PE-022`). */}
          <h1 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Sign in to your account
          </h1>
          <p className="mt-2 text-center text-sm text-gray-600">
            Or{' '}
            <Link href="/signup" className="font-medium text-primary-600 hover:text-primary-500">
              create a new account
            </Link>
          </p>
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
            {/* Google Sign In Button */}
            <div className="mb-6">
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={loading}
                className="w-full flex justify-center items-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <FcGoogle className="mr-2 h-5 w-5" />
                Continue with Google
              </button>
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">Or continue with</span>
              </div>
            </div>

            <form className="mt-6 space-y-6" onSubmit={handleSubmit}>
              {/* Email Input */}
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                  Email address
                </label>
                <div className="mt-1 relative rounded-md shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <FiMail className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    aria-invalid={Boolean(fieldErrors.email)}
                    aria-describedby={fieldErrors.email ? 'email-error' : undefined}
                    className={`block w-full pl-10 pr-3 py-2 border rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none sm:text-sm ${
                      fieldErrors.email
                        ? 'border-red-400 focus:ring-red-500 focus:border-red-500'
                        : 'border-gray-300 focus:ring-primary-500 focus:border-primary-500'
                    }`}
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                {fieldErrors.email && (
                  <p id="email-error" role="alert" className="mt-1 text-sm text-red-600">
                    {fieldErrors.email}
                  </p>
                )}
              </div>

              {/* Password Input */}
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                  Password
                </label>
                <div className="mt-1 relative rounded-md shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <FiLock className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    aria-invalid={Boolean(fieldErrors.password)}
                    aria-describedby={fieldErrors.password ? 'password-error' : undefined}
                    className={`block w-full pl-10 pr-12 py-2 border rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none sm:text-sm ${
                      fieldErrors.password
                        ? 'border-red-400 focus:ring-red-500 focus:border-red-500'
                        : 'border-gray-300 focus:ring-primary-500 focus:border-primary-500'
                    }`}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((shown) => !shown)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? (
                      <FiEyeOff className="h-5 w-5" />
                    ) : (
                      <FiEye className="h-5 w-5" />
                    )}
                  </button>
                </div>
                {fieldErrors.password && (
                  <p id="password-error" role="alert" className="mt-1 text-sm text-red-600">
                    {fieldErrors.password}
                  </p>
                )}
              </div>

              {/* "Remember me" used to sit here, wired to nothing — Firebase persistence is local
                  by default, so the checkbox controlled no behaviour either way (IMP-030). */}
              <div className="flex items-center justify-end">
                <div className="text-sm">
                  <Link
                    href="/forgot-password"
                    className="font-medium text-primary-600 hover:text-primary-500"
                  >
                    Forgot your password?
                  </Link>
                </div>
              </div>

              {/* Submit Button */}
              <div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex justify-center items-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
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
                      Signing in...
                    </span>
                  ) : (
                    <span className="flex items-center">
                      Sign in
                      <FiArrowRight className="ml-2 h-4 w-4" />
                    </span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
