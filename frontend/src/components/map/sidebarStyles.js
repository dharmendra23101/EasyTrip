/**
 * MapSidebar's stylesheet (`IMP-132`).
 *
 * **These rules used to reach nothing.** They lived in `mapStyles.js`, which `ExploreMap` renders
 * through `<style jsx>`; styled-jsx puts its scoping class only on the elements *that component's
 * own JSX* returns, and `MapSidebar` is a separate component that receives no `className`. So every
 * rule below was emitted as `.place-item.jsx-9c3ddb0b9a7e02c9 { … }` against markup that carried no
 * such class — measured, not assumed: 785 elements in the page, 2 of them scoped, both belonging to
 * `ExploreMap` itself.
 *
 * Moving the block into the component that renders the markup is what makes it apply. The rules are
 * unchanged; only their address is.
 *
 * **Where a class is rendered by both panels**, the split follows what was written rather than a new
 * decision. `.stat` and `.check-icon` were each declared twice — once in this section, once in the
 * controls' — so each half stays with the panel it was written for. `.search-icon` and
 * `.clear-search` were declared once and are used by both, so they are duplicated verbatim into
 * both sheets; a scoped sheet cannot be shared, and dropping either copy would strand one panel's
 * search box.
 */
import css from 'styled-jsx/css';

export const sidebarStyles = css`
  :global(.map-sidebar) {
    position: absolute;
    top: 0;
    right: 0;
    width: 320px;
    height: 100%;
    background-color: white;
    box-shadow: -4px 0 15px rgba(0, 0, 0, 0.1);
    z-index: 1000;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .sidebar-header {
    padding: 1rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid #e5e7eb;
  }
  .sidebar-header h3 {
    font-size: 1.125rem;
    font-weight: 600;
    color: #1f2937;
    display: flex;
    align-items: center;
  }
  .sidebar-header h3 :global(.sidebar-icon) {
    margin-right: 0.5rem;
    color: #4f46e5;
  }
  .close-button {
    background: none;
    border: none;
    cursor: pointer;
    color: #6b7280;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    transition: background-color 0.2s;
  }
  .close-button:hover {
    background-color: #f3f4f6;
    color: #1f2937;
  }
  .sidebar-search {
    padding: 1rem;
    position: relative;
  }
  .sidebar-search-input {
    width: 100%;
    padding: 0.5rem 2.5rem 0.5rem 2.5rem;
    border: 1px solid #e5e7eb;
    border-radius: 9999px;
    background-color: #f9fafb;
    font-size: 0.875rem;
    transition:
      border-color 0.2s,
      box-shadow 0.2s;
  }
  .sidebar-search-input:focus {
    outline: none;
    border-color: #4f46e5;
    box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.2);
    background-color: white;
  }
  .sidebar-search :global(.search-icon) {
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
  .sidebar-stats {
    display: flex;
    justify-content: space-between;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid #e5e7eb;
    background-color: #f9fafb;
  }
  .stat {
    display: flex;
    align-items: center;
    font-size: 0.75rem;
    color: #6b7280;
  }
  .stat-label {
    margin-right: 0.25rem;
  }
  .stat-value {
    font-weight: 600;
    color: #4b5563;
  }
  .sidebar-places {
    flex-grow: 1;
    overflow-y: auto;
    padding: 0.5rem;
  }
  .no-places {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    text-align: center;
    color: #6b7280;
  }
  .no-places :global(.info-icon) {
    font-size: 1.5rem;
    color: #9ca3af;
    margin-bottom: 0.5rem;
  }
  .sidebar-places :global(.place-item) {
    display: flex;
    align-items: center;
    padding: 0.75rem;
    border-radius: 0.5rem;
    margin-bottom: 0.5rem;
    cursor: pointer;
    transition: background-color 0.2s;
    border: 1px solid transparent;
  }
  .sidebar-places :global(.place-item:hover) {
    background-color: #f3f4f6;
  }
  .sidebar-places :global(.place-item.selected) {
    background-color: #eef2ff;
    border-color: #c7d2fe;
  }
  .sidebar-places :global(.place-item.not-visible) {
    opacity: 0.6;
  }
  .place-icon {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: #f3f4f6;
    border-radius: 50%;
    margin-right: 0.75rem;
  }
  .sidebar-places :global(.place-item.selected) .place-icon {
    background-color: #4f46e5;
    color: white;
  }
  .place-icon :global(.visible-icon),
  .place-icon :global(.pin-icon) {
    color: #4b5563;
  }
  .sidebar-places :global(.place-item.selected) .place-icon :global(.visible-icon),
  .sidebar-places :global(.place-item.selected) .place-icon :global(.pin-icon) {
    color: white;
  }
  .place-info {
    flex-grow: 1;
  }
  .place-info h4 {
    font-size: 0.875rem;
    font-weight: 600;
    color: #1f2937;
    margin-bottom: 0.25rem;
  }
  .place-info p {
    font-size: 0.75rem;
    color: #6b7280;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 180px;
  }
  .place-rating {
    display: flex;
    align-items: center;
    font-size: 0.75rem;
    color: #1f2937;
    margin-top: 0.25rem;
  }
  .place-rating :global(.star-icon) {
    color: #fbbf24;
    margin-right: 0.25rem;
  }
  .review-count {
    color: #6b7280;
    margin-left: 0.25rem;
  }
  .place-actions {
    display: flex;
    align-items: center;
  }
  .place-actions :global(.arrow-icon),
  .place-actions :global(.check-icon) {
    color: #6b7280;
  }
  .sidebar-places :global(.place-item.selected) .place-actions :global(.arrow-icon),
  .sidebar-places :global(.place-item.selected) .place-actions :global(.check-icon) {
    color: #4f46e5;
  }
  .sidebar-footer {
    padding: 0.75rem 1rem;
    border-top: 1px solid #e5e7eb;
    font-size: 0.75rem;
    color: #6b7280;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    background-color: #f9fafb;
  }
  .sidebar-footer p {
    display: flex;
    align-items: center;
  }
  .sidebar-footer p :global(.info-icon-small) {
    margin-right: 0.25rem;
    font-size: 0.875rem;
  }
  .attribution {
    display: flex;
    justify-content: space-between;
    color: #9ca3af;
    font-size: 0.7rem;
  }
  @media (max-width: 768px) {
    :global(.map-sidebar) {
      width: 100%;
    }
  }
`;
