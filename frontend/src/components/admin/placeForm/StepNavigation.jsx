import { FiArrowLeft } from 'react-icons/fi';

/**
 * The Previous / Next pair at the foot of a wizard step (`IMP-125`).
 *
 * **Why only two of the four steps use it.** Steps 2 and 3 rendered this block byte-for-byte
 * identically — same container, same two buttons, same fourteen Tailwind classes each — differing
 * only in which step the two `goToStep` calls target and in the Next button's label. That is the
 * whole of the duplication this component removes, and extracting it changes no rendered markup.
 *
 * Steps 1 and 4 are deliberately left alone, because folding them in would *not* be free:
 *
 * - **Step 1** has no Previous button at all. Its container is `flex justify-end` rather than
 *   `flex flex-col sm:flex-row justify-between`, and its Next button carries neither
 *   `justify-center` nor an `order-*` class, because with one child there is nothing to order.
 * - **Step 4** ends the wizard rather than continuing it: Cancel and Submit sit where Next does,
 *   wrapped in their own flex container. Its outer gap is `sm:gap-4` against this component's
 *   `sm:gap-0`, and its Previous button is `order-3` against `order-2` — both consequences of
 *   there being three controls in the row instead of two.
 *
 * Those differences are real rendered output, not accidents of copying, so unifying them would mean
 * choosing which of the two looks is correct. That is a visual decision and it belongs to the
 * pass that makes it deliberately, not to a refactor whose stated contract is that nothing moves.
 */
export const StepNavigation = ({ onPrevious, onNext, nextLabel }) => (
  <div className="mt-6 sm:mt-8 flex flex-col sm:flex-row justify-between gap-3 sm:gap-0">
    <button
      type="button"
      onClick={onPrevious}
      className="inline-flex items-center justify-center px-4 sm:px-6 py-2 sm:py-3 bg-gray-100 text-gray-700 font-medium rounded-xl hover:bg-gray-200 transition-colors text-sm sm:text-base order-2 sm:order-1"
    >
      <FiArrowLeft className="mr-2" />
      Previous
    </button>
    <button
      type="button"
      onClick={onNext}
      className="inline-flex items-center justify-center px-4 sm:px-6 py-2 sm:py-3 bg-primary-600 text-white font-medium rounded-xl hover:bg-primary-700 transition-colors text-sm sm:text-base order-1 sm:order-2"
    >
      {nextLabel}
      <FiArrowLeft className="ml-2 rotate-180" />
    </button>
  </div>
);
