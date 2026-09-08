import core1 from './core-001.mjs';
import core2 from './core-002.mjs';
import core3 from './core-003.mjs';
import core4 from './core-004.mjs';
import core5 from './core-005.mjs';
import core6 from './core-006.mjs';
import core7 from './core-007.mjs';
import asset1 from './assets-001.mjs';
import asset2 from './assets-002.mjs';
import asset3 from './assets-003.mjs';
import asset4 from './assets-004.mjs';
import asset5 from './assets-005.mjs';
import asset6 from './assets-006.mjs';
import asset7 from './assets-007.mjs';
import asset8 from './assets-008.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
const root=process.cwd();
const assetJson=gunzipSync(Buffer.from([asset1,asset2,asset3,asset4,asset5,asset6,asset7,asset8].join(''),'base64')).toString('utf8');
const assetSource=JSON.parse(assetJson);
const virtual=new Map();
for(const [name,value] of Object.entries(assetSource)){const buffer=Buffer.from(value,'utf8');virtual.set(path.resolve(root,name),buffer);virtual.set(path.resolve('/',name),buffer);}
const keyFor=(target)=>{if(target instanceof URL)return fileURLToPath(target);const text=String(target);if(text.startsWith('file:'))return fileURLToPath(text);return path.resolve(text);};
const originalRead=fs.readFileSync.bind(fs);
const originalExists=fs.existsSync.bind(fs);
const originalStat=fs.statSync.bind(fs);
fs.existsSync=(target)=>virtual.has(keyFor(target))||originalExists(target);
fs.readFileSync=(target,options)=>{const value=virtual.get(keyFor(target));if(!value)return originalRead(target,options);const enc=typeof options==='string'?options:options?.encoding;return enc?value.toString(enc):Buffer.from(value);};
fs.statSync=(target,...args)=>{const value=virtual.get(keyFor(target));if(!value)return originalStat(target,...args);return {size:value.length,isFile:()=>true,isDirectory:()=>false};};
let corePromise;
async function loadCore(){if(!corePromise){const source=gunzipSync(Buffer.from([core1,core2,core3,core4,core5,core6,core7].join(''),'base64'));const corePath=path.join('/tmp','molip-dashboard-core-5c7fff.mjs');fs.writeFileSync(corePath,source);corePromise=import(pathToFileURL(corePath).href);}return corePromise;}
export default async function handler(request,response){const mod=await loadCore();return mod.default(request,response);}
