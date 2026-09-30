'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {check}=require('../scripts/release-validation/check-release-acceptance.cjs');
test('formal release rejects pending manual evidence and mismatched installer evidence',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mat-release-gate-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'validation/candidate'),{recursive:true});fs.mkdirSync(path.join(root,'validation/acceptance'));
 const write=(p,d)=>fs.writeFileSync(path.join(root,p),JSON.stringify(d));
 write('package.json',{version:'1.2.18'});write('validation/candidate/sha256.json',{sha256:'a'.repeat(64)});
 const acceptance={version:'1.2.18',installerSha256:'a'.repeat(64),windows8GiB:{passed:false},windowsOffice:{passed:false}};
 write('validation/release-acceptance.json',acceptance);assert.throws(()=>check(root),/remains pending/);
 for(const key of ['windows8GiB','windowsOffice'])acceptance[key]={passed:true,evidence:'validation/acceptance/'+key+'.json'};
 write('validation/release-acceptance.json',acceptance);
 const common={passed:true,installerSha256:'a'.repeat(64),platform:'win32',checkedAt:'2026-09-30',method:'fixture'};
 write('validation/acceptance/windows8GiB.json',{...common,physicalMemoryGiB:16,physicalDevice:true});
 write('validation/acceptance/windowsOffice.json',{...common,application:'WPS',manuallyOpened:true,noRepairDialog:true,valuesAndLayoutVerified:true});
 assert.throws(()=>check(root),/8 GiB physical/);
 write('validation/acceptance/windows8GiB.json',{...common,physicalMemoryGiB:8,physicalDevice:true});assert.equal(check(root).passed,true);
 write('validation/acceptance/windowsOffice.json',{...common,installerSha256:'b'.repeat(64),application:'WPS',manuallyOpened:true,noRepairDialog:true,valuesAndLayoutVerified:true});assert.throws(()=>check(root));
});
