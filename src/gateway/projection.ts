// Response projection - filter data by dot-separated paths
// Data plane component

export function project(data: unknown, paths: string[]): unknown {
  if (!paths || paths.length === 0) {
    return data;
  }

  if (data === null || data === undefined) {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(item => project(item, paths));
  }

  if (typeof data === 'object') {
    const result: Record<string, unknown> = {};

    for (const path of paths) {
      const segments = path.split('.');
      let current: unknown = data;
      let currentResult: Record<string, unknown> = result;

      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];

        if (typeof current !== 'object' || current === null) {
          break;
        }

        const value = (current as Record<string, unknown>)[segment];
        if (value === undefined) {
          break;
        }

        if (i === segments.length - 1) {
          // Last segment - set the value
          currentResult[segment] = value;
        } else {
          // Intermediate segment - ensure structure exists
          if (currentResult[segment] === undefined) {
            currentResult[segment] = {};
          }
          if (typeof currentResult[segment] !== 'object' || currentResult[segment] === null) {
            break;
          }
          currentResult = currentResult[segment] as Record<string, unknown>;
          current = value;
        }
      }
    }

    return result;
  }

  return data;
}
