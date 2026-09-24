import {createHash} from 'node:crypto';
import {copyFile, mkdir, open, readdir, stat, writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {basename, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const DEFAULT_CHUNK_BYTES = 7_500_000;
export const DEFAULT_MANIFEST = 'cgss-card-bundles.json.tiff';
const WIKI_LIMIT_BYTES = 8_000_000;

async function filesUnder(directory, excludedDirectory) {
  const found=[];
  async function visit(current) {
    for (const entry of await readdir(current,{withFileTypes:true})) {
      const path=join(current,entry.name);
      if (entry.isDirectory() && resolve(path)!==excludedDirectory) await visit(path);
      else if (entry.isFile() && /card_cartoon_\d+\.unity3d(?:\.tiff)?$/i.test(entry.name)) found.push(path);
    }
  }
  await visit(directory);
  return found.sort((a,b)=>a.localeCompare(b,'en'));
}

function cardId(path) {
  const match=basename(path).match(/^card_cartoon_(\d+)\.unity3d(?:\.tiff)?$/i);
  if (!match) throw new Error('Unsupported card filename: '+path);
  return match[1];
}

async function sha256(path) {
  const hash=createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function splitFile(source, outputDirectory, base, size, chunkBytes) {
  const sourceHandle=await open(source,'r');
  const parts=[];
  try {
    let offset=0,index=1;
    while(offset<size) {
      const length=Math.min(chunkBytes,size-offset);
      const buffer=Buffer.allocUnsafe(length);
      const {bytesRead}=await sourceHandle.read(buffer,0,length,offset);
      if(bytesRead!==length) throw new Error('Unexpected end of file: '+source);
      const name=base.replace(/\.tiff$/i,`.part${String(index).padStart(3,'0')}.tiff`);
      await writeFile(join(outputDirectory,name),buffer);
      parts.push(name);
      offset+=length;
      index++;
    }
  } finally { await sourceHandle.close(); }
  return parts;
}

export async function packageMediaWikiBundles(inputDirectory, outputDirectory, options={}) {
  const input=resolve(inputDirectory), output=resolve(outputDirectory);
  const chunkBytes=Number(options.chunkBytes ?? DEFAULT_CHUNK_BYTES);
  const manifestName=options.manifestName || DEFAULT_MANIFEST;
  if(!Number.isSafeInteger(chunkBytes) || chunkBytes<=0 || chunkBytes>=WIKI_LIMIT_BYTES)
    throw new Error(`chunkBytes must be a positive integer below ${WIKI_LIMIT_BYTES}`);
  if(!manifestName.endsWith('.tiff')) throw new Error('Manifest filename must end with .tiff');
  if(input===output) throw new Error('Input and output directories must be different');
  await mkdir(output,{recursive:true});
  const sources=await filesUnder(input,output);
  const cards={};
  for(const source of sources) {
    const id=cardId(source);
    if(cards[id]) throw new Error('Duplicate card ID: '+id);
    const {size}=await stat(source);
    const file=`card_cartoon_${id}.unity3d.tiff`;
    const common={bytes:size,sha256:await sha256(source)};
    if(size<=chunkBytes) {
      const target=join(output,file);
      if(resolve(source)!==resolve(target)) await copyFile(source,target);
      cards[id]={split:false,file,...common};
    } else {
      const parts=await splitFile(source,output,file,size,chunkBytes);
      cards[id]={split:true,partCount:parts.length,parts,...common};
    }
  }
  const manifest={version:1,chunkBytes,cards};
  await writeFile(join(output,manifestName),JSON.stringify(manifest,null,2)+'\n','utf8');
  return {manifest,manifestPath:join(output,manifestName),cards:sources.length};
}

function argument(name) {
  const prefix=`--${name}=`;
  return process.argv.slice(2).find(value=>value.startsWith(prefix))?.slice(prefix.length);
}

if(process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1])) {
  const positional=process.argv.slice(2).filter(value=>!value.startsWith('--'));
  if(positional.length!==2)
    throw new Error('Usage: node scripts/package-mediawiki-bundles.mjs <input-directory> <output-directory> [--chunk-bytes=7500000] [--manifest=cgss-card-bundles.json.tiff]');
  const result=await packageMediaWikiBundles(positional[0],positional[1],{
    chunkBytes:argument('chunk-bytes'),manifestName:argument('manifest')
  });
  console.log(`Prepared ${result.cards} cards.`);
  console.log(`Wrote ${result.manifestPath}`);
}
