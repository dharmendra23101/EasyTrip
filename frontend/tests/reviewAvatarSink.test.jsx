import { render, screen } from '@testing-library/react';
import { MagazineReviews } from '../src/components/place/MagazineReviews';

/**
 * The review author avatar is not rendered as an image, deliberately (`SECURITY_AUDIT` L8).
 *
 * The original audit filed this as *"dead today, unvalidated sink tomorrow"* against
 * `ReviewList.jsx`. That component was later deleted — but the markup moved rather than went away,
 * and the branch reappeared in `MagazineReviews.jsx`, which is how a finding survives a file being
 * removed. It was still dead: a grep for `user_avatar` across `backend/src` returns zero, so no API
 * response has ever populated the field.
 *
 * **Why removing it mattered even though it never ran.** `getCloudinaryThumbnail` is not a
 * sanitizer. Its first line returns the input **unchanged** when the string does not contain
 * `cloudinary.com`, so it is a pass-through for exactly the values you would want stopped. The
 * branch was one added field away from being a live sink, and the field it needed is one a
 * reasonable person would add — a review payload gaining an avatar is an ordinary feature.
 *
 * This asserts the property rather than the deletion: hand the component a review that *does* carry
 * a hostile `user_avatar` and require that nothing renders it. Re-adding the branch fails here even
 * if it is written differently the second time.
 */

const HOSTILE_AVATAR = 'https://evil.example/steal.png?x=1';

const review = (overrides = {}) => ({
  id: 1,
  rating: 5,
  comment: 'Beautiful place, worth the drive.',
  user_name: 'Tom Traveller',
  created_at: '2026-01-15T10:00:00.000Z',
  ...overrides
});

const renderReviews = (rows) =>
  render(<MagazineReviews reviews={rows} onReportReview={jest.fn()} onDeleteReview={jest.fn()} />);

describe('a review author avatar is never rendered as an image (SECURITY_AUDIT L8)', () => {
  test('a hostile user_avatar reaches no img element', () => {
    renderReviews([review({ user_avatar: HOSTILE_AVATAR })]);

    for (const img of screen.queryAllByRole('img')) {
      expect(img.getAttribute('src') || '').not.toContain('evil.example');
    }
    expect(document.body.innerHTML).not.toContain('evil.example');
  });

  test('the review itself did render, or the assertion above is vacuous', () => {
    // The trap this guards against: a component that throws or renders nothing would pass the
    // check above while proving nothing at all.
    renderReviews([review({ user_avatar: HOSTILE_AVATAR })]);
    expect(screen.getByText('Tom Traveller')).toBeInTheDocument();
    expect(screen.getByText(/Beautiful place/)).toBeInTheDocument();
  });

  test('a review with no avatar field renders identically', () => {
    // The property is "no avatar is ever rendered", not "hostile avatars are filtered" — so the
    // presence of the field must make no difference to the output at all.
    const { container: withField } = renderReviews([review({ user_avatar: HOSTILE_AVATAR })]);
    const withFieldHtml = withField.innerHTML;

    document.body.innerHTML = '';
    const { container: without } = renderReviews([review()]);

    expect(without.innerHTML).toBe(withFieldHtml);
  });
});
