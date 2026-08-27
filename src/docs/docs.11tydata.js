export default {
  layout: 'doc.njk',
  tags: ['doc'],
  permalink: (data) => `/docs/${data.page.fileSlug}/`,
};
