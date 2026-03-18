/**
 * GitHub API Tools
 * Direct access to GitHub for repository management, PR reviews, etc.
 */

import { Tool, ToolContext } from '../base';
import { z } from 'zod';
import { Octokit } from '@octokit/rest';

function getOctokit(context: ToolContext): Octokit {
  const token = context.credentials.github_token || process.env.GITHUB_TOKEN;

  if (!token) {
    throw new Error('GitHub token not configured. Set GITHUB_TOKEN in environment or credentials.');
  }

  return new Octokit({ auth: token });
}

// List repositories
const listReposTool: Tool = {
  name: 'github_list_repos',
  description: 'List GitHub repositories accessible to the authenticated user',
  use_cases: [
    'Show me my GitHub repositories',
    'What repos do I have access to?',
    'List all repositories',
  ],
  category: 'code',
  requiredEnv: ['GITHUB_TOKEN'],
  parameters: {
    type: 'object',
    properties: {
      visibility: {
        type: 'string',
        enum: ['all', 'public', 'private'],
        description: 'Filter by visibility',
        default: 'all',
      },
      sort: {
        type: 'string',
        enum: ['created', 'updated', 'pushed', 'full_name'],
        description: 'Sort order',
        default: 'updated',
      },
      per_page: {
        type: 'number',
        description: 'Number of results per page (max 100)',
        default: 30,
      },
    },
  },
  handler: async (input, context) => {
    const octokit = getOctokit(context);

    const { data } = await octokit.repos.listForAuthenticatedUser({
      visibility: input.visibility || 'all',
      sort: input.sort || 'updated',
      per_page: input.per_page || 30,
    });

    return {
      success: true,
      count: data.length,
      repositories: data.map(repo => ({
        name: repo.name,
        full_name: repo.full_name,
        description: repo.description,
        private: repo.private,
        url: repo.html_url,
        language: repo.language,
        stars: repo.stargazers_count,
        updated_at: repo.updated_at,
      })),
    };
  },
};

// Get repository details
const getRepoTool: Tool = {
  name: 'github_get_repo',
  description: 'Get detailed information about a specific GitHub repository',
  use_cases: [
    'Show me details about repository X',
    'Get info about owner/repo',
  ],
  category: 'code',
  requiredEnv: ['GITHUB_TOKEN'],
  parameters: {
    type: 'object',
    properties: {
      owner: {
        type: 'string',
        description: 'Repository owner (username or org)',
      },
      repo: {
        type: 'string',
        description: 'Repository name',
      },
    },
    required: ['owner', 'repo'],
  },
  handler: async (input, context) => {
    const octokit = getOctokit(context);

    const { data } = await octokit.repos.get({
      owner: input.owner,
      repo: input.repo,
    });

    return {
      success: true,
      repository: {
        name: data.name,
        full_name: data.full_name,
        description: data.description,
        private: data.private,
        url: data.html_url,
        language: data.language,
        stars: data.stargazers_count,
        forks: data.forks_count,
        open_issues: data.open_issues_count,
        default_branch: data.default_branch,
        created_at: data.created_at,
        updated_at: data.updated_at,
      },
    };
  },
};

// List pull requests
const listPRsTool: Tool = {
  name: 'github_list_prs',
  description: 'List pull requests for a repository',
  use_cases: [
    'Show open PRs for repo X',
    'List pull requests',
  ],
  category: 'code',
  requiredEnv: ['GITHUB_TOKEN'],
  parameters: {
    type: 'object',
    properties: {
      owner: {
        type: 'string',
        description: 'Repository owner',
      },
      repo: {
        type: 'string',
        description: 'Repository name',
      },
      state: {
        type: 'string',
        enum: ['open', 'closed', 'all'],
        default: 'open',
      },
    },
    required: ['owner', 'repo'],
  },
  handler: async (input, context) => {
    const octokit = getOctokit(context);

    const { data } = await octokit.pulls.list({
      owner: input.owner,
      repo: input.repo,
      state: input.state || 'open',
    });

    return {
      success: true,
      count: data.length,
      pull_requests: data.map(pr => ({
        number: pr.number,
        title: pr.title,
        state: pr.state,
        author: pr.user?.login,
        url: pr.html_url,
        created_at: pr.created_at,
        updated_at: pr.updated_at,
      })),
    };
  },
};

// Search code
const searchCodeTool: Tool = {
  name: 'github_search_code',
  description: 'Search for code across GitHub repositories',
  use_cases: [
    'Search for function X in my repos',
    'Find code containing Y',
  ],
  category: 'code',
  requiredEnv: ['GITHUB_TOKEN'],
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query (use GitHub search syntax)',
      },
      per_page: {
        type: 'number',
        default: 30,
      },
    },
    required: ['query'],
  },
  handler: async (input, context) => {
    const octokit = getOctokit(context);

    const { data } = await octokit.search.code({
      q: input.query,
      per_page: input.per_page || 30,
    });

    return {
      success: true,
      total_count: data.total_count,
      results: data.items.map(item => ({
        name: item.name,
        path: item.path,
        repository: item.repository.full_name,
        url: item.html_url,
      })),
    };
  },
};

export const githubTools: Tool[] = [
  listReposTool,
  getRepoTool,
  listPRsTool,
  searchCodeTool,
];
