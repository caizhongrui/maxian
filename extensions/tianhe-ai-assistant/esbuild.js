const esbuild = require('esbuild');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',
  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started');
    });
    build.onEnd(result => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        console.error(`    ${location.file}:${location.line}:${location.column}:`);
      });
      console.log('[watch] build finished');
    });
  },
};

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'out/extension.js',
    external: [
      'vscode',
      'sqlite3',
      'puppeteer-core',
      'puppeteer-chromium-resolver',
      '@vscode/ripgrep',
      'tree-sitter',
      'canvas',
      'keytar',
      'monaco-vscode-textmate-theme-converter',
      'say',
    ],
    logLevel: 'info',
    plugins: [
      esbuildProblemMatcherPlugin,
    ],
    loader: {
      '.node': 'file',
      '.wasm': 'file',
    },
    mainFields: ['module', 'main'],
    treeShaking: true,
  });

  if (watch) {
    console.log('Watching for changes...');
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    console.log('Build complete!');
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
