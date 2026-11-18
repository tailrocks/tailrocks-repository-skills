// Read queries of the thread triage. Library constants: a query never takes caller text.
// None of them holds a mutation. The mutations live in lib/safety-gh.ts.

const COMMENT_FIELDS = "id author { login __typename } body url";
const COMMENTS = `comments(first: 100) { totalCount pageInfo { hasNextPage endCursor } nodes { ${COMMENT_FIELDS} } }`;
const THREAD_FIELDS = `id isResolved isOutdated path line ${COMMENTS}`;

/** Every review thread of a PR with its first 100 comments. A longer thread is read on with THREAD_QUERY. */
export const THREAD_DETAILS_QUERY = `
query($id: ID!, $after: String) {
  node(id: $id) { ... on PullRequest {
    reviewThreads(first: 30, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { ${THREAD_FIELDS} }
    }
  } }
}`;

/** One review thread, with a page of its comments. Read before each write and for long threads. */
export const THREAD_QUERY = `
query($id: ID!, $after: String) {
  node(id: $id) { ... on PullRequestReviewThread {
    id isResolved isOutdated path line
    comments(first: 100, after: $after) { totalCount pageInfo { hasNextPage endCursor } nodes { ${COMMENT_FIELDS} } }
  } }
}`;

/** The head commit and the state of a PR. Read before each write. */
export const PR_HEAD_QUERY = `
query($id: ID!) {
  node(id: $id) { ... on PullRequest { state headRefOid } }
}`;
