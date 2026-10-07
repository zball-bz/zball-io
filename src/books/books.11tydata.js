// The books' pages (lib/books.mjs): a page's engine output (tsr: the
// layout's head), its title and, for a draft, noindex.
export default {
  eleventyExcludeFromCollections: true,
  eleventyComputed: {
    tsr: (data) => data.bp?.tsr,
    robots: (data) => (data.bp?.draft ? 'noindex' : undefined),
  },
};
