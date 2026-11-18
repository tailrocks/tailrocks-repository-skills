// GraphQL read queries as library constants. A query never takes caller text.
// None of them holds a mutation.

const CONTEXT_FIELDS = `
  __typename
  ... on CheckRun {
    name status conclusion startedAt completedAt databaseId
    isRequired(pullRequestNumber: $number)
    checkSuite { app { databaseId } workflowRun { event workflow { name } } }
  }
  ... on StatusContext { context state createdAt isRequired(pullRequestNumber: $number) }
`;

const THREAD_FIELDS = `
  id isResolved isOutdated path line
  comments(first: 1) { totalCount nodes { author { login } body } }
  lastComment: comments(last: 1) { nodes { author { login } } }
`;

const REVIEW_FIELDS = `author { login } authorAssociation state body submittedAt commit { oid }`;

const COMMIT_FIELDS = `commit {
  oid message committedDate tree { oid }
  parents(first: 3) { nodes { oid } }
  author { email user { login } }
}`;

/** Everything about one pull request that one request can carry. */
export const PR_QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    nameWithOwner
    defaultBranchRef { name }
    pullRequest(number: $number) {
      id number state isDraft title body
      baseRefName baseRefOid headRefName headRefOid
      headRepository { nameWithOwner }
      isCrossRepository
      author { login }
      mergeable mergeStateStatus reviewDecision
      labels(first: 100) { totalCount nodes { name } }
      mergeQueueEntry { id position state enqueuedAt jump }
      closingIssuesReferences(first: 20) { nodes { number repository { nameWithOwner } } }
      commits(last: 100) {
        totalCount
        pageInfo { hasPreviousPage startCursor }
        nodes { ${COMMIT_FIELDS} }
      }
      latestCommit: commits(last: 1) { nodes { commit {
        id oid
        statusCheckRollup { contexts(first: 100) { totalCount pageInfo { hasNextPage endCursor } nodes { ${CONTEXT_FIELDS} } } }
      } } }
      reviews(last: 100) { totalCount pageInfo { hasPreviousPage startCursor } nodes { ${REVIEW_FIELDS} } }
      latestOpinionatedReviews(writersOnly: true, first: 100) { totalCount nodes { author { login } authorAssociation state commit { oid } } }
      reviewThreads(first: 100) { totalCount pageInfo { hasNextPage endCursor } nodes { ${THREAD_FIELDS} } }
      timelineItems(last: 20, itemTypes: [REMOVED_FROM_MERGE_QUEUE_EVENT]) { nodes {
        __typename
        ... on RemovedFromMergeQueueEvent { createdAt reason beforeCommit { oid } }
      } }
    }
  }
  rateLimit { cost remaining resetAt }
}`;

export const THREADS_PAGE_QUERY = `
query($id: ID!, $after: String) {
  node(id: $id) { ... on PullRequest {
    reviewThreads(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { ${THREAD_FIELDS} } }
  } }
}`;

export const REVIEWS_PAGE_QUERY = `
query($id: ID!, $before: String) {
  node(id: $id) { ... on PullRequest {
    reviews(last: 100, before: $before) { pageInfo { hasPreviousPage startCursor } nodes { ${REVIEW_FIELDS} } }
  } }
}`;

export const COMMITS_PAGE_QUERY = `
query($id: ID!, $before: String) {
  node(id: $id) { ... on PullRequest {
    commits(last: 100, before: $before) { pageInfo { hasPreviousPage startCursor } nodes { ${COMMIT_FIELDS} } }
  } }
}`;

export const CONTEXTS_PAGE_QUERY = `
query($id: ID!, $number: Int!, $after: String) {
  node(id: $id) { ... on Commit {
    statusCheckRollup { contexts(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { ${CONTEXT_FIELDS} } } }
  } }
}`;

/** Facts about the base branch: merge queue, parent PR, and how far the head is behind. */
export const BASE_QUERY = `
query($owner: String!, $name: String!, $base: String!, $qualified: String!, $head: String!) {
  repository(owner: $owner, name: $name) {
    mergeQueue(branch: $base) { id entries(first: 1) { totalCount } }
    ref(qualifiedName: $qualified) { compare(headRef: $head) { behindBy aheadBy } }
    pullRequests(states: OPEN, headRefName: $base, first: 5) { nodes { number headRepository { nameWithOwner } } }
  }
}`;

export const ISSUE_QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issueOrPullRequest(number: $number) { __typename ... on Issue { number state body } }
  }
}`;

export const OPEN_PRS_QUERY = `
query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: 100, after: $after, orderBy: { field: CREATED_AT, direction: ASC }) {
      pageInfo { hasNextPage endCursor }
      nodes { number }
    }
  }
}`;


/** GitHub computes mergeability on demand. A re-read after a short wait often gets the answer. */
export const MERGEABILITY_QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { mergeable mergeStateStatus headRefOid }
  }
}`;
