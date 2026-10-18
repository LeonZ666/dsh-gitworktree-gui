import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { collectCommit } from '../index.js'
function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'commit-detail-'))
  t.after(()=>rmSync(root,{recursive:true,force:true}))
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()
  git('init','-b','main');git('config','user.name','Test');git('config','user.email','test@example.invalid')
  return {root,git}
}
test('root and subsequent commits expose files and literal-path patches',async t=>{
  const {root,git}=fixture(t)
  writeFileSync(join(root,'file with spaces.txt'),'original\n')
  git('add','.');git('commit','-m','initial\n\nCommit body')
  let sha=git('rev-parse','HEAD')
  let result=await collectCommit(root,[root],sha,'file with spaces.txt')
  assert.equal(result.body.comparisonParent,null)
  assert.match(result.body.message,/Commit body/)
  assert.match(result.body.patch,/\+original/)
  renameSync(join(root,'file with spaces.txt'),join(root,'--file.txt'))
  git('add','-A');git('commit','-m','rename')
  sha=git('rev-parse','HEAD')
  result=await collectCommit(root,[root],sha,'--file.txt')
  assert.equal(result.body.files.length,2)
  assert.match(result.body.patch,/\+original/)
  assert.equal((await collectCommit(root,[root],sha,'../../etc/passwd')).status,404)
})
test('hash validation and the directory fence run before detail collection',async t=>{
  const {root,git}=fixture(t)
  git('commit','--allow-empty','-m','empty')
  const sha=git('rev-parse','HEAD')
  assert.equal((await collectCommit(root,[],sha)).status,403)
  for(const value of ['HEAD','--help','main;whoami','']) assert.equal((await collectCommit(root,[root],value)).status,400)
  assert.equal((await collectCommit(root,[root],'a'.repeat(40))).status,404)
  assert.deepEqual((await collectCommit(root,[root],sha)).body.files,[])
})
test('merge detail compares to its first parent and patches have a visible bound',async t=>{
  const {root,git}=fixture(t)
  git('commit','--allow-empty','-m','initial');git('checkout','-b','feature')
  writeFileSync(join(root,'large.txt'),Array.from({length:1500},(_,i)=>`line ${i}`).join('\n'))
  git('add','.');git('commit','-m','large file');git('checkout','main')
  const parent=git('rev-parse','HEAD');git('merge','--no-ff','feature','-m','merge')
  const result=await collectCommit(root,[root],git('rev-parse','HEAD'),'large.txt')
  assert.equal(result.body.comparisonParent,parent)
  assert.equal(result.body.patchTruncated,true)
  assert.ok(result.body.patch.split('\n').length<=1200)
})

test('non-commit objects are rejected and pathspec characters stay literal', async t => {
  const {root,git}=fixture(t)
  writeFileSync(join(root,'[a].txt'),'literal content\n')
  writeFileSync(join(root,'a.txt'),'other content\n')
  writeFileSync(join(root,'binary.bin'),Buffer.from([0,1,2,0]))
  git('add','.');git('commit','-m','paths')
  const sha=git('rev-parse','HEAD')
  assert.equal((await collectCommit(root,[root],git('rev-parse','HEAD^{tree}'))).status,404)
  const result=await collectCommit(root,[root],sha,'[a].txt')
  assert.match(result.body.patch,/literal content/)
  assert.doesNotMatch(result.body.patch,/other content/)
  assert.equal((await collectCommit(root,[root],sha,'binary.bin')).body.binary,true)
})
