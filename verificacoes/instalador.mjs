// Conferência pública dos pacotes prontos. Não contém o código-fonte nem artes avulsas do aplicativo.
import assert from 'node:assert/strict';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash, verify} from 'node:crypto';
import {readFile, writeFile, mkdir, mkdtemp, copyFile, chmod, readdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const tr=(text,values=[])=>text.replace(/\{(\d+)\}/g,(_,i)=>String(values[Number(i)]??''));
if(process.env.GITHUB_ACTIONS!=='true')throw Error(tr('Esta conferência só pode rodar no executor descartável do GitHub.'));
const tag=process.argv[2];
if(!/^v\d+\.\d+\.\d+(?:-rc\.\d+)?$/.test(tag??''))throw Error(tr('Tag inválida.'));
const version=tag.slice(1).replace(/-rc\.\d+$/,'');
const baseUrl='https://github.com/willian-29/escritorio-dos-agentes-downloads/releases/download/'+tag+'/';
const run=promisify(execFile);
const root=await mkdtemp(join(tmpdir(),'escritorio-pacote-'));
const data=join(root,'dados'),directory=join(data,'atualizacoes','preparacao-teste');
await mkdir(directory,{recursive:true});
async function download(name){const r=await fetch(baseUrl+name,{signal:AbortSignal.timeout(900000)});if(!r.ok)throw Error(tr('Download respondeu HTTP {0}.',[r.status]));return Buffer.from(await r.arrayBuffer());}
const envelope=(await download('atualizacao-assinada.json')).toString('utf8');
const signed=JSON.parse(envelope),payload=Buffer.from(signed.payload,'base64');
const publicKey='-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA2o5y4als7+ikiTKc4Z5TlQZyMnFHMf9gyl2CVbhysdw=\n-----END PUBLIC KEY-----\n';
assert.ok(verify(null,payload,publicKey,Buffer.from(signed.signature,'base64')),tr('A assinatura independente não confere.'));
const manifest=JSON.parse(payload);assert.equal(manifest.version,version);assert.equal(manifest.schema,1);assert.equal(manifest.files.length,3);
const suffix=process.platform==='win32'?'win-x64.exe':'mac-'+process.arch+'.dmg';
const name='Escritorio-dos-Agentes-'+version+'-'+suffix;
const file=manifest.files.find(f=>f.name===name);assert.ok(file,tr('Falta o pacote desta arquitetura.'));
const bytes=await download(name);assert.equal(bytes.length,file.size);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);
assert.ok((await download(name+'.sha256')).toString('utf8').includes(file.sha256));
file.url=baseUrl+name;
const installer=join(directory,name);await writeFile(installer,bytes);
const destination=join(root,process.platform==='darwin'?'Escritorio-dos-Agentes.app':'Instalação com espaço');
const installEnv={...process.env,ESCRITORIO_INSTALLER:installer,ESCRITORIO_DESTINATION:destination};
async function install(){
 if(process.platform==='darwin'){
  const mount=join(root,'volume');await mkdir(mount,{recursive:true});await run('/usr/bin/hdiutil',['attach',installer,'-readonly','-nobrowse','-mountpoint',mount]);
  try{await run('/usr/bin/ditto',[join(mount,'Escritorio-dos-Agentes.app'),destination]);}finally{await run('/usr/bin/hdiutil',['detach',mount]);}
 }else await run('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command','$p=Start-Process -FilePath $env:ESCRITORIO_INSTALLER -ArgumentList ("/S /D="+$env:ESCRITORIO_DESTINATION) -Wait -PassThru; exit $p.ExitCode'],{env:installEnv,timeout:180000});
}
if(process.platform==='win32'){
 const script=`$s=Get-AuthenticodeSignature $env:ESCRITORIO_INSTALLER
 if(-not $s.SignerCertificate){throw 'Falta o certificado próprio.'}
 $fp=$s.SignerCertificate.GetCertHashString([System.Security.Cryptography.HashAlgorithmName]::SHA256)
 if($fp -ne '4B11B2F02C83C2365D135729567E75CB371A7C766B5DB172A999E601109CEB15'){throw 'Identidade inesperada.'}
 if($s.Status -notin @('Valid','NotTrusted','UnknownError')){throw 'Assinatura inválida.'}
 $b=[System.IO.File]::ReadAllBytes($env:ESCRITORIO_INSTALLER);$b[4096]=$b[4096] -bxor 1
 $p=Join-Path $env:RUNNER_TEMP 'instalador-adulterado.exe';[System.IO.File]::WriteAllBytes($p,$b)
 if((Get-AuthenticodeSignature $p).Status -ne 'HashMismatch'){throw 'A alteração não foi detectada.'}
 Write-Output 'Identidade e adulteração conferidas; nenhum certificado foi importado.'`;
 console.log((await run('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{env:installEnv})).stdout.trim());
}
await install();
const exe=process.platform==='darwin'?join(destination,'Contents/MacOS/Escritorio-dos-Agentes'):join(destination,'Escritorio-dos-Agentes.exe');
const backend=process.platform==='darwin'?join(destination,'Contents/Resources/backend'):join(destination,'resources/backend');
async function diagnostic(wsl=false){
 const check=join(root,wsl?'conferencia-wsl':'conferencia');await mkdir(join(check,'dados'),{recursive:true});
 if(wsl)await writeFile(join(check,'dados/ambiente-aplicativo.json'),JSON.stringify({kind:'wsl',distribution:'Ubuntu-22.04'}));
 const path=join(check,'resultado.json');
 await run(exe,['--verificar='+path],{env:{...process.env,ESCRITORIO_PORT:wsl?'4859':'4855',ESCRITORIO_DATA_DIR:join(check,'dados'),ESCRITORIO_USAGE_DIR:join(check,'uso'),ESCRITORIO_APP_PROFILE:join(check,'perfil')},timeout:120000});
 const r=JSON.parse(await readFile(path,'utf8'));
 for(const key of ['ok','pty','headless','art','windowLoaded','installed'])assert.equal(r[key],true,tr('Diagnóstico falhou em {0}.',[key]));
 assert.equal(r.version,version);assert.equal(r.node,'24.22.1');
 if(wsl){assert.equal(r.execution.kind,'wsl');assert.equal(r.execution.distribution,'Ubuntu-22.04');}
 console.log(tr('Janela e diagnóstico conferidos: {0}, {1}, WSL={2}.',[process.platform,process.arch,wsl]));
}
await diagnostic();
if(process.platform==='win32'){await install();await diagnostic();await diagnostic(true);}
const node=join(directory,process.platform==='win32'?'node.exe':'node'),worker=join(directory,'aplicar.cjs');
await copyFile(join(backend,'bin',process.platform==='win32'?'node.exe':'node'),node);await chmod(node,0o700);await copyFile(join(backend,'update-worker.cjs'),worker);
const preferences=JSON.stringify({officeName:'Atualização de teste',officeNameAsked:true,theme:'none'});
await writeFile(join(data,'interface.json'),preferences);await writeFile(join(data,'contas-preservadas.txt'),tr('Dados de teste preservados.'));await writeFile(join(destination,'marca-anterior.txt'),tr('Instalação anterior.'));
const parent=spawn(node,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});assert.ok(parent.pid);
const plan={schema:1,current:'0.2.1',version,parentPid:parent.pid,destination,directory,installer,file,envelope,resultFile:join(data,'atualizacoes/resultado.json')};await writeFile(join(directory,'plano.json'),JSON.stringify(plan));
const child=spawn(node,[worker,'--aplicar',directory],{env:{...process.env,ESCRITORIO_PORT:'4878',ESCRITORIO_DATA_DIR:data,ESCRITORIO_USAGE_DIR:join(root,'uso'),ESCRITORIO_APP_PROFILE:join(root,'perfil')},stdio:'inherit'});
async function waitFile(path,timeout){const end=Date.now()+timeout;while(Date.now()<end){try{return await readFile(path,'utf8');}catch{}const err=await readFile(join(directory,'erro.txt'),'utf8').catch(()=>'');if(err)throw Error(err);if(child.exitCode!==null)throw Error(tr('O auxiliar encerrou antes de concluir.'));await new Promise(ok=>setTimeout(ok,250));}throw Error(tr('Tempo de conferência excedido.'));}
let reopenedPid;
try{
 await waitFile(join(directory,'pronto'),45000);assert.ok(existsSync(join(destination,'marca-anterior.txt')));parent.kill();
 const result=JSON.parse(await waitFile(join(directory,'concluido.json'),360000));reopenedPid=result.pid;assert.equal(result.ok,true);
 assert.equal(await readFile(join(data,'interface.json'),'utf8'),preferences);assert.equal(await readFile(join(data,'contas-preservadas.txt'),'utf8'),tr('Dados de teste preservados.'));assert.ok(existsSync(join(result.backup,'marca-anterior.txt')));
 const health=await(await fetch('http://127.0.0.1:4878/api/health')).json();assert.equal(health.version,version);
 console.log(tr('Atualização real aprovada: troca, reabertura, cópia anterior e dados preservados.'));
}finally{
 parent.kill();if(!reopenedPid)try{reopenedPid=JSON.parse(await readFile(join(directory,'reaberto.json'),'utf8')).pid;}catch{}
 if(reopenedPid)try{process.kill(reopenedPid);}catch{}child.kill();
}
if(process.platform==='win32'){
 await new Promise(ok=>setTimeout(ok,3000));const name=(await readdir(destination)).find(n=>/^Uninstall.*\.exe$/i.test(n));assert.ok(name);await run(join(destination,name),['/S'],{timeout:120000});
 for(let i=0;i<100&&existsSync(exe);i++)await new Promise(ok=>setTimeout(ok,100));assert.ok(!existsSync(exe),tr('O desinstalador não removeu o aplicativo.'));assert.equal(await readFile(join(data,'interface.json'),'utf8'),preferences);
 console.log(tr('Remoção conferida, sem apagar os dados.'));
}
console.log(tr('Pacote pronto conferido: {0}, {1}, versão {2}.',[process.platform,process.arch,version]));
