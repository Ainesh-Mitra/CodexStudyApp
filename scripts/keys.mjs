import webpush from 'web-push';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('.data',{recursive:true});
await writeFile('.data/vapid.json',JSON.stringify(webpush.generateVAPIDKeys(),null,2),{flag:'wx',mode:0o600});
console.log('Created .data/vapid.json. Enter these keys securely in Worker settings. Do not commit the file.');
