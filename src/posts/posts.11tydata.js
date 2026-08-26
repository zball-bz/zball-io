export default {
  layout: 'post.njk',
  tags: ['post'],
  permalink: (data) => `/p/${data.page.fileSlug}/`,
};
