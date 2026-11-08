// Risk classification based on HTTP method
// Control plane component

import type { Risk } from '../types.js';

export function calculateRisk(method: string): Risk {
  switch (method.toUpperCase()) {
    case 'GET':
    case 'HEAD':
      return 'read';
    case 'POST':
    case 'PUT':
    case 'PATCH':
      return 'write';
    case 'DELETE':
      return 'destructive';
    default:
      return 'read';
  }
}
