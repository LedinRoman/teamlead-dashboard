export interface ApiErrorBody {
  error: string;
  detail?: string;
  code: 'not-connected' | 'scope' | 'jira' | 'bad-request' | 'server' | 'unauthorized';
}
