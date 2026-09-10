// Generated capability: pickup-deliver-in-place
// The trace shows pickup set carriedBy on parcel-1, the move right was blocked as not walkable and was not part of the successful path, and putdown on the type-3 tile removed the parcel, converted its 7 reward into a score of 14 (double delivery), and set achieved to true. The program therefore returns exactly the two action objects seen in the successful sequence, pickup followed by putdown, with no added actions or invented semantics.
export default (context) => [{kind:'pickup'},{kind:'putdown'}];
