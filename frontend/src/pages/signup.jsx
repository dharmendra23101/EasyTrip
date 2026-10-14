import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import { FiUser, FiMail, FiLock, FiArrowRight, FiEye, FiEyeOff } from 'react-icons/fi';
import { FcGoogle } from 'react-icons/fc';
import { useAuth } from '../context/AuthContext';

export default function Signup() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  // Toast-only validation meant "Passwords do not match" appeared in the corner with neither
  // password field marked, and disappeared before the user finished re-reading them (IMP-030).
  const [fieldErrors, setFieldErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const { register, signInWithGoogle } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Every failure is attached to the field that caused it, and all of them surface at once
    // rather than one per submit.
    const errors = {};
    if (!name.trim()) errors.name = 'Enter your name.';
    if (!email.trim()) errors.email = 'Enter your email address.';
    if (!password) errors.password = 'Choose a password.';
    else if (password.length < 6) errors.password = 'Use at least 6 characters.';
    if (!confirmPassword) errors.confirmPassword = 'Re-enter your password.';
    else if (password && password !== confirmPassword)
      errors.confirmPassword = 'Passwords do not match.';

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    try {
      setLoading(true);
      const result = await register(email, password, name);

      if (result.success) {
        toast.success('Account created successfully!');
        // Automatically redirect to home page after successful registration
        router.push('/');
      } else {
        toast.error(result.error || 'Failed to create account');
      }
    } catch (error) {
      toast.error(error.message || 'An error occurred during registration');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      setLoading(true);
      const result = await signInWithGoogle();

      if (result.success) {
        // `signInWithGoogle` is the same call the login page makes: an existing Google user is
        // simply signed in, and nothing here can tell the two apart. Claiming "Account created"
        // was therefore wrong for every returning user (IMP-031). "Signed in" is true either way.
        toast.success('Signed in with Google');
        router.push('/');
      } else {
        toast.error(result.error || 'Failed to sign in with Google');
      }
    } catch (error) {
      toast.error(error.message || 'An error occurred during Google sign-in');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Sign Up - EasyTrip</title>
        <meta name="description" content="Create a new EasyTrip account" />
      </Head>

      <div className="bg-gray-50 min-h-screen flex flex-col justify-center pt-24 pb-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          {/* `h1`: this is the page's title, and the page had no `h1` at all — axe
              `page-has-heading-one`, which is how a screen-reader user finds out what a
              page is for before reading it. Styling is unchanged (`PE-022`). */}
          <h1 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Create a new account
          </h1>
          <p className="mt-2 text-center text-sm text-gray-600">
            Already have an account?{' '}
            <Link href="/login" className="font-medium text-primary-600 hover:text-primary-500">
              Sign in instead
            </Link>
          </p>
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
            {/* Google Sign Up Button */}
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
              {/* Name Input */}
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                  Full name
                </label>
                <div className="mt-1 relative rounded-md shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <FiUser className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    id="name"
                    name="name"
                    type="text"
                    autoComplete="name"
                    required
                    aria-invalid={Boolean(fieldErrors.name)}
                    aria-describedby={fieldErrors.name ? 'name-error' : undefined}
                    className={`block w-full pl-10 pr-3 py-2 border rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none sm:text-sm ${
                      fieldErrors.name
                        ? 'border-red-400 focus:ring-red-500 focus:border-red-500'
                        : 'border-gray-300 focus:ring-primary-500 focus:border-primary-500'
                    }`}
                    placeholder="John Doe"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                {fieldErrors.name && (
                  <p id="name-error" role="alert" className="mt-1 text-sm text-red-600">
                    {fieldErrors.name}
                  </p>
                )}
              </div>

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
                    autoComplete="new-password"
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

              {/* Confirm Password Input */}
              <div>
                <label
                  htmlFor="confirmPassword"
                  className="block text-sm font-medium text-gray-700"
                >
                  Confirm Password
                </label>
                <div className="mt-1 relative rounded-md shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <FiLock className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type={showConfirm ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    aria-invalid={Boolean(fieldErrors.confirmPassword)}
                    aria-describedby={
                      fieldErrors.confirmPassword ? 'confirmPassword-error' : undefined
                    }
                    className={`block w-full pl-10 pr-12 py-2 border rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none sm:text-sm ${
                      fieldErrors.confirmPassword
                        ? 'border-red-400 focus:ring-red-500 focus:border-red-500'
                        : 'border-gray-300 focus:ring-primary-500 focus:border-primary-500'
                    }`}
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((shown) => !shown)}
                    aria-label={showConfirm ? 'Hide password' : 'Show password'}
                    className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-400 hover:text-gray-600"
                  >
                    {showConfirm ? <FiEyeOff className="h-5 w-5" /> : <FiEye className="h-5 w-5" />}
                  </button>
                </div>
                {fieldErrors.confirmPassword && (
                  <p id="confirmPassword-error" role="alert" className="mt-1 text-sm text-red-600">
                    {fieldErrors.confirmPassword}
                  </p>
                )}
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
                      Creating account...
                    </span>
                  ) : (
                    <span className="flex items-center">
                      Create account
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
