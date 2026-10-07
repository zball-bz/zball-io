// The book's module (#use): its own rule, and an import of its own — the
// page loads lib/util.mjs beside it.
import { NOTE } from './util.mjs';

export default function ($) {
  $.set({ kind: 'heading', level: 2 }, { color: '#2f5d8a' });
}
export const note = NOTE;
