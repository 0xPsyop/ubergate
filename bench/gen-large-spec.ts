// Synthetic OpenAPI spec generator with 30 resources x 4 operations = 120 operations

export function generateLargeOpenApiSpec(): Record<string, unknown> {
  const resourceNames = [
    'users', 'products', 'orders', 'invoices', 'payments',
    'shipments', 'customers', 'tickets', 'reviews', 'comments',
    'notifications', 'subscriptions', 'transactions', 'inventories', 'warehouses',
    'suppliers', 'categories', 'coupons', 'discounts', 'promotions',
    'refunds', 'reports', 'analytics', 'audit_logs', 'webhooks',
    'integrations', 'devices', 'sessions', 'api_keys', 'teams'
  ];

  const paths: Record<string, any> = {};

  for (const resource of resourceNames) {
    const singular = resource.endsWith('ies')
      ? resource.slice(0, -3) + 'y'
      : resource.endsWith('s')
        ? resource.slice(0, -1)
        : resource;

    const capitalizedSingular = singular.charAt(0).toUpperCase() + singular.slice(1);
    const capitalizedPlural = resource.charAt(0).toUpperCase() + resource.slice(1);

    const resourceProperties: Record<string, any> = {
      id: { type: 'string', description: `Unique identifier for the ${singular}` },
      name: { type: 'string', description: `Name or title of the ${singular}` },
      status: { type: 'string', enum: ['active', 'pending', 'archived', 'deleted'], description: 'Current lifecycle status' },
      created_at: { type: 'string', format: 'date-time', description: 'Timestamp when created' },
      updated_at: { type: 'string', format: 'date-time', description: 'Timestamp when last updated' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Classification tags' },
      metadata: { type: 'object', description: 'Arbitrary key-value metadata store' },
      external_id: { type: 'string', description: 'External third-party identifier' },
    };

    paths[`/${resource}`] = {
      get: {
        operationId: `list${capitalizedPlural}`,
        summary: `List all ${resource}`,
        description: `Retrieve a paginated list of ${resource} with optional filtering and sorting parameters.`,
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 }, description: 'Number of records to return' },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 }, description: 'Pagination offset' },
          { name: 'search', in: 'query', schema: { type: 'string' }, description: 'Text search query across name and tags' },
          { name: 'sort_by', in: 'query', schema: { type: 'string', default: 'created_at' }, description: 'Field to sort results by' },
        ],
        responses: {
          '200': {
            description: `A list of ${resource}`,
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: resourceProperties,
                  },
                },
              },
            },
          },
        },
      },
      post: {
        operationId: `create${capitalizedSingular}`,
        summary: `Create a new ${singular}`,
        description: `Creates a new ${singular} resource with the provided schema payload and initial metadata.`,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'status'],
                properties: resourceProperties,
              },
            },
          },
        },
        responses: {
          '201': {
            description: `Successfully created ${singular}`,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: resourceProperties,
                },
              },
            },
          },
        },
      },
    };

    paths[`/${resource}/{id}`] = {
      get: {
        operationId: `get${capitalizedSingular}`,
        summary: `Get a single ${singular} by ID`,
        description: `Retrieve comprehensive details for a specific ${singular} using its unique identifier.`,
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: `ID of the ${singular} to fetch` },
        ],
        responses: {
          '200': {
            description: `The requested ${singular} details`,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: resourceProperties,
                },
              },
            },
          },
        },
      },
      delete: {
        operationId: `delete${capitalizedSingular}`,
        summary: `Delete a ${singular} by ID`,
        description: `Permanently deletes the specified ${singular} record from the system.`,
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: `ID of the ${singular} to delete` },
        ],
        responses: {
          '204': {
            description: `${capitalizedSingular} successfully deleted`,
          },
        },
      },
    };
  }

  return {
    openapi: '3.0.0',
    info: {
      title: 'Enterprise Mock API',
      version: '1.0.0',
      description: 'Synthetic enterprise API with 30 resources and 120 endpoints',
    },
    paths,
  };
}
