import Head from 'next/head';
import { useRouter } from 'next/router';
import { Inter, Playfair_Display } from 'next/font/google';
import { MotionConfig } from 'framer-motion';
import { ToastContainer } from 'react-toastify';
import { AuthProvider } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import ErrorBoundary from '../components/ErrorBoundary';
import ServiceWorkerRegistration from '../components/ServiceWorkerRegistration';
import 'react-toastify/dist/ReactToastify.css';
import '../styles/globals.css';

/**
 * Self-hosted fonts (IMP-041).
 *
 * These were a `<link rel="stylesheet">` to fonts.googleapis.com in `_document`: render-blocking,
 * on a third-party origin, and costing a second hop to fonts.gstatic.com once the CSS resolved.
 * `next/font` downloads the files at build time and serves them from the app's own origin with
 * the right preload hints, so the critical path loses a DNS lookup, a TLS handshake and a
 * round trip on every cold visit.
 *
 * `display: 'swap'` keeps text visible while the face loads, and each family is exposed as a CSS
 * variable so `tailwind.config.js` can point `font-sans` / `font-serif` at it — the class names
 * used throughout the app do not change.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-inter'
});

const playfair = Playfair_Display({
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '700', '900'],
  style: ['normal', 'italic'],
  variable: '--font-playfair'
});

function MyApp({ Component, pageProps }) {
  const router = useRouter();
  // Use the layout defined at the page level, if available
  const getLayout = Component.getLayout || ((page) => page);

  return (
    /* One switch for all 403 framer-motion elements (IMP-082). Their animations are JS-driven
       inline styles, so the CSS media query in globals.css cannot reach them; `reducedMotion="user"`
       makes every motion component below honour the OS setting without touching a single call site.
       Transform and layout animations are suppressed and settle instantly, which is the behaviour
       vestibular-disorder guidance actually asks for.

       **Opacity fades keep running, and that is the library's deliberate choice, not an oversight
       here.** framer-motion exempts opacity and colour from `reducedMotion` because a fade does not
       provoke vestibular symptoms. This comment used to claim fades were suppressed too; they are
       not, and believing otherwise cost `BUG-057` twenty sprints of wrong diagnoses — the
       accessibility gate was measuring text against a half-faded background and recording the result
       as a fact about the palette. `e2e/tests/axe.spec.js` now settles animations before it scans. */
    <MotionConfig reducedMotion="user">
      {/* Installability (IMP-115). These live here rather than in a `_document` because there is
          no `_document` in this project, and adding one to hold four tags would be a new file whose
          only job is to hold four tags. Page-level `<Head>` blocks still override anything here. */}
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="manifest" href="/manifest.webmanifest" />
        {/* Matches the manifest's theme_color, which is `primary-600` — the value IMP-084 measured
            at 4.88:1 for WCAG AA. Two declarations of one colour, unavoidable: the manifest is
            JSON that cannot import a token. */}
        <meta name="theme-color" content="#0277b4" />
        {/* iOS ignores the manifest's icon list entirely and reads this instead. */}
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="EasyTrip" />
      </Head>

      {/* Registers the offline worker in production only (IMP-115). Renders nothing; outside
          AuthProvider because it needs no identity and must not wait for one. */}
      <ServiceWorkerRegistration />
      <AuthProvider>
        {/* The variables have to land on an element that wraps everything, including portalled
            toasts, so every `font-sans` / `font-serif` in the tree can resolve them. */}
        <div className={`${inter.variable} ${playfair.variable} flex flex-col min-h-screen`}>
          {/* Lets keyboard and screen-reader users jump past the nav to the page content
              instead of tabbing the whole menu on every navigation (IMP-077). */}
          <a
            href="#main-content"
            className="sr-only-focusable absolute left-4 top-4 z-[100] rounded-lg bg-primary-600 px-4 py-2 text-white font-medium shadow-lg"
          >
            Skip to main content
          </a>
          <Navbar />
          {/* Wraps the page only, not the chrome: a crash inside a page leaves the navbar and
            footer intact, so the user can still navigate away instead of losing the whole app.
            Keyed on the route so recovering from an error on one page does not carry the error
            state onto the next one (IMP-074). */}
          <main id="main-content" tabIndex={-1} className="flex-grow">
            <ErrorBoundary key={router.asPath}>
              {getLayout(<Component {...pageProps} />)}
            </ErrorBoundary>
          </main>
          <Footer />
        </div>
        <ToastContainer
          position="top-right"
          autoClose={5000}
          hideProgressBar={false}
          newestOnTop
          closeOnClick
          rtl={false}
          pauseOnFocusLoss
          draggable
          pauseOnHover
        />
      </AuthProvider>
    </MotionConfig>
  );
}

export default MyApp;
