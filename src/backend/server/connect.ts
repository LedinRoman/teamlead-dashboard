import { JiraClient, guessDeployment, normalizeBaseUrl } from '@backend/jira/client';
import type { AuthKind, Deployment, FieldMapping } from '@shared/types';
import { ValidationError } from './validate';

export interface ConnectAttemptInput {
  baseUrl: string;
  secret: string;
  email?: string;
  deployment?: Deployment;
  authKind?: AuthKind;
}

export interface ConnectAttemptResult {
  baseUrl: string;
  deployment: Deployment;
  authKind: AuthKind;
  email?: string;
  accountId?: string;
  displayName: string;
  jiraVersion?: string;
  reportedDeployment?: string;
  fieldMapping: FieldMapping;
  warnings: string[];
}

/**
 * Verifies credentials against Jira and discovers the site's custom field ids.
 * Cloud wants email + API token as Basic auth; Server/DC normally wants a
 * personal access token as Bearer.
 */
export async function attemptConnect(input: ConnectAttemptInput): Promise<ConnectAttemptResult> {
  let baseUrl: string;
  try {
    baseUrl = normalizeBaseUrl(input.baseUrl);
  } catch {
    throw new ValidationError(
      `"${input.baseUrl}" is not a usable Jira URL. Use something like https://acme.atlassian.net.`,
    );
  }

  const secret = input.secret.trim();
  if (!secret) throw new ValidationError('An API token or personal access token is required.');

  const deployment = input.deployment ?? guessDeployment(baseUrl);
  const email = input.email?.trim() || undefined;
  const authKind: AuthKind =
    input.authKind ?? (deployment === 'cloud' ? 'basic' : email ? 'basic' : 'bearer');

  if (authKind === 'basic' && !email) {
    throw new ValidationError(
      deployment === 'cloud'
        ? 'Jira Cloud needs the account email that owns the API token.'
        : 'Basic auth needs the account email that owns the API token. Leave the email empty to use a bearer personal access token instead.',
    );
  }

  const client = new JiraClient({ baseUrl, deployment, authKind, email, secret });
  const me = await client.myself();

  const warnings: string[] = [];
  let jiraVersion: string | undefined;
  let reportedDeployment: string | undefined;
  try {
    const info = await client.serverInfo();
    jiraVersion = info.version;
    reportedDeployment = info.deploymentType;
    if (reportedDeployment && reportedDeployment.toLowerCase() !== deployment) {
      warnings.push(
        `Jira reports this site as ${reportedDeployment}, but the connection is set to ${deployment}. Switch the deployment type if metrics look wrong.`,
      );
    }
  } catch {
    warnings.push('Server info was not readable, so the Jira version could not be confirmed.');
  }

  const fieldMapping = await client.detectFieldMapping();
  if (!fieldMapping.storyPointsField) {
    warnings.push('No story points field was found. Metrics will use work item counts until one is selected.');
  }
  if (!fieldMapping.sprintField) {
    warnings.push('No sprint field was found. Sprint framing will be limited to board and sprint scopes.');
  }

  return {
    baseUrl,
    deployment,
    authKind,
    email,
    accountId: me.accountId,
    displayName: me.displayName,
    jiraVersion,
    reportedDeployment,
    fieldMapping,
    warnings,
  };
}
