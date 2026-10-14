/**
 * MapControls' stylesheet (`IMP-132`).
 *
 * Split out of `mapStyles.js` for the reason recorded in `sidebarStyles.js`: these rules were
 * scoped to `ExploreMap` and addressed to markup `MapControls` renders, so they matched nothing.
 * The rules are unchanged; they are now rendered by the component that owns the elements.
 *
 * This half carries the responsive block: both `@media` queries in the original were almost
 * entirely about the control clusters, and their rules follow their selectors here.
 */
import css from 'styled-jsx/css';

export const controlsStyles = css`
  .search-container :global(.search-icon) {
    position: absolute;
    left: 1.5rem;
    top: 50%;
    transform: translateY(-50%);
    color: #9ca3af;
    pointer-events: none;
  }
  .clear-search {
    position: absolute;
    right: 1.5rem;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    cursor: pointer;
    color: #9ca3af;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
  }
  .clear-search:hover {
    color: #4b5563;
  }
  .map-control {
    position: absolute;
    z-index: 500;
  }
  .map-control.top-left {
    top: 1rem;
    left: 1rem;
    display: flex;
    align-items: center;
  }
  .map-control.top-right {
    top: 1rem;
    right: 1rem;
    display: flex;
    gap: 0.5rem;
  }
  .map-control.bottom-center {
    bottom: 1rem;
    left: 50%;
    transform: translateX(-50%);
  }
  .map-control.custom-zoom {
    top: 50%;
    right: 1rem;
    transform: translateY(-50%);
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .map-control.geolocate-control {
    bottom: 5rem;
    right: 1rem;
    width: 40px;
    height: 40px;
    background-color: white;
    border-radius: 4px;
    box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.1);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border: none;
    color: #4b5563;
    transition: background-color 0.2s;
  }
  .map-control.geolocate-control:hover {
    background-color: #f9fafb;
  }
  .search-container {
    position: relative;
    margin-right: 0.5rem;
  }
  .search-input {
    width: 240px;
    padding: 0.5rem 2.5rem 0.5rem 2.5rem;
    border: none;
    border-radius: 9999px;
    background-color: white;
    font-size: 0.875rem;
    box-shadow:
      0 1px 3px rgba(0, 0, 0, 0.1),
      0 1px 2px rgba(0, 0, 0, 0.06);
    transition:
      width 0.2s,
      box-shadow 0.2s;
  }
  .search-input:focus {
    outline: none;
    width: 280px;
    box-shadow:
      0 4px 6px -1px rgba(0, 0, 0, 0.1),
      0 2px 4px -1px rgba(0, 0, 0, 0.06);
  }
  .control-button {
    background-color: white;
    border: none;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.5rem 0.75rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: #4b5563;
    cursor: pointer;
    box-shadow:
      0 1px 3px rgba(0, 0, 0, 0.1),
      0 1px 2px rgba(0, 0, 0, 0.06);
    transition: background-color 0.2s;
  }
  .control-button:hover {
    background-color: #f9fafb;
  }
  .control-button svg {
    margin-right: 0.5rem;
  }
  .control-button.sidebar-toggle svg {
    font-size: 1rem;
  }
  .control-button.layers-button {
    padding: 0.5rem;
    margin-right: 0.5rem;
  }
  .control-button.fullscreen-button {
    padding: 0.5rem;
    width: 40px;
    height: 40px;
  }
  .control-button.fullscreen-button svg {
    margin-right: 0;
  }
  .map-style-switcher {
    position: relative;
  }
  .map-style-switcher :global(.map-style-dropdown) {
    position: absolute;
    top: calc(100% + 0.5rem);
    right: 0;
    background-color: white;
    border-radius: 0.5rem;
    box-shadow:
      0 10px 15px -3px rgba(0, 0, 0, 0.1),
      0 4px 6px -2px rgba(0, 0, 0, 0.05);
    width: 200px;
    z-index: 30;
    overflow: hidden;
  }
  .style-option {
    display: flex;
    align-items: center;
    padding: 0.75rem 1rem;
    cursor: pointer;
    background: none;
    border: none;
    width: 100%;
    text-align: left;
    font-size: 0.875rem;
    color: #4b5563;
    transition: background-color 0.2s;
  }
  .style-option:hover {
    background-color: #f3f4f6;
  }
  .style-option.active {
    background-color: #eef2ff;
    color: #4f46e5;
    font-weight: 500;
  }
  .style-option svg {
    margin-right: 0.75rem;
    font-size: 1.125rem;
  }
  .style-option :global(.check-icon) {
    margin-left: auto;
    color: #4f46e5;
  }
  .style-dropdown-footer {
    padding: 0.75rem 1rem;
    border-top: 1px solid #e5e7eb;
    background-color: #f9fafb;
  }
  .cluster-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    background: none;
    border: none;
    padding: 0;
    font-size: 0.875rem;
    color: #4b5563;
    cursor: pointer;
  }
  .toggle-switch {
    width: 36px;
    height: 20px;
    background-color: #e5e7eb;
    border-radius: 9999px;
    position: relative;
    transition: background-color 0.2s;
  }
  .toggle-switch.on {
    background-color: #4f46e5;
  }
  .toggle-handle {
    width: 16px;
    height: 16px;
    background-color: white;
    border-radius: 50%;
    position: absolute;
    top: 2px;
    left: 2px;
    transition: transform 0.2s;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  }
  .toggle-switch.on .toggle-handle {
    transform: translateX(16px);
  }
  .map-stats {
    display: flex;
    align-items: center;
    gap: 1rem;
    background-color: rgba(255, 255, 255, 0.8);
    padding: 0.25rem 0.75rem;
    border-radius: 9999px;
    font-size: 0.75rem;
    backdrop-filter: blur(4px);
    color: #4b5563;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }
  .stat {
    display: flex;
    align-items: center;
    font-weight: 500;
  }
  .stat :global(.stat-icon) {
    margin-right: 0.25rem;
    font-size: 0.875rem;
  }
  .zoom-button {
    width: 40px;
    height: 40px;
    background-color: white;
    border: none;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #4b5563;
    font-size: 1.125rem;
    cursor: pointer;
    box-shadow:
      0 1px 3px rgba(0, 0, 0, 0.1),
      0 1px 2px rgba(0, 0, 0, 0.06);
    transition: background-color 0.2s;
  }
  .zoom-button:hover {
    background-color: #f9fafb;
  }
  @media (max-width: 768px) {
    .map-control.top-left {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.5rem;
    }
    .search-container {
      margin-right: 0;
      margin-bottom: 0.5rem;
    }
    .search-input {
      width: 180px;
    }
    .search-input:focus {
      width: 220px;
    }
    .control-button span {
      display: none;
    }
    .control-button svg {
      margin-right: 0;
    }
    .map-stats {
      display: none;
    }
    .custom-zoom {
      right: 0.5rem;
    }
    .map-control.geolocate-control {
      bottom: 4rem;
      right: 0.5rem;
    }
  }
  @media (max-width: 480px) {
    .map-control.top-left,
    .map-control.top-right {
      top: 0.5rem;
    }
    .map-control.top-left {
      left: 0.5rem;
    }
    .map-control.top-right {
      right: 0.5rem;
    }
    .search-input {
      width: 150px;
      padding: 0.375rem 2rem 0.375rem 2rem;
    }
    .search-input:focus {
      width: 180px;
    }
    .custom-zoom {
      display: none;
    }
  }
`;
