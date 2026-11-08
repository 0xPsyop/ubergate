import * as fs from 'fs';

if (fs.existsSync('dist/src/index.js')) {
  fs.writeFileSync('dist/index.js', 'export * from "./src/index.js";\n');
  fs.mkdirSync('dist/cli', { recursive: true });
  fs.writeFileSync('dist/cli/index.js', '#!/usr/bin/env node\nimport "../src/cli/index.js";\n');
}
