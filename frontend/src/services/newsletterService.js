import apiClient, { ApiClientError } from './apiClient';

/**
 * Subscribe an email address to the newsletter.
 *
 * Public — no token, so this is the one caller that does **not** set `requireAuth`. The shared
 * interceptor still attaches a token when someone happens to be signed in, which the server
 * ignores on this route; what matters is that a signed-out visitor can subscribe.
 *
 * The server answers identically whether the address was new or already on the list, so callers
 * cannot use this to test which addresses are subscribed, and neither can the UI accidentally
 * reveal it.
 *
 * @param {String} email - Subscriber email address
 * @param {String} source - Where the signup came from: 'footer' | 'place_page' | 'landing' | 'api'
 * @returns {Promise<{ message: String }>}
 */
const subscribeToNewsletter = async (email, source) => {
  try {
    const response = await apiClient.post('/newsletter', { email, source });
    return response.data;
  } catch (error) {
    // The shared client already surfaces the validator's field message ("Please enter a valid
    // email address"), which is the one worth showing. Only the no-response case needs replacing:
    // axios's own text ("Network Error", "timeout of 30000ms exceeded") means nothing to a visitor.
    if (error instanceof ApiClientError && error.status) throw error;

    throw new ApiClientError(
      'Could not complete your subscription. Please try again.',
      error?.status,
      error?.data
    );
  }
};

const newsletterService = { subscribeToNewsletter };

export default newsletterService;
export { subscribeToNewsletter };
