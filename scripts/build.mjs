import { build } from 'esbuild';
import { mkdir, cp, writeFile, readFile } from 'node:fs/promises';
await mkdir('dist',{recursive:true});
await cp('public','dist',{recursive:true});
const config={supabaseUrl:process.env.SUPABASE_URL||'',supabaseKey:process.env.SUPABASE_PUBLISHABLE_KEY||'',pushUrl:process.env.PUSH_API_URL||''};
await writeFile('dist/config.js',`window.DAYLINE_CONFIG=${JSON.stringify(config).replaceAll('<','\\u003c')};`);
await build({entryPoints:['src/app.js'],bundle:true,outfile:'dist/app.js',format:'esm',minify:true,sourcemap:true,target:'es2022'});
console.log('Built dist. '+(config.supabaseUrl?'Cloud login configured.':'Local mode; set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY for cloud login.'));

// A self-contained local copy lets the design be reviewed without hosting.
const html=await readFile('public/index.html','utf8'),bundle=await readFile('dist/app.js','utf8');
await writeFile('dist/dayline-local.html',html.replace('<script src="config.js"></script><script type="module" src="app.js"></script>',`<script>window.DAYLINE_CONFIG={};</script><script type="module">${bundle.replaceAll('</script','<\\/script')}</script>`));
