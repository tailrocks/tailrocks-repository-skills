// Read queries of the thread triage. Library constants: a query never takes caller text.
// None of them holds a mutation. The mutations live in lib/safety-gh.ts.

const COMMENT_FIELDS = "author { login __typename } body url";

/** Every review thread of a PR with its first comment and its latest comments. */
export const THREAD_DETAILS_QUERY = `
query($id: ID!, $after: String) {
  node(id: $id) { ... on PullRequest {
    reviewThreads(first: 50, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id isResolved isOutdated path line
        first: comments(first: 1) { totalCount nodes { ${COMMENT_FIELDS} } }
        recent: comments(last: 30) { nodes { ${COMMENT_FIELDS} } }
      }
    }
  } }
}`;

/** The head commit and the state of a PR. Read before each write. */
export const PR_HEAD_QUERY = `
query($id: ID!) {
  node(id: $id) { ... on PullRequest { state headRefOid } }
}`;
