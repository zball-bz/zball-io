// The book's module (#use): its own rules, and an import of its own — the
// page loads lib/util.mjs beside it.
//   front: a heading that takes no number (the home page's title, the
//   preface), listed in the contents without one; a reference reads its title
import { NOTE } from './util.mjs';

export default function ($, { slot }) {
  $.element('front', {
    like: 'heading', select: [{ node: 'heading', role: 'front' }], numbering: 'never', sites: [],
    ref: [slot('title')],
  });
  $.set({ kind: 'heading', level: 2 }, { color: '#2f5d8a' });
}
export const note = NOTE;
