import { createServer } from 'node:http';
import { extname, join, relative, resolve, sep } from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';

const args = process.argv.slice(2);

function readOption(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const host = readOption('--host', '0.0.0.0');
const port = Number(readOption('--port', '4174'));
const root = resolve(process.cwd(), readOption('--dir', 'dist'));

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function collectHtmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectHtmlFiles(path)));
    else if (entry.name.endsWith('.html')) files.push(path);
  }
  return files;
}

function createRouteMatcher(filePath) {
  const relativePath = relative(root, filePath).split(sep).join('/');
  const routePath = relativePath === 'index.html'
    ? ''
    : relativePath.endsWith('/index.html')
      ? relativePath.slice(0, -'/index.html'.length)
      : relativePath.slice(0, -'.html'.length);
  const segments = routePath.split('/').filter(Boolean);
  const pattern = segments
    .map((segment) => {
      if (/^\[\.\.\..+\]$/.test(segment)) return '.+';
      if (/^\[.+\]$/.test(segment)) return '[^/]+';
      return escapeRegExp(segment);
    })
    .join('/');
  const staticWeight = segments.filter((segment) => !segment.startsWith('[')).length;
  return {
    filePath,
    staticWeight,
    pattern: new RegExp(`^/${pattern}/?$`),
  };
}

const routeMatchers = (await collectHtmlFiles(root))
  .map(createRouteMatcher)
  .sort((left, right) => right.staticWeight - left.staticWeight);

function isInsideRoot(filePath) {
  const resolved = resolve(filePath);
  return resolved === root || resolved.startsWith(`${root}${sep}`);
}

async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function resolveRequest(pathname) {
  const decodedPath = decodeURIComponent(pathname);
  const directPath = join(root, decodedPath);
  if (isInsideRoot(directPath) && (await isFile(directPath))) return directPath;

  const htmlPath = `${directPath}.html`;
  if (isInsideRoot(htmlPath) && (await isFile(htmlPath))) return htmlPath;

  const directoryIndex = join(directPath, 'index.html');
  if (isInsideRoot(directoryIndex) && (await isFile(directoryIndex))) return directoryIndex;

  return routeMatchers.find((route) => route.pattern.test(decodedPath))?.filePath;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? host}`);
    const filePath = await resolveRequest(url.pathname);
    if (!filePath) {
      const notFoundPath = join(root, '+not-found.html');
      response.writeHead(404, { 'Content-Type': mimeTypes['.html'] });
      response.end(await readFile(notFoundPath));
      return;
    }

    const extension = extname(filePath).toLowerCase();
    const contentType = mimeTypes[extension] ?? 'application/octet-stream';
    const cacheControl = extension === '.html'
      ? 'no-store'
      : url.pathname.startsWith('/_expo/static/')
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=3600';
    response.writeHead(200, {
      'Cache-Control': cacheControl,
      'Content-Type': contentType,
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    response.end(await readFile(filePath));
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(`预览服务错误：${error instanceof Error ? error.message : String(error)}`);
  }
});

server.listen(port, host, () => {
  console.log(`移动端预览已启动：http://${host}:${port}`);
  console.log(`静态目录：${root}`);
});
