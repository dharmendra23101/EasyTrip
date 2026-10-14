import { useCallback } from 'react';
import { toast } from 'react-toastify';
import { FiCheckCircle } from 'react-icons/fi';

/**
 * Sharing a place: the Web Share sheet where it exists, a clipboard copy where it does not, and
 * the three social intents behind the hero's share menu (IMP-070).
 *
 * @param {Object|null} place
 * @returns {{share: Function, shareTo: Function}}
 */
export function useSharePlace(place) {
  // **The name, read once, so the dependency arrays below name the same thing the bodies use.**
  //
  // Both callbacks used to read the place's name directly while declaring the *optional* form as
  // their dependency, and the mismatch had two consequences. The small one is that
  // `react-hooks/preserve-manual-memoization` cannot reconcile the two and skips the component
  // (`BL-146`) - it infers a dependency on the whole place where the source named one property.
  //
  // The real one is that the optional chaining was the correct half: `places/[id].jsx` calls this
  // hook **above** its `if (loading && !place) return` guard, so the place genuinely is null on the
  // first render. Nothing has ever thrown only because neither callback is invoked until a click,
  // by which time the place has arrived - a live hazard resting on a timing coincidence.
  const name = place?.name;

  const share = useCallback(() => {
    if (navigator.share && navigator.canShare?.()) {
      navigator
        .share({
          title: name,
          text: `Check out ${name} on EasyTrip!`,
          url: window.location.href
        })
        .catch(console.error);
    } else {
      navigator.clipboard
        .writeText(window.location.href)
        .then(() => {
          toast.success('Link copied to clipboard!', {
            icon: <FiCheckCircle className="text-green-500 h-5 w-5" />
          });
        })
        .catch(() => {
          toast.error('Failed to copy link');
        });
    }
  }, [name]);

  const shareTo = useCallback(
    (platform) => {
      const url = encodeURIComponent(window.location.href);
      const text = encodeURIComponent(`Check out ${name} on EasyTrip!`);
      let shareUrl = '';

      switch (platform) {
        case 'twitter':
          shareUrl = `https://twitter.com/intent/tweet?url=${url}&text=${text}`;
          break;
        case 'facebook':
          shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${url}`;
          break;
        case 'whatsapp':
          shareUrl = `https://api.whatsapp.com/send?text=${text}%20${url}`;
          break;
        default:
          return;
      }
      window.open(shareUrl, '_blank', 'noopener,noreferrer');
    },
    [name]
  );

  return { share, shareTo };
}
