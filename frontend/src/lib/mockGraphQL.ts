// Sample multi-file schema served by the browser mock's ScanGraphQLFiles.
// It exercises what the GraphQL map handles: extensions across files, an
// interface, a union, enums, inputs, Relay connections and a broken file.
import type { GraphQLFile } from "./contracts"

const files: Record<string, string> = {
  "schema/schema.graphql": `schema {
  query: Query
  mutation: Mutation
}

"""The root of all reads."""
type Query {
  "Fetches an object given its ID."
  node(id: ID!): Node
  viewer: User!
  user(login: String!): User
  repository(owner: String!, name: String!): Repository
  search(query: String!, type: SearchType!, first: Int = 10): [SearchResult!]!
}

type Mutation

interface Node {
  id: ID!
}

type PageInfo {
  hasNextPage: Boolean!
  hasPreviousPage: Boolean!
  startCursor: String
  endCursor: String
}

scalar DateTime
scalar URI
`,
  "schema/users/user.graphql": `"""A person with an account."""
type User implements Node & Actor {
  id: ID!
  login: String!
  name: String
  avatarUrl(size: Int): URI!
  createdAt: DateTime!
  repositories(first: Int, after: String, orderBy: RepositoryOrder): RepositoryConnection!
  organizations: [Organization!]!
  status: UserStatus
}

interface Actor {
  login: String!
  avatarUrl(size: Int): URI!
}

type Organization implements Node & Actor {
  id: ID!
  login: String!
  avatarUrl(size: Int): URI!
  members(first: Int, after: String): UserConnection!
}

type UserStatus {
  emoji: String
  message: String
  expiresAt: DateTime
}

type UserConnection {
  edges: [UserEdge]
  pageInfo: PageInfo!
  totalCount: Int!
}

type UserEdge {
  cursor: String!
  node: User
}

extend type Mutation {
  "Updates the viewer's status."
  changeUserStatus(input: ChangeUserStatusInput!): UserStatus
}

input ChangeUserStatusInput {
  emoji: String
  message: String
  expiresAt: DateTime
}
`,
  "schema/repos/repository.graphql": `type Repository implements Node {
  id: ID!
  name: String!
  description: String
  owner: Actor!
  isPrivate: Boolean!
  primaryLanguage: Language
  issues(first: Int, after: String, states: [IssueState!]): IssueConnection!
  stargazerCount: Int!
  "Use stargazerCount instead."
  stars: Int @deprecated(reason: "Use stargazerCount.")
}

type Language {
  name: String!
  color: String
}

type Issue implements Node {
  id: ID!
  title: String!
  body: String
  state: IssueState!
  author: Actor
  repository: Repository!
  createdAt: DateTime!
}

enum IssueState {
  OPEN
  CLOSED
}

type RepositoryConnection {
  edges: [RepositoryEdge]
  pageInfo: PageInfo!
  totalCount: Int!
}

type RepositoryEdge {
  cursor: String!
  node: Repository
}

type IssueConnection {
  edges: [IssueEdge]
  pageInfo: PageInfo!
  totalCount: Int!
}

type IssueEdge {
  cursor: String!
  node: Issue
}

input RepositoryOrder {
  field: RepositoryOrderField!
  direction: OrderDirection!
}

enum RepositoryOrderField {
  CREATED_AT
  NAME
  STARGAZERS
}

enum OrderDirection {
  ASC
  DESC
}

extend type Mutation {
  createIssue(input: CreateIssueInput!): Issue
  closeIssue(id: ID!): Issue
}

input CreateIssueInput {
  repositoryId: ID!
  title: String!
  body: String
}
`,
  "schema/search.graphql": `union SearchResult = User | Repository | Issue

enum SearchType {
  USER
  REPOSITORY
  ISSUE
}
`,
  "schema/drafts/broken.graphql": `type Draft {
  id: ID!
  title String
}
`,
}

export function mockGraphQLFiles(): GraphQLFile[] {
  return Object.entries(files).map(([path, content]) => ({ path, content, size: content.length }))
}
