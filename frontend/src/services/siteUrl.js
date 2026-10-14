/**
 * The one place the site's own public origin is decided (`IMP-113`).
 *
 * Three things need an **absolute** URL and cannot compute one from a relative path: the `Sitemap:`
 * directive in `robots.txt`, every `<loc>` in `sitemap.xml`, and the canonical / `og:url` tags. A
 * relative URL is invalid in all three by specification.
 *
 * **Why not derive it from the request's `Host` header.** That would need no configuration and is
 * the usual shortcut — and the `Host` header is chosen by the client. A crawler-facing canonical
 * tag or sitemap built from it is host-header injection with a persistence mechanism: poison the
 * header, and the URLs an indexer records point at somebody else's domain. The origin has to come
 * from configuration, not from the request.
 *
 * **Why unset means absent, not a guess.** `PROJECT_CONSTITUTION.md` Article III — a fabricated
 * value is worse than a missing one, and this is the same rule `IMP-110` applies to weather. With
 * no origin configured, `robots.txt` ships without a `Sitemap:` line and the canonical tags are
 * simply not emitted. Both degrade correctly: a crawler that finds no canonical uses the URL it
 * fetched, which is right; a crawler pointed at a canonical on the wrong domain de-indexes the
 * page, which is not.
 */

/** Strip any trailing slash so callers can concatenate `/path` without producing `//path`. */
const normalise = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  // A bare host ("easytrip.example") is not a URL and would produce `<loc>easytrip.example/places/1`,
  // which is invalid in a sitemap. Requiring the scheme makes the misconfiguration visible as an
  // absent canonical rather than as silently malformed XML.
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
};

/**
 * The public origin of this deployment, e.g. `https://easytrip.example`, or `null` when unset.
 *
 * `SITE_URL` is server-only and wins when set, exactly as `API_URL` does in `apiConfig.js`: it is
 * read at runtime rather than inlined at build time, so one built artifact can be deployed to a
 * preview and to production. `NEXT_PUBLIC_SITE_URL` is the browser's only option, since that is the
 * one that survives into the bundle.
 */
export const resolveSiteUrl = () => {
  if (typeof window === 'undefined') {
    return normalise(process.env.SITE_URL) || normalise(process.env.NEXT_PUBLIC_SITE_URL);
  }
  return normalise(process.env.NEXT_PUBLIC_SITE_URL);
};

/** An absolute URL for a path on this site, or `null` when no origin is configured. */
export const absoluteUrl = (path = '/') => {
  const origin = resolveSiteUrl();
  if (!origin) return null;
  return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
};

export { normalise as normaliseSiteUrl };
