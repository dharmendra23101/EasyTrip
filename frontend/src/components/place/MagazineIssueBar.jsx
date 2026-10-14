/** The masthead strip between the hero and the article. */
export const MagazineIssueBar = ({ currentUser }) => (
  <div className="bg-gradient-to-r from-gray-900 to-indigo-900 text-white py-3 border-y border-gray-800">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex justify-between items-center text-sm">
      <div className="flex items-center space-x-4">
        <span className="font-serif">EasyTrip Travel Magazine</span>
        <span className="hidden md:inline-block">•</span>
        <span className="hidden md:inline-block">September 2025 Edition</span>
      </div>
      {currentUser && (
        <div className="flex items-center space-x-4">
          <span className="hidden md:inline-block">Signed in as</span>
          <span>{currentUser.displayName || currentUser.email}</span>
        </div>
      )}
    </div>
  </div>
);
