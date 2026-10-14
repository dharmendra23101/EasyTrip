import React from 'react';
import Link from 'next/link';
import { FiAlertTriangle, FiHome, FiRefreshCw } from 'react-icons/fi';

/**
 * Global error boundary (IMP-074).
 *
 * Without one, a single render-time exception unmounts the whole React tree and the user gets a
 * blank white page with nothing to act on. This project has already shipped that exact failure: a
 * missing `FiFlag` import crashed the place-detail page for every place that had a review, and the
 * only symptom was a white screen (IMP-005).
 *
 * Must be a class component — `componentDidCatch`/`getDerivedStateFromError` have no hooks
 * equivalent, which is the one remaining case where a class is required.
 *
 * Note what this does NOT catch, so nobody assumes more coverage than exists: errors thrown in
 * event handlers, in `setTimeout`, in async code after an await, or during server-side rendering.
 * Those need their own try/catch — a boundary only sees exceptions raised during render, in
 * lifecycle methods, and in constructors below it.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Console is the only sink today. When error monitoring lands (FV-021 / Phase 13) this is the
    // single place that needs to change.
    console.error('Unhandled render error:', error, errorInfo);
  }

  handleReset = () => {
    // Clearing the flag re-renders the same subtree. That is enough for a transient failure (a bad
    // API response that has since changed); for a deterministic bug it will simply fail again and
    // the user still has the reload and home options.
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-[70vh] flex items-center justify-center px-4 py-16">
        <div className="max-w-md w-full text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-50 text-red-600 mb-6">
            <FiAlertTriangle className="w-8 h-8" />
          </div>

          <h1 className="text-2xl font-bold text-gray-900 mb-3">Something went wrong</h1>
          <p className="text-gray-600 mb-8">
            This page hit an unexpected error. Nothing you did caused it, and your account and data
            are unaffected.
          </p>

          {/* The message is shown in development only. In production it can leak internals, and it
              is meaningless to the person reading it. */}
          {process.env.NODE_ENV === 'development' && this.state.error && (
            <pre className="text-left text-xs bg-gray-100 border border-gray-200 rounded-lg p-3 mb-6 overflow-x-auto text-red-700">
              {this.state.error.toString()}
            </pre>
          )}

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              type="button"
              onClick={this.handleReset}
              className="inline-flex items-center justify-center px-5 py-2.5 rounded-lg bg-primary-600 text-white font-medium hover:bg-primary-700 transition-colors"
            >
              <FiRefreshCw className="mr-2" />
              Try again
            </button>
            <Link
              href="/"
              onClick={this.handleReset}
              className="inline-flex items-center justify-center px-5 py-2.5 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 transition-colors"
            >
              <FiHome className="mr-2" />
              Go home
            </Link>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
