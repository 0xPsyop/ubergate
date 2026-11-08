// Response projection - filter data by dot-separated paths
// Data plane component

export function project(data: unknown, paths: string[]): unknown {
  if (!paths || paths.length === 0) {
    return data;
  }

  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data !== 'object') {
    return data;
  }

  function applyPath(target: any, source: any, segments: string[]): void {
    if (source === null || source === undefined) {
      return;
    }

    if (Array.isArray(source)) {
      for (let i = 0; i < source.length; i++) {
        if (!target[i]) {
          target[i] = Array.isArray(source[i]) ? [] : {};
        }
        applyPath(target[i], source[i], segments);
      }
      return;
    }

    if (typeof source !== 'object') {
      return;
    }

    const [head, ...tail] = segments;
    if (!(head in source)) {
      return;
    }

    if (tail.length === 0) {
      target[head] = source[head];
    } else {
      if (!(head in target)) {
        target[head] = Array.isArray(source[head]) ? [] : {};
      }
      applyPath(target[head], source[head], tail);
    }
  }

  if (Array.isArray(data)) {
    return data.map(item => project(item, paths));
  }

  const result: Record<string, unknown> = {};
  for (const path of paths) {
    applyPath(result, data, path.split('.'));
  }

  return result;
}
