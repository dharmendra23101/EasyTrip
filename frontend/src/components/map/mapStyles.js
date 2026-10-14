/**
 * ExploreMap's own stylesheet, plus the global half (`IMP-070`, split by `IMP-132`).
 *
 * **What changed in `IMP-132`, and why the file is a third of its old size.** This was 1,013 lines
 * describing three components, rendered by one of them. styled-jsx scopes `<style jsx>` to the
 * elements the rendering component's own JSX returns, so roughly 480 of those lines — everything
 * addressed to `MapSidebar` and `MapControls` — were emitted against markup that never carried the
 * scoping class and therefore styled nothing at all. Measured before the change: of 785 elements on
 * the page, exactly **2** were scoped, and both are rendered here (`.map-wrapper`, `.map-container`).
 *
 * The sidebar's rules now live in `sidebarStyles.js` and the controls' in `controlsStyles.js`, each
 * rendered by the component that owns the markup. No rule was rewritten; they were moved.
 *
 * **The split the old header said was impossible.** It recorded that three rules were declared twice
 * at equal specificity and that separating the sheets "would silently drop those inherited
 * declarations". That reasoning assumed the rules were reaching elements and merging through the
 * cascade. They were not, so there was nothing to drop — and each duplicate simply returns to the
 * panel it was written for.
 *
 * **The two blocks are still not interchangeable.** `mapStyles` is scoped: it styles the wrapper,
 * the loading state and the error state, which is markup this component renders directly.
 * `mapGlobal` is not scoped, because it styles DOM **Leaflet** creates imperatively through
 * `L.divIcon` and `bindPopup` — marker pins, cluster bubbles, popups, tooltips. Those nodes never
 * pass through React, so a scoped rule would match nothing. That boundary is unchanged.
 *
 * `css` and `css.global` from `styled-jsx/css` are what make an external file work at all: a plain
 * template string handed to `<style jsx>` is not transformed, and the scoping would be lost.
 */
import css from 'styled-jsx/css';

/** Scoped — the wrapper, the loading state and the error state, all rendered by ExploreMap. */
export const mapStyles = css`
  .map-wrapper {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: 0.75rem;
    box-shadow:
      0 4px 6px -1px rgba(0, 0, 0, 0.1),
      0 2px 4px -1px rgba(0, 0, 0, 0.06);
  }
  .map-wrapper.fullscreen {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100vw;
    height: 100vh;
    z-index: 9999;
    border-radius: 0;
  }
  .map-container {
    width: 100%;
    height: 100%;
    background-color: #f3f4f6;
  }
  .map-loading {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background-color: rgba(255, 255, 255, 0.9);
    z-index: 10;
    backdrop-filter: blur(4px);
  }
  .loading-spinner {
    width: 40px;
    height: 40px;
    border: 3px solid #e5e7eb;
    border-top-color: #4f46e5;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 1rem;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .map-error-container {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: #f3f4f6;
    border-radius: 0.75rem;
  }
  .map-error {
    background-color: white;
    padding: 2rem;
    border-radius: 0.5rem;
    box-shadow:
      0 4px 6px -1px rgba(0, 0, 0, 0.1),
      0 2px 4px -1px rgba(0, 0, 0, 0.06);
    text-align: center;
    max-width: 400px;
  }
  .error-icon {
    font-size: 2.5rem;
    color: #ef4444;
    margin-bottom: 1rem;
  }
  .map-error h3 {
    font-size: 1.25rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
    color: #1f2937;
  }
  .map-error p {
    color: #6b7280;
    margin-bottom: 1.5rem;
  }
  .map-error button {
    background-color: #4f46e5;
    color: white;
    border: none;
    padding: 0.5rem 1.5rem;
    border-radius: 0.375rem;
    font-weight: 500;
    display: inline-flex;
    align-items: center;
    cursor: pointer;
    transition: background-color 0.2s;
  }
  .map-error button:hover {
    background-color: #4338ca;
  }
  .refresh-icon {
    margin-right: 0.5rem;
  }
  @media (max-width: 768px) {
    .map-wrapper {
      border-radius: 0.5rem;
    }
  }
`;

/** Global — applies to the DOM Leaflet builds, which React never touches. */
export const mapGlobal = css.global`
  /* Custom marker styling */
  .custom-marker-icon {
    background: none;
    border: none;
  }

  .marker-pin {
    width: 30px;
    height: 42px;
    background-color: #4f46e5;
    border-radius: 50% 50% 50% 0;
    transform: rotate(-45deg);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
    border: 2px solid white;
    position: relative;
  }

  .marker-pin.selected {
    background-color: #ef4444;
    transform: rotate(-45deg) scale(1.2);
    z-index: 1000 !important;
  }

  .marker-icon {
    transform: rotate(45deg);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .rating {
    transform: rotate(45deg);
    color: white;
    font-weight: bold;
    font-size: 12px;
    display: flex;
    align-items: center;
  }

  .rating svg {
    margin-right: 2px;
  }

  .marker-pulse {
    position: absolute;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background-color: rgba(239, 68, 68, 0.4);
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: -1;
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0% {
      transform: translate(-50%, -50%) scale(0.5);
      opacity: 1;
    }
    70% {
      opacity: 0.2;
    }
    100% {
      transform: translate(-50%, -50%) scale(1.5);
      opacity: 0;
    }
  }

  /* Cluster marker styling */
  .cluster-marker {
    background-color: #4f46e5;
    color: white;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
    border: 3px solid white;
  }

  .cluster-marker.small {
    width: 40px;
    height: 40px;
    font-size: 14px;
  }

  .cluster-marker.medium {
    width: 50px;
    height: 50px;
    font-size: 16px;
  }

  .cluster-marker.large {
    width: 60px;
    height: 60px;
    font-size: 18px;
  }

  /* Custom popup styling */
  .leaflet-popup-content-wrapper {
    padding: 0;
    overflow: hidden;
    border-radius: 8px;
    box-shadow:
      0 4px 6px -1px rgba(0, 0, 0, 0.1),
      0 2px 4px -1px rgba(0, 0, 0, 0.06);
  }

  .leaflet-popup-content {
    margin: 0;
    width: 280px !important;
  }

  .leaflet-popup-tip {
    background-color: white;
  }

  .custom-popup {
    width: 100%;
  }

  .popup-header {
    background-color: #4f46e5;
    color: white;
    padding: 12px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .popup-header h3 {
    font-size: 16px;
    font-weight: 600;
    margin: 0;
  }

  .popup-header .rating {
    background-color: rgba(255, 255, 255, 0.2);
    padding: 2px 8px;
    border-radius: 20px;
    font-size: 12px;
    display: flex;
    align-items: center;
    transform: none;
  }

  .popup-body {
    padding: 12px 16px;
    background-color: white;
  }

  .popup-body p {
    margin: 0 0 8px;
    font-size: 14px;
    color: #4b5563;
  }

  .popup-body .description {
    color: #6b7280;
    font-size: 13px;
    line-height: 1.4;
  }

  .popup-footer {
    padding: 12px 16px;
    background-color: #f9fafb;
    border-top: 1px solid #e5e7eb;
    display: flex;
    justify-content: flex-end;
  }

  .view-button {
    background-color: #4f46e5;
    color: white;
    border: none;
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    text-decoration: none;
    display: inline-block;
    transition: background-color 0.2s;
  }

  .view-button:hover {
    background-color: #4338ca;
    text-decoration: none;
    color: white;
  }

  /* Custom tooltip */
  .custom-tooltip {
    background-color: rgba(0, 0, 0, 0.8);
    border: none;
    border-radius: 4px;
    padding: 4px 8px;
    color: white;
    font-size: 12px;
    font-weight: 500;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  }

  /* Leaflet marker cluster styles */
  .leaflet-marker-cluster {
    background: none !important;
  }

  .leaflet-marker-cluster div {
    background-color: transparent !important;
  }
`;
