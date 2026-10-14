import { useCallback, useEffect, useState } from 'react';
import { FiCopy, FiLink, FiRefreshCw, FiSlash } from 'react-icons/fi';

import tripService from '../../services/tripService';

/**
 * The read-only share link (`FV-009` stage c), from the owner's side.
 *
 * ---------------------------------------------------------------------------
 * The interface has to say what the link actually is
 * ---------------------------------------------------------------------------
 * A share link is a **bearer credential in a URL**: anybody who ends up holding it can read the
 * trip, and URLs travel further than people expect — forwarded messages, screenshots, browser
 * history. Somebody clicking "Share" is entitled to know that before they paste it into a group
 * chat, so the panel says it in a sentence rather than assuming it is obvious.
 *
 * It also says what is **not** shared. The notes and the checklist stay private, and a reader who
 * does not know that will either withhold a link they could safely send or send one believing it
 * shows less than it does. Both are worse than a sentence.
 *
 * ---------------------------------------------------------------------------
 * Revoking is a first-class control, not a settings page
 * ---------------------------------------------------------------------------
 * The realistic emergency is *"that link went further than I meant"*, and the answer to it has to be
 * one click away from where the link is displayed. There are two:
 *
 *   - **Revoke** ends every copy at once.
 *   - **New link** rotates the token, which kills the old one and gives a working replacement — the
 *     right control when the trip should still be shared, just not with whoever has it now.
 *
 * Both are destructive to something already in circulation, so both confirm first.
 */

/** The link as somebody would paste it. Built from the live origin so it is right in every deploy. */
const shareUrl = (token) =>
  typeof window === 'undefined' ? `/shared/${token}` : `${window.location.origin}/shared/${token}`;

export const ShareTripPanel = ({ tripId, getToken }) => {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!tripId || !getToken) return;
    try {
      setState(await tripService.getShare(tripId, await getToken()));
      setError(null);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [tripId, getToken]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (operation) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await operation();
      setCopied(false);
    } catch (operationError) {
      setError(operationError.message);
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    run(async () => setState(await tripService.createShare(tripId, await getToken())));

  const rotate = () =>
    run(async () => {
      if (
        !window.confirm('This replaces the current link. Anybody using the old one loses access.')
      )
        return;
      setState(await tripService.createShare(tripId, await getToken()));
    });

  const revoke = () =>
    run(async () => {
      if (!window.confirm('This ends the link for everybody you have sent it to. Continue?'))
        return;
      await tripService.revokeShare(tripId, await getToken());
      setState({ shared: false, share_token: null, shared_at: null });
    });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl(state.share_token));
      setCopied(true);
    } catch {
      // Clipboard access can be refused, and there is nothing to do about it — the link is on
      // screen and selectable either way, which is why this is not an error worth showing.
      setCopied(false);
    }
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold text-gray-900">
        <FiLink className="h-4 w-4 text-primary-600" aria-hidden="true" />
        Share this trip
      </h2>

      <p className="mb-4 text-sm text-gray-600">
        A read-only link to the itinerary — the days, the stops and their times. Your notes and your
        checklist are <strong>not</strong> shared. Anybody with the link can open it without signing
        in, so treat it like a key rather than an invitation.
      </p>

      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {state?.shared ? (
        <>
          <label htmlFor="share-url" className="sr-only">
            Share link
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {/* Read-only rather than disabled: a disabled input cannot be focused or selected, so
                somebody without a working clipboard could not copy the link by hand. */}
            <input
              id="share-url"
              type="text"
              readOnly
              value={shareUrl(state.share_token)}
              onFocus={(event) => event.target.select()}
              className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 font-mono text-xs text-gray-700"
            />
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700"
            >
              <FiCopy className="h-4 w-4" aria-hidden="true" />
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={rotate}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 disabled:opacity-50"
            >
              <FiRefreshCw className="h-4 w-4" aria-hidden="true" />
              New link
            </button>
            <button
              type="button"
              onClick={revoke}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 disabled:opacity-50"
            >
              <FiSlash className="h-4 w-4" aria-hidden="true" />
              Stop sharing
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={create}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          <FiLink className="h-4 w-4" aria-hidden="true" />
          {busy ? 'Creating…' : 'Create a share link'}
        </button>
      )}
    </section>
  );
};

export default ShareTripPanel;
