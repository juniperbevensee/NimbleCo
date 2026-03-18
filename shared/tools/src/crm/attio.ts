// Direct Attio API integration - no abstraction layer
// Based on Attio's actual API (https://developers.attio.com)

import { Tool, ToolContext } from '../base';

// Use built-in fetch (Node 18+)
const fetch = global.fetch || require('node-fetch');

interface AttioConfig {
  apiKey: string;
  baseUrl?: string;
}

class AttioClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: AttioConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.attio.com/v2';
  }

  private async request(method: string, path: string, body?: any) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Attio API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  async findPerson(email: string) {
    return this.request('GET', `/people?email=${encodeURIComponent(email)}`);
  }

  async updatePerson(personId: string, attributes: Record<string, any>) {
    return this.request('PATCH', `/people/${personId}`, {
      data: { attributes }
    });
  }

  async createNote(parentId: string, content: string) {
    return this.request('POST', '/notes', {
      parent: { person_id: parentId },
      content: { text: content }
    });
  }

  async searchCompanies(query: string) {
    return this.request('POST', '/companies/query', {
      filter: {
        name: { $contains: query }
      }
    });
  }

  async linkPersonToCompany(personId: string, companyId: string) {
    return this.request('POST', '/relationships', {
      source: { person_id: personId },
      target: { company_id: companyId },
      type: 'works_at'
    });
  }
}

// Tool definitions - direct and practical

export const updateAttioPerson: Tool = {
  name: 'update_attio_person',
  description: 'Update a person\'s profile in Attio CRM. Use this when you need to record information about a contact (job title, company, notes, etc).',
  category: 'crm',
  requiredEnv: ['ATTIO_API_KEY'],
  use_cases: [
    'recording contact information',
    'updating person details',
    'adding job title or company',
    'logging interaction with contact'
  ],
  parameters: {
    type: 'object',
    properties: {
      email: {
        type: 'string',
        description: 'Email address of the person to update'
      },
      attributes: {
        type: 'object',
        description: 'Fields to update (e.g., {"job_title": "CEO", "company": "Acme Corp"})',
        additionalProperties: true
      }
    },
    required: ['email', 'attributes']
  },

  async handler(input, ctx: ToolContext) {
    const client = new AttioClient({
      apiKey: ctx.credentials.ATTIO_API_KEY
    });

    // Find person by email
    const search = await client.findPerson(input.email) as any;
    if (!search.data || search.data.length === 0) {
      return {
        success: false,
        error: `Person with email ${input.email} not found in Attio`
      };
    }

    const personId = search.data[0].id;

    // Update attributes
    const result = await client.updatePerson(personId, input.attributes);

    return {
      success: true,
      person_id: personId,
      updated_fields: Object.keys(input.attributes),
      message: `Updated ${input.email} in Attio`
    };
  }
};

export const addAttioNote: Tool = {
  name: 'add_attio_note',
  description: 'Add a note to a person\'s profile in Attio. Use this to log conversations, meetings, or important context.',
  category: 'crm',
  requiredEnv: ['ATTIO_API_KEY'],
  use_cases: [
    'logging conversation',
    'recording meeting notes',
    'adding context to contact',
    'documenting interaction'
  ],
  parameters: {
    type: 'object',
    properties: {
      email: {
        type: 'string',
        description: 'Email of the person to add note to'
      },
      note: {
        type: 'string',
        description: 'Note content (supports markdown)'
      }
    },
    required: ['email', 'note']
  },

  async handler(input, ctx: ToolContext) {
    const client = new AttioClient({
      apiKey: ctx.credentials.ATTIO_API_KEY
    });

    const search = await client.findPerson(input.email) as any;
    if (!search.data || search.data.length === 0) {
      return {
        success: false,
        error: `Person with email ${input.email} not found`
      };
    }

    const personId = search.data[0].id;
    await client.createNote(personId, input.note);

    return {
      success: true,
      message: `Added note to ${input.email}'s profile`
    };
  }
};

export const linkAttioPersonCompany: Tool = {
  name: 'link_attio_person_company',
  description: 'Link a person to a company in Attio (creates "works at" relationship)',
  category: 'crm',
  requiredEnv: ['ATTIO_API_KEY'],
  use_cases: [
    'associating contact with company',
    'recording employment',
    'linking person to organization'
  ],
  parameters: {
    type: 'object',
    properties: {
      person_email: { type: 'string' },
      company_name: { type: 'string', description: 'Company name (will search Attio)' }
    },
    required: ['person_email', 'company_name']
  },

  async handler(input, ctx: ToolContext) {
    const client = new AttioClient({
      apiKey: ctx.credentials.ATTIO_API_KEY
    });

    // Find person
    const personSearch = await client.findPerson(input.person_email) as any;
    if (!personSearch.data || personSearch.data.length === 0) {
      return { success: false, error: 'Person not found' };
    }
    const personId = personSearch.data[0].id;

    // Find company
    const companySearch = await client.searchCompanies(input.company_name) as any;
    if (!companySearch.data || companySearch.data.length === 0) {
      return { success: false, error: 'Company not found' };
    }
    const companyId = companySearch.data[0].id;

    // Create relationship
    await client.linkPersonToCompany(personId, companyId);

    return {
      success: true,
      message: `Linked ${input.person_email} to ${input.company_name}`
    };
  }
};

// Export all Attio tools
export const attioTools = [
  updateAttioPerson,
  addAttioNote,
  linkAttioPersonCompany
];
